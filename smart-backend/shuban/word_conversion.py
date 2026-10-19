"""DOCX validation, template conversion, browser preview, and delivery ZIP."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path

from fastapi import HTTPException

from shuban.fbdview import render_html, report
from shuban.fbdview.bytes_io import read as read_bytes
from shuban.fbdview.layout import analyze_geometry
from shuban.fbdview.lexer import tokenize
from shuban.word_templates import WordTemplate

MAX_DOCX_ENTRIES = 2000
MAX_DOCX_MEMBER_BYTES = 100 * 1024 * 1024
MAX_DOCX_EXPANDED_BYTES = 512 * 1024 * 1024
CONVERTER_SCRIPT = Path(__file__).resolve().parent / "tools" / "docx_to_series_fbd.py"


def validate_docx(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_DOCX_ENTRIES:
                raise HTTPException(status_code=413, detail="Word 文件内部条目过多")
            if "word/document.xml" not in archive.namelist():
                raise HTTPException(status_code=400, detail="文件不是有效的 DOCX 文档")

            total = 0
            for entry in entries:
                name = entry.filename.replace("\\", "/")
                if name.startswith("/") or ".." in Path(name).parts:
                    raise HTTPException(status_code=400, detail="DOCX 包含非法内部路径")
                if entry.flag_bits & 0x1:
                    raise HTTPException(status_code=400, detail="DOCX 内部文件不能加密")
                if entry.file_size > MAX_DOCX_MEMBER_BYTES:
                    raise HTTPException(status_code=413, detail="DOCX 内单个内容过大")
                total += entry.file_size
                if total > MAX_DOCX_EXPANDED_BYTES:
                    raise HTTPException(status_code=413, detail="DOCX 解包后内容总量过大")
    except HTTPException:
        raise
    except (OSError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail="Word 文件无效或已损坏") from exc


def _output_stem(filename: str, template: WordTemplate) -> str:
    stem = Path(filename).stem
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", stem).strip(" ._")
    stem = re.sub(r"\s+", "_", stem)[:72] or "Word排版"
    suffix = "夹册" if template.mode == "booklet" else "正文"
    return f"{stem}_{suffix}"


def _converter_command(source: Path, output_dir: Path, output_name: str,
                       template: WordTemplate, image_prefix: str,
                       template_head: Path | None = None) -> list[str]:
    command = [
        sys.executable,
        "-X", "utf8",
        str(CONVERTER_SCRIPT),
        "--source", str(source),
        "--reference", str(template.header_path),
        "--pro", str(template.pro_path),
        "--out", str(output_dir),
        "--name", output_name,
        "--title-prefix", "",
        "--image-prefix", image_prefix,
        "--math-answer-scheme",
        "--macro-answers",
    ]
    if template.mode == "booklet":
        command.extend([
            "--booklet",
            "--booklet-answer-color", template.booklet_answer_color,
            "--booklet-title-font", template.booklet_title_font,
            "--booklet-title-prefix", template.booklet_title_prefix,
            "--booklet-title-suffix", template.booklet_title_suffix,
            "--booklet-title-image", template.booklet_title_image,
        ])
    else:
        command.extend([
            "--template-head", str(template_head or template.header_path),
            "--column-open", template.column_open,
        ])
    return command


def _extract_text_template_head(template: WordTemplate, output_dir: Path) -> Path:
    """Keep only the main template's header bytes before its sample body begins."""
    decoded = read_bytes(str(template.header_path))
    open_index = decoded.text.find(template.column_open)
    if open_index < 0:
        raise HTTPException(status_code=500, detail="正文模板中找不到分栏起始注解")
    line_start = decoded.text.rfind("\n", 0, open_index) + 1
    byte_offset = decoded.offsets[line_start] if line_start < len(decoded.offsets) else decoded.stats["size"]
    head_path = output_dir / ".template-head.fbd"
    head_path.write_bytes(template.header_path.read_bytes()[:byte_offset])
    return head_path


def _converter_error(result: subprocess.CompletedProcess) -> str:
    lines = (result.stderr + "\n" + result.stdout).splitlines()
    detail = next((line.strip() for line in reversed(lines) if line.strip()), "")
    traceback_location = next(
        (
            f"{Path(match.group(1)).name}:{match.group(2)}"
            for line in reversed(lines)
            if (match := re.search(r'File [\"\']([^\"\']*docx_to_series_fbd\.py)[\"\'], line (\d+)', line))
        ),
        None,
    )
    if not detail:
        detail = f"转换器退出码 {result.returncode}"
    detail = re.sub(r"[A-Za-z]:\\[^\s:]+", "文件路径", detail)
    if "以下字符无法按 GBK 编码" in detail:
        detail = detail.replace(
            "以下字符无法按 GBK 编码，需先决定映射：",
            "Word 中包含无法写入 FBD 的字符：",
        ) + "。请检查这些符号并替换为书版支持的写法后重试。"
    if traceback_location and traceback_location not in detail:
        detail = f"{traceback_location}: {detail}"
    return f"FBD 生成失败：{detail[:1200]}"


def _fl_structure_errors(lex) -> list[str]:
    """Report FL sequencing errors that simple open/close counts cannot detect."""
    active_line: int | None = None
    issues = []
    for token in lex.tokens:
        if token.kind != "annot" or token.name != "FL" or token.in_def:
            continue
        if token.op == "open":
            if active_line is not None:
                issues.append(
                    f"第 {token.line} 段：FL 开栏嵌套；第 {active_line} 段开启的分栏尚未关闭。"
                    "请在下一次开栏前先结束上一段分栏内容。"
                )
            else:
                active_line = token.line
        elif token.op == "close":
            if active_line is None:
                issues.append(
                    f"第 {token.line} 段：FL 闭栏没有对应的开栏，可能是重复关闭。"
                    "请删除多余闭栏，或补上对应开栏。"
                )
            else:
                active_line = None
    if active_line is not None:
        issues.append(
            f"第 {active_line} 段：FL 开栏未关闭。请在该分栏内容结束处添加匹配的闭栏注解。"
        )
    return issues


def convert_docx(source: Path, output_dir: Path, original_name: str,
                 template: WordTemplate, conversion_id: str) -> dict:
    """Run the series converter in an isolated process and package its deliverables."""
    validate_docx(source)
    if not template.header_path.is_file() or not template.pro_path.is_file():
        raise HTTPException(status_code=500, detail="排版模板文件缺失")
    if not CONVERTER_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="Word 转换器未安装")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_name = _output_stem(original_name, template)
    image_prefix = f"W{conversion_id[:8]}_"
    template_head = (
        _extract_text_template_head(template, output_dir)
        if template.mode != "booklet" else None
    )
    try:
        result = subprocess.run(
            _converter_command(source, output_dir, output_name, template, image_prefix, template_head),
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=240,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="Word 排版超时，请缩小文档或拆分后重试") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="启动 Word 转换器失败") from exc
    finally:
        if template_head:
            template_head.unlink(missing_ok=True)

    fbd_path = output_dir / f"{output_name}.fbd"
    pro_path = output_dir / f"{output_name}.PRO"
    report_path = output_dir / "转换核对.json"
    if result.returncode not in (0, 2) or not fbd_path.is_file() or not pro_path.is_file():
        raise HTTPException(status_code=422, detail=_converter_error(result))
    try:
        conversion_report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="转换完成但缺少校验报告") from exc

    preview_path = output_dir / "preview.html"
    fl_errors = []
    try:
        dec = read_bytes(str(fbd_path))
        lex = tokenize(dec)
        fl_errors = _fl_structure_errors(lex)
        rep = report.analyze(str(fbd_path), dec, lex)
        geo = analyze_geometry(str(fbd_path), dec, str(pro_path))
        html = render_html.page(
            dec, lex, rep, geo, str(fbd_path), fbd_path.name,
            rel="", root=str(output_dir), inline=True,
        )
        preview_path.write_text(html, encoding="utf-8", newline="\n")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"FBD 已生成，但预览生成失败：{type(exc).__name__}: {str(exc)[:180]}",
        ) from exc

    warnings = list(dict.fromkeys(conversion_report.get("warnings") or []))
    if conversion_report.get("warningNotes"):
        warning_notes = "；".join(conversion_report["warningNotes"])
        warnings = [
            f"{warning}。说明：{warning_notes}"
            if "未知用户区字节" in warning else warning
            for warning in warnings
        ]
    if not conversion_report.get("contentVerified", False):
        content_warning = (
            "Word 与 FBD 可见文本未通过逐字符核对；请下载排版 ZIP，查看「转换核对.json」中的差异后再发排。"
        )
        if content_warning not in warnings:
            warnings.append(content_warning)
    warnings.extend(
        f"FBD 分栏结构检查：{issue}请在发排前修正，并查看 ZIP 中的「转换问题说明.txt」。"
        for issue in fl_errors
    )
    conversion_report.update({
        "source": Path(original_name).name,
        "templateId": template.id,
        "templateName": template.name,
        "fbd": fbd_path.name,
        "pro": pro_path.name,
        "preview": preview_path.name,
        "warnings": warnings,
    })
    conversion_report.pop("reference", None)
    report_path.write_text(json.dumps(conversion_report, ensure_ascii=False, indent=2), encoding="utf-8")
    issue_lines = [
        "Word 转 FBD 问题说明",
        f"源文件：{Path(original_name).name}",
        f"版式模板：{template.name}",
        "",
    ]
    conversion_errors = conversion_report.get("conversionErrors") or []
    if conversion_errors:
        issue_lines.append("字符兼容问题（生成时以占位符替换，原字符和位置如下）：")
        for error in conversion_errors:
            issue_lines.append(
                f"- {error['character']!r} {error['codepoint']}：{error['occurrences']} 处；"
                f"FBD 中使用 {error['replacement']} 占位。"
            )
            for location in error.get("locations", []):
                issue_lines.append(
                    f"  - 小样第 {location['segment']} 段附近：{location['context']}"
                )
    else:
        issue_lines.append("字符兼容问题：未发现。")
    issue_lines.append("")
    if warnings:
        issue_lines.append("生成和校验告警：")
        issue_lines.extend(f"- {warning}" for warning in warnings)
    elif conversion_report.get("contentVerified", False):
        issue_lines.append("生成和校验告警：未发现。")
    if not conversion_report.get("contentVerified", False):
        issue_lines.extend([
            "",
            "内容核对未通过。请先依据上述位置修正 Word 或字符映射，再使用 FBD 发排。",
        ])
    (output_dir / "转换问题说明.txt").write_text(
        "\n".join(issue_lines) + "\n", encoding="utf-8",
    )
    (output_dir / "排版说明.md").write_text(
        f"# Word 转 FBD 排版结果\n\n"
        f"版式模板：{template.name}\n\n"
        "浏览器预览用于检查内容与结构，最终分页、字体和发排效果以方正书版实际发排为准。\n",
        encoding="utf-8",
    )

    zip_path = output_dir / "排版结果.zip"
    try:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as package:
            for path in sorted(output_dir.iterdir(), key=lambda item: item.name.casefold()):
                if path.is_file() and path != zip_path and path != source:
                    package.write(path, arcname=path.name)
    except (OSError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=500, detail="预览已生成，但排版 ZIP 打包失败") from exc

    return {
        "id": conversion_id,
        "templateId": template.id,
        "templateName": template.name,
        "fileName": fbd_path.name,
        "previewFile": preview_path.name,
        "zipFile": zip_path.name,
        "contentVerified": bool(conversion_report.get("contentVerified")),
        "warnings": warnings,
        "geometry": conversion_report.get("geometry"),
        "previewUrl": f"/api/shuban/word-conversions/{conversion_id}/preview",
        "downloadUrl": f"/api/shuban/word-conversions/{conversion_id}/download",
    }

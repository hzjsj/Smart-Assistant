"""FBD 文件上传、解析、校验和预览接口。"""
from __future__ import annotations

import os
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
import zlib
from dataclasses import asdict
from functools import lru_cache
from html import escape
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from starlette.concurrency import run_in_threadpool

from auth import get_current_user
from users.models import User
from shuban.fbdview import annotations, ast as ast_mod, macros, render_html, report
from shuban.fbdview.bytes_io import read as read_bytes
from shuban.fbdview.layout import analyze_geometry
from shuban.fbdview.lexer import tokenize
from shuban.word_conversion import convert_docx
from shuban.word_templates import get_template, list_templates
from shuban import storage

def _no_store(response: Response):
    response.headers["Cache-Control"] = "private, no-store"


router = APIRouter(
    prefix="/api/shuban",
    tags=["书版预览"],
    dependencies=[Depends(get_current_user), Depends(_no_store)],
)

UPLOAD_ROOT = Path(__file__).resolve().parents[1] / "uploads" / "shuban"
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
MAX_ARCHIVE_MEMBER_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_FILES = 1000
MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".fbd", ".pro", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".tif", ".tiff", ".bmp", ".eps", ".ps",
}
ARCHIVE_FILE_EXTENSIONS = ALLOWED_EXTENSIONS - {".zip"}
MAX_DOCX_UPLOAD_BYTES = 500 * 1024 * 1024


def _user_dir(user: User) -> Path:
    user_key = re.sub(r"[^A-Za-z0-9_-]", "_", str(user.userid))[:80]
    if not user_key:
        raise HTTPException(status_code=400, detail="用户目录无效")
    path = (UPLOAD_ROOT / user_key).resolve()
    if UPLOAD_ROOT.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="用户目录无效")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_file(user: User, filename: str) -> Path:
    return storage.resolve(_user_dir(user), filename)[0]


def _conversion_dir(user: User, conversion_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", conversion_id):
        raise HTTPException(status_code=404, detail="转换记录不存在")
    root = _user_dir(user)
    base = (root / "word-conversions").resolve()
    path = (base / conversion_id).resolve()
    if base not in path.parents or not path.is_dir():
        raise HTTPException(status_code=404, detail="转换记录不存在")
    return path


def _archive_entry_name(entry: zipfile.ZipInfo) -> str:
    """还原 Windows 中文 ZIP 常见的未标记 UTF-8（CP936/GBK）文件名。"""
    filename = entry.filename
    original = getattr(entry, "orig_filename", filename)
    if entry.flag_bits & 0x800 or filename != original:
        return filename.replace("\\", "/")

    try:
        raw_name = original.encode("cp437")
        decoded = raw_name.decode("gb18030")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return filename.replace("\\", "/")

    # 保留合法 CP437 名称；只有解码结果含中文时才采用 Windows 中文代码页。
    if decoded != original and any("\u3400" <= char <= "\u9fff" for char in decoded):
        return decoded.replace("\\", "/")
    return filename.replace("\\", "/")


def _upload_filename(filename: str | None) -> str:
    """Normalize multipart filenames decoded as CP437/Latin-1 on some Windows clients."""
    name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if any("\u3400" <= char <= "\u9fff" for char in name):
        return name

    for source_encoding, target_encoding in (("cp437", "gb18030"), ("latin1", "utf-8")):
        try:
            decoded = name.encode(source_encoding).decode(target_encoding)
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if decoded != name and any("\u3400" <= char <= "\u9fff" for char in decoded):
            return decoded
    return name


def _same_file_contents(source: Path, destination: Path) -> bool:
    try:
        if not destination.is_file() or source.stat().st_size != destination.stat().st_size:
            return False
        with source.open("rb") as left, destination.open("rb") as right:
            while True:
                left_chunk = left.read(1024 * 1024)
                right_chunk = right.read(1024 * 1024)
                if left_chunk != right_chunk:
                    return False
                if not left_chunk:
                    return True
    except OSError:
        return False


def _replace_uploaded_file(source: Path, destination: Path, display_name: str) -> bool:
    """Skip identical imports; report locked/existing target paths without leaking WinError 5."""
    if _same_file_contents(source, destination):
        return False
    try:
        os.replace(source, destination)
    except PermissionError as exc:
        status = 409 if destination.exists() else 500
        detail = (
            f"目标文件无法覆盖：{display_name}。请关闭正在使用该文件的程序，"
            "或移走用户目录中的同名文件后重试。"
        )
        raise HTTPException(status_code=status, detail=detail) from exc
    return True


def _extract_archive(archive_path: Path, root: Path, archive_size: int) -> dict:
    try:
        archive = zipfile.ZipFile(archive_path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail="压缩包无效或已损坏") from exc

    with archive:
        entries = archive.infolist()
        if len(entries) > MAX_ARCHIVE_FILES:
            raise HTTPException(status_code=413, detail=f"压缩包内文件不能超过 {MAX_ARCHIVE_FILES} 个")

        accepted: list[tuple[zipfile.ZipInfo, str]] = []
        names: set[str] = set()
        fbd_files: list[str] = []
        expanded_size = 0
        ignored_count = 0

        for entry in entries:
            if entry.is_dir():
                continue
            raw_name = _archive_entry_name(entry)
            archive_name = PurePosixPath(raw_name)
            if (archive_name.is_absolute() or ".." in archive_name.parts
                    or (archive_name.parts and ":" in archive_name.parts[0])):
                raise HTTPException(status_code=400, detail=f"压缩包包含非法路径：{entry.filename}")

            parts = archive_name.parts
            if not parts:
                raise HTTPException(status_code=400, detail=f"压缩包内文件路径无效：{entry.filename}")
            if any(
                part in {"", ".", ".."}
                or any(char in part for char in '<>:"|?*')
                or any(ord(char) < 32 for char in part)
                for part in parts
            ):
                raise HTTPException(status_code=400, detail=f"压缩包内文件路径无效：{entry.filename}")

            relative_name = PurePosixPath(*parts).as_posix()
            name = parts[-1]
            suffix = Path(name).suffix.lower()
            if suffix not in ARCHIVE_FILE_EXTENSIONS:
                ignored_count += 1
                continue
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise HTTPException(status_code=400, detail=f"压缩包不支持符号链接：{entry.filename}")
            if entry.flag_bits & 0x1:
                raise HTTPException(status_code=400, detail=f"压缩包内文件已加密：{entry.filename}")
            if entry.file_size > MAX_ARCHIVE_MEMBER_BYTES:
                raise HTTPException(status_code=413, detail=f"压缩包内单个文件不能超过 50 MB：{name}")

            folded_name = relative_name.casefold()
            if folded_name in names:
                raise HTTPException(status_code=400, detail=f"压缩包内存在重复路径：{relative_name}")
            names.add(folded_name)
            expanded_size += entry.file_size
            if expanded_size > MAX_ARCHIVE_EXPANDED_BYTES:
                raise HTTPException(status_code=413, detail="压缩包解压后总大小不能超过 512 MB")

            accepted.append((entry, relative_name))

        # ZIP 工具常会把整个项目包在一个同名目录中；去掉这一层后，
        # 保留项目内部图片目录，避免把素材都平铺导致注解路径失效。
        path_parts = [PurePosixPath(name).parts for _, name in accepted]
        strip_wrapper = bool(path_parts) and all(
            len(parts) >= 2 and parts[0].casefold() == path_parts[0][0].casefold()
            for parts in path_parts
        )
        if strip_wrapper:
            accepted = [(entry, PurePosixPath(*PurePosixPath(name).parts[1:]).as_posix())
                        for entry, name in accepted]

        fbd_names = [name for _, name in accepted if Path(name).suffix.lower() == ".fbd"]
        if not fbd_names:
            raise HTTPException(status_code=400, detail="压缩包内没有可导入的 FBD 文件")
        if any("/" in name for name in fbd_names):
            raise HTTPException(
                status_code=400,
                detail="FBD 文件需位于压缩包根目录，或统一放在一个外层目录中；请将素材子目录保留在 FBD 旁边",
            )
        fbd_files = fbd_names

        folded_paths = [name.casefold() for _, name in accepted]
        if len(folded_paths) != len(set(folded_paths)):
            raise HTTPException(status_code=400, detail="压缩包去除外层目录后存在重复路径")

        stage = Path(tempfile.mkdtemp(prefix=".shuban-unpack-", dir=root))
        try:
            for entry, relative_name in accepted:
                destination = stage.joinpath(*PurePosixPath(relative_name).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                written = 0
                with archive.open(entry) as source, destination.open("xb") as output:
                    while chunk := source.read(1024 * 1024):
                        written += len(chunk)
                        if written > entry.file_size or written > MAX_ARCHIVE_MEMBER_BYTES:
                            raise HTTPException(status_code=400, detail=f"压缩包内文件大小异常：{relative_name}")
                        output.write(chunk)
                if written != entry.file_size:
                    raise HTTPException(status_code=400, detail=f"压缩包内文件长度不匹配：{relative_name}")

            imported_files: list[str] = []
            resolved_root = root.resolve()
            for _, relative_name in accepted:
                source = stage.joinpath(*PurePosixPath(relative_name).parts)
                destination = root.joinpath(*PurePosixPath(relative_name).parts)
                if destination.exists():
                    raise HTTPException(status_code=400, detail=f"本次导入存在重复文件路径：{relative_name}")
                destination.parent.mkdir(parents=True, exist_ok=True)
                resolved_parent = destination.parent.resolve()
                if resolved_parent != resolved_root and resolved_root not in resolved_parent.parents:
                    raise HTTPException(status_code=400, detail=f"压缩包目标路径超出用户目录：{relative_name}")
                _replace_uploaded_file(source, destination, relative_name)
                imported_files.append(relative_name)
        except (zipfile.BadZipFile, RuntimeError, EOFError, NotImplementedError, zlib.error) as exc:
            raise HTTPException(status_code=400, detail="压缩包校验失败，无法解压") from exc
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    return {
        "success": True,
        "name": archive_path.name,
        "size": archive_size,
        "files": imported_files,
        "fbdFiles": fbd_files,
        "preservedDirectories": sorted({
            str(PurePosixPath(name).parent)
            for name in imported_files
            if str(PurePosixPath(name).parent) != "."
        }),
        "ignoredCount": ignored_count,
    }


@lru_cache(maxsize=24)
def _analyze(path_text: str, version: str) -> dict:
    path = Path(path_text)
    decoded = read_bytes(str(path))
    lexed = tokenize(decoded)
    result = report.analyze(str(path), decoded, lexed)
    pro = next((item for item in path.parent.iterdir()
                if item.is_file() and item.stem.casefold() == path.stem.casefold()
                and item.suffix.lower() == ".pro"), None)
    result["_geo"] = analyze_geometry(str(path), decoded, str(pro) if pro else None)
    result["pro"] = {"path": str(pro) if pro else None, "exists": pro is not None}
    result["_dec"] = decoded
    result["_lex"] = lexed
    return result


def _file_analysis(user: User, filename: str) -> tuple[Path, dict]:
    path, _, version = storage.resolve(_user_dir(user), filename)
    try:
        return path, _analyze(str(path), version)
    except (OSError, UnicodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"FBD 解析失败：{exc}") from exc


def _json_report(result: dict) -> dict:
    payload = {
        **{key: value for key, value in result.items() if not key.startswith("_")},
        "geometry": asdict(result["_geo"]),
    }
    payload["file"] = Path(payload["file"]).name
    if payload["pro"]["path"]:
        payload["pro"]["path"] = Path(payload["pro"]["path"]).name
    if payload["geometry"].get("pro_path"):
        payload["geometry"]["pro_path"] = Path(payload["geometry"]["pro_path"]).name
    return payload


def _text_view(result: dict, plain: bool) -> str:
    decoded = result["_dec"]
    chunks: list[str] = []
    lines: list[str] = []
    for token in result["_lex"].tokens:
        if token.kind == "newline":
            lines.append("".join(chunks))
            chunks = []
        elif token.kind == "ctrl":
            if not plain:
                chunks.append(f"⟨{token.raw}⟩")
        elif token.kind == "annot":
            if not plain:
                chunks.append("〖" + decoded.translate(token.raw).replace("\n", "⏎") + "〗")
        else:
            chunks.append(token.raw if plain else decoded.translate(token.raw))
    lines.append("".join(chunks))
    if plain:
        return "\n".join(lines)
    return "\n".join(f"{index:>5}| {line}" for index, line in enumerate(lines, 1))


@router.get("/files")
def list_files(current_user: User = Depends(get_current_user)):
    return {"files": storage.list_documents(_user_dir(current_user))}


@router.get("/word-templates")
def get_word_templates(current_user: User = Depends(get_current_user)):
    return {"templates": list_templates()}


@router.post("/word-conversions")
async def convert_word_file(
    file: UploadFile = File(...),
    template_id: str = Form(...),
    current_user: User = Depends(get_current_user),
):
    name = _upload_filename(file.filename)
    if Path(name).suffix.lower() != ".docx":
        raise HTTPException(status_code=400, detail="仅支持 .docx Word 文件")
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=400, detail="请选择有效的排版模板")

    root = _user_dir(current_user)
    conversion_id = uuid.uuid4().hex
    conversion_root = root / "word-conversions"
    conversion_root.mkdir(parents=True, exist_ok=True)
    output_dir = conversion_root / conversion_id
    output_dir.mkdir()
    source = output_dir / ".source.docx"
    size = 0
    try:
        with source.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_DOCX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Word 文件不能超过 500 MB")
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Word 文件为空")
        result = await run_in_threadpool(
            convert_docx, source, output_dir, name, template, conversion_id,
        )
        result["previewUrl"] = f"/api/shuban/word-conversions/{conversion_id}/preview"
        result["downloadUrl"] = f"/api/shuban/word-conversions/{conversion_id}/download"
        return result
    except HTTPException:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(output_dir, ignore_errors=True)
        detail = str(exc).strip().splitlines()[-1] if str(exc).strip() else type(exc).__name__
        for sensitive_path in (str(source), str(output_dir), str(template.header_path), str(template.pro_path)):
            detail = detail.replace(sensitive_path, "")
        raise HTTPException(
            status_code=422,
            detail=f"Word 转 FBD 失败（{type(exc).__name__}）：{detail[:220]}",
        ) from exc
    finally:
        await file.close()
        source.unlink(missing_ok=True)


@router.get("/word-conversions/{conversion_id}/preview", response_class=HTMLResponse)
def get_word_conversion_preview(conversion_id: str, current_user: User = Depends(get_current_user)):
    path = _conversion_dir(current_user, conversion_id) / "preview.html"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="预览文件不存在")
    return FileResponse(path, media_type="text/html; charset=utf-8", headers={"Cache-Control": "private, no-store"})


@router.get("/word-conversions/{conversion_id}/download")
def download_word_conversion(conversion_id: str, current_user: User = Depends(get_current_user)):
    conversion_dir = _conversion_dir(current_user, conversion_id)
    archives = [path for path in conversion_dir.iterdir() if path.is_file() and path.suffix.lower() == ".zip"]
    if len(archives) != 1:
        raise HTTPException(status_code=404, detail="排版 ZIP 不存在")
    path = archives[0]
    return FileResponse(path, media_type="application/zip", filename=path.name, headers={"Cache-Control": "private, no-store"})


@router.post("/word-conversions/{conversion_id}/save")
def save_word_conversion(conversion_id: str, current_user: User = Depends(get_current_user)):
    conversion_dir = _conversion_dir(current_user, conversion_id)
    fbd_files = [path for path in conversion_dir.iterdir() if path.is_file() and path.suffix.lower() == ".fbd"]
    pro_files = [path for path in conversion_dir.iterdir() if path.is_file() and path.suffix.lower() == ".pro"]
    if len(fbd_files) != 1 or len(pro_files) != 1:
        raise HTTPException(status_code=500, detail="转换结果缺少唯一的 FBD 或 PRO 文件")
    documents, unchanged = storage.publish(
        _user_dir(current_user), conversion_dir, fixed_ids={fbd_files[0].name: conversion_id},
    )
    saved_files = [path.name for path in conversion_dir.iterdir()
                   if path.is_file() and path.suffix.lower() in ARCHIVE_FILE_EXTENSIONS]
    return {
        "success": True, "fbdFileName": fbd_files[0].name, "document": documents[0],
        "savedFiles": saved_files, "unchangedFiles": saved_files if unchanged else [],
        "unchanged": unchanged,
    }


@router.post("/imports")
async def import_files(
    files: list[UploadFile] = File(...),
    document_id: str | None = Form(None),
    current_user: User = Depends(get_current_user),
):
    root = _user_dir(current_user)
    stage = Path(tempfile.mkdtemp(prefix=".import-", dir=root))
    incoming = stage / "payload"
    incoming.mkdir()
    ignored_count = 0
    total_size = 0
    try:
        # 所选 FBD、PRO、图片与 ZIP 属于同一批次，全部接收成功后才发布。
        for file in files:
            name = _upload_filename(file.filename)
            suffix = Path(name).suffix.lower()
            if (not name or name in {".", ".."} or any(char in name for char in '<>:"|?*')
                    or any(ord(char) < 32 for char in name) or name.endswith((".", " "))):
                raise HTTPException(status_code=400, detail="上传文件名无效")
            if suffix not in ALLOWED_EXTENSIONS:
                raise HTTPException(status_code=400, detail="仅支持 ZIP、FBD、PRO 及预览所需的图片文件")
            temporary = stage / f"{uuid.uuid4().hex}.upload"
            written = 0
            with temporary.open("xb") as output:
                while chunk := await file.read(1024 * 1024):
                    written += len(chunk)
                    if written > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="单个上传文件不能超过 500 MB")
                    output.write(chunk)
            if not written:
                raise HTTPException(status_code=400, detail=f"文件为空：{name}")
            total_size += written
            if suffix == ".zip":
                archive_result = await run_in_threadpool(_extract_archive, temporary, incoming, written)
                ignored_count += archive_result["ignoredCount"]
            else:
                if any(item.name.casefold() == name.casefold() for item in incoming.iterdir()):
                    raise HTTPException(status_code=400, detail=f"本次导入存在重复文件路径：{name}")
                os.replace(temporary, incoming / name)
        # 文件名在 Windows 和 Linux 上均按忽略大小写的路径处理。
        paths = [path.relative_to(incoming).as_posix() for path in incoming.rglob("*") if path.is_file()]
        if len({name.casefold() for name in paths}) != len(paths):
            raise HTTPException(status_code=400, detail="本次导入存在重复文件路径")
        if document_id:
            await run_in_threadpool(storage.migrate_legacy, root)
        documents, unchanged = await run_in_threadpool(storage.publish, root, incoming, document_id)
        return {
            "success": True, "documents": documents, "files": paths,
            "fbdFiles": [item["name"] for item in documents],
            "ignoredCount": ignored_count, "size": total_size, "unchanged": unchanged,
        }
    finally:
        for file in files:
            await file.close()
        shutil.rmtree(stage, ignore_errors=True)


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    document_id: str | None = Form(None),
    current_user: User = Depends(get_current_user),
):
    # 保留旧地址；单独导入 PRO/图片时必须明确所属文档。
    return await import_files(files=[file], document_id=document_id, current_user=current_user)


@router.get("/files/{filename}/report")
def get_report(filename: str, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    return _json_report(result)


@router.get("/files/{filename}/tokens")
def get_tokens(filename: str, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    return [
        {
            "kind": token.kind,
            "line": token.line,
            "offset": token.offset,
            "depth": token.depth,
            "name": token.name,
            "params": token.params,
            "op": token.op,
            "category": token.cat,
            "description": token.desc,
            "confidence": token.confidence,
            "known": token.known,
            "inDefinition": token.in_def,
            "raw": result["_dec"].translate(token.raw) if token.kind != "newline" else "",
        }
        for token in result["_lex"].tokens
    ]


@router.get("/files/{filename}/ast")
def get_ast(filename: str, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    tree = ast_mod.build(result["_lex"].tokens, annotations.default())
    stats = macros.MacroStats()
    macros.expand(result["_lex"].tokens, tree.defs, stats=stats)
    return {
        "summary": ast_mod.summarize(tree.root),
        "definitions": {key: len(value) for key, value in tree.defs.items()},
        "macros": {
            "calls": stats.calls,
            "callsWithArguments": stats.calls_with_args,
            "expanded": stats.expanded,
            "undefined": sorted(set(stats.undefined)),
        },
        "warnings": tree.warnings,
        "notes": tree.notes,
        "tree": ast_mod.to_dict(tree.root, max_depth=8),
        "text": ast_mod.tree_text(tree.root, max_lines=5000),
    }


@router.get("/files/{filename}/text")
def get_text(filename: str, plain: bool = False, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    return {"text": _text_view(result, plain)}


@router.get("/files/{filename}/preview", response_class=HTMLResponse)
def get_preview(filename: str, current_user: User = Depends(get_current_user)):
    path, result = _file_analysis(current_user, filename)
    layout = render_html.preview_html(
        result["_dec"], result["_lex"], result["_geo"],
        str(path), str(path.parent), inline=True, document_key=filename,
    )
    preview = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        f'<title>{escape(path.name)}</title><style>{render_html.CSS}</style></head>'
        f'<body class="hide-bg hide-bw">{layout}</body>'
        f'<script>{render_html.JS}'
        'window.addEventListener("message",function(event){'
        'if(event.source===window.parent&&event.data&&event.data.type==="shuban-print"&&window.fbdLayoutReady)window.print();});'
        '</script></html>'
    )
    return HTMLResponse(content=preview, headers={"Cache-Control": "private, no-store"})


@router.get("/files/{filename}/word")
def export_word(filename: str, current_user: User = Depends(get_current_user)):
    path, result = _file_analysis(current_user, filename)
    from shuban.fbdview.export_docx import build_docx

    content = build_docx(
        result["_dec"], result["_lex"], result["_geo"], str(path), str(path.parent),
    )
    download_name = f"{path.stem}.docx"
    from urllib.parse import quote

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(download_name)}"},
    )

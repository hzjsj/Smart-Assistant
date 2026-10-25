"""按 layout.json 的 bbox 修复 MinerU 原生 docx 的图片显示尺寸。

问题：MinerU 导出的 full.docx 把"图片像素数"直接当 pt 写入显示尺寸
（MinerU 按 200 DPI 裁图，像素 = pt × 200/72），导致图片比在原 PDF
页面上放大约 2.8 倍。

方案：layout.json 中每个图片块（image/chart/table）带 ``image_path`` +
``bbox``（pt 实际坐标），以 bbox 宽高作为真实物理尺寸，改写
``word/document.xml`` 里对应 drawing 的 ``wp:extent`` 与 ``a:ext``
（EMU = pt × 12700）。

移植自 mineru-api/fix_docx_image_size.py（已用高考数学卷 PDF 验证）。
"""

import hashlib
import io
import json
import os
import re
import shutil
import zipfile
from pathlib import Path

EMU_PER_PT = 12700
EXTRACT_DPI = 200          # MinerU 按 200 DPI 从 PDF 裁图: 像素 = pt × 200/72
PAGE_MARGIN_PT = 52        # 版心边距，超宽兜底用（实测正文块 x0 均为 52 附近）


def _collect_images(layout: dict) -> dict:
    """从 layout.json 收集 ``{image_path: {page_idx, bbox}}``，按 image_path 去重。"""
    images: dict[str, dict] = {}

    def walk(node, page_idx: int) -> None:
        if isinstance(node, dict):
            path = node.get("image_path")
            if path and node.get("bbox") and path not in images:
                images[path] = {"page_idx": page_idx, "bbox": node["bbox"]}
            for v in node.values():
                walk(v, page_idx)
        elif isinstance(node, list):
            for item in node:
                walk(item, page_idx)

    for page in layout.get("pdf_info", []):
        walk(page, page.get("page_idx", 0))
    return images


def _real_size_pt(bbox: list) -> tuple[float, float]:
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def _media_pixel_size(data: bytes) -> tuple[int, int] | None:
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except Exception:
        return None


def fix_docx_image_sizes(
    docx_path: str, layout_json_path: str, images_dir: str, output_path: str
) -> list[dict]:
    """修复 docx 内嵌图片显示尺寸，输出到 ``output_path``（不覆盖原文件）。

    返回修改记录列表：``[{rid, image_path, old_emu, new_emu, new_wh_pt}]``，
    供调用方打日志核对。docx 与源图无法对应的 drawing 保持原样跳过。
    """
    layout = json.loads(Path(layout_json_path).read_text(encoding="utf-8"))
    images = _collect_images(layout)
    if not images:
        # 纯文本文档（无图片块）是正常场景：不做修改，原样复制后返回
        shutil.copyfile(docx_path, output_path)
        return []

    # 版心宽（超宽兜底）：取第一页宽 - 两侧边距
    pdf_info = layout.get("pdf_info") or [{}]
    page_w = (pdf_info[0].get("page_size") or [595.3])[0]
    max_w_pt = page_w - 2 * PAGE_MARGIN_PT

    zin = zipfile.ZipFile(docx_path)
    try:
        # 1. rels: rId -> media 文件名
        rels = zin.read("word/_rels/document.xml.rels").decode("utf-8")
        rid_to_media = dict(
            re.findall(r'Id="(rId\d+)"[^>]*Target="(media/[^"]+)"', rels)
        )

        # 2. media -> 源图映射：md5 字节级匹配优先，PIL 像素尺寸兜底
        media_md5 = {
            name: hashlib.md5(zin.read(f"word/{name}")).hexdigest()
            for name in rid_to_media.values()
        }
        src_md5 = {
            p.name: hashlib.md5(p.read_bytes()).hexdigest()
            for p in Path(images_dir).iterdir()
            if p.is_file()
        }
        derived_px = {
            p: tuple(round(d * EXTRACT_DPI / 72) for d in _real_size_pt(i["bbox"]))
            for p, i in images.items()
        }
        media_to_image: dict[str, str] = {}
        for media, m_md5 in media_md5.items():
            for src, s_md5 in src_md5.items():
                if m_md5 == s_md5:
                    media_to_image[media] = src
                    break
            else:  # md5 未命中（图片可能被重编码），按推导像素尺寸匹配
                px = _media_pixel_size(zin.read(f"word/{media}"))
                for src, d_px in derived_px.items():
                    if d_px == px:
                        media_to_image[media] = src
                        break

        # 3. 改写 document.xml 中每个 drawing 的 wp:extent / a:ext
        xml = zin.read("word/document.xml").decode("utf-8")
        fixed_parts: list[str] = []
        changes: list[dict] = []
        pos = 0
        for m in re.finditer(r"<w:drawing>.*?</w:drawing>", xml, re.S):
            span = m.group(0)
            rid_m = re.search(r'r:embed="(rId\d+)"', span)
            # 优先用 pic:cNvPr 的 descr（记录源图路径），否则用 md5/像素匹配结果
            descr_m = re.search(r'descr="(images/[^"]+)"', span)
            if descr_m:
                src = descr_m.group(1)[len("images/"):]
            elif rid_m:
                src = media_to_image.get(rid_to_media.get(rid_m.group(1), ""), "")
            else:
                src = ""
            if not src or src not in images:
                continue

            w_pt, h_pt = _real_size_pt(images[src]["bbox"])
            if w_pt > max_w_pt:  # 超出版心则等比缩小
                h_pt = h_pt * max_w_pt / w_pt
                w_pt = max_w_pt
            cx, cy = round(w_pt * EMU_PER_PT), round(h_pt * EMU_PER_PT)

            old = re.search(r'<wp:extent cx="(\d+)" cy="(\d+)"\s*/>', span)
            new_span = re.sub(
                r'(<wp:extent cx=")\d+(" cy=")\d+("\s*/>)',
                rf"\g<1>{cx}\g<2>{cy}\g<3>", span, count=1,
            )
            new_span = re.sub(
                r'(<a:ext cx=")\d+(" cy=")\d+("\s*/>)',
                rf"\g<1>{cx}\g<2>{cy}\g<3>", new_span, count=1,
            )
            fixed_parts.append(xml[pos:m.start()])
            fixed_parts.append(new_span)
            pos = m.end()
            changes.append({
                "rid": rid_m.group(1) if rid_m else "",
                "image_path": src,
                "old_emu": tuple(int(v) for v in old.groups()) if old else None,
                "new_emu": (cx, cy),
                "new_wh_pt": (w_pt, h_pt),
            })
        fixed_parts.append(xml[pos:])
        new_xml = "".join(fixed_parts)

        # 4. 重新打包（仅替换 document.xml，其余条目原样复制）
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = (
                    new_xml.encode("utf-8")
                    if item.filename == "word/document.xml"
                    else zin.read(item.filename)
                )
                zout.writestr(item, data, compress_type=item.compress_type)
    finally:
        zin.close()

    return changes


# 合并 Word 的格式化模板（A4 公文版式/默认字体/标题样式）；缺失时跳过格式化不阻断
TEMPLATE_DOCX = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "utils", "template.docx"
)


def apply_template(docx_path: str, template_path: str) -> None:
    """以模板样式格式化 docx（原地重写包内三个 XML），单任务与批量合并共用。

    - styles.xml：模板为底（默认字体/标题样式 1,2,3... 生效，ID 体系与
      MinerU docx 同源），再追加模板缺失的分片样式（FirstParagraph/SourceCode 等）
    - document.xml：body 末尾 sectPr 替换为模板的（A4 页面与页边距）
    - theme1.xml：整体替换为模板主题——样式表里的字体是主题引用
      （minorHAnsi/minorEastAsia），不换主题则实际字体仍是 MinerU 的
      （Aptos/等线），模板字体（Calibri/宋体）不会生效
    - numbering 不动（保留列表编号）
    """
    from lxml import etree

    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

    with zipfile.ZipFile(template_path) as zt:
        tpl_styles = etree.fromstring(zt.read("word/styles.xml"))
        tpl_sectpr = etree.fromstring(zt.read("word/document.xml")).find(f"{{{W}}}body/{{{W}}}sectPr")
        if tpl_sectpr is not None:
            tpl_sectpr = etree.fromstring(etree.tostring(tpl_sectpr))
        tpl_theme = (
            zt.read("word/theme/theme1.xml")
            if "word/theme/theme1.xml" in zt.namelist() else None
        )

    zin = zipfile.ZipFile(docx_path)
    styles = etree.fromstring(zin.read("word/styles.xml"))
    doc_xml = etree.fromstring(zin.read("word/document.xml"))

    # 追加模板缺失的分片样式（含 basedOn 链上的父样式，一并补齐）。
    # 判重按 styleId（元素按 ID 引用样式，保 ID 唯一引用才有效；若按官方
    # 建议的 name 判重，同名不同 ID 的样式不会被追加，引用会静默失效）。
    # 同名不同 ID 的追加会造成 Word 样式列表重名，仅打警告不阻断。
    tpl_ids = {s.get(f"{{{W}}}styleId") for s in tpl_styles.findall(f"{{{W}}}style")}
    tpl_names = {
        s.find(f"{{{W}}}name").get(f"{{{W}}}val")
        for s in tpl_styles.findall(f"{{{W}}}style")
        if s.find(f"{{{W}}}name") is not None
    }
    appended: list[str] = []
    for style in styles.findall(f"{{{W}}}style"):
        if style.get(f"{{{W}}}styleId") not in tpl_ids:
            name_el = style.find(f"{{{W}}}name")
            name = name_el.get(f"{{{W}}}val") if name_el is not None else ""
            if name and name in tpl_names:
                print(f"[MinerU] 警告: 追加样式与模板同名 (name={name}, "
                      f"id={style.get(f'{{{W}}}styleId')})，Word 样式列表可能出现重名")
            tpl_styles.append(style)
            appended.append(f"{name}({style.get(f'{{{W}}}styleId')})")

    # 替换 body 末尾的 sectPr 为模板页面设置
    body = doc_xml.find(f"{{{W}}}body")
    old_sectpr = body.find(f"{{{W}}}sectPr")
    if tpl_sectpr is not None:
        if old_sectpr is not None:
            body.replace(old_sectpr, tpl_sectpr)
        else:
            body.append(tpl_sectpr)

    tmp_out = docx_path + ".tmp"
    with zipfile.ZipFile(tmp_out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename == "word/styles.xml":
                data = etree.tostring(tpl_styles, xml_declaration=True, encoding="UTF-8", standalone=True)
            elif item.filename == "word/document.xml":
                data = etree.tostring(doc_xml, xml_declaration=True, encoding="UTF-8", standalone=True)
            elif item.filename == "word/theme/theme1.xml" and tpl_theme is not None:
                data = tpl_theme
            else:
                data = zin.read(item.filename)
            zout.writestr(item, data, compress_type=item.compress_type)
    zin.close()
    shutil.move(tmp_out, docx_path)
    detail = f"，补充: {', '.join(appended[:8])}" if appended else ""
    print(f"[MinerU] 已套用模板 {os.path.basename(template_path)}: "
          f"页面/边距/主题字体替换为模板，模板样式 {len(tpl_ids)} 项，"
          f"补充分片样式 {len(appended)} 项{detail}")

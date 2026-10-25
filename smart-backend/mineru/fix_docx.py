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
import re
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
        raise ValueError("layout.json 中未找到任何带 image_path+bbox 的图片块")

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

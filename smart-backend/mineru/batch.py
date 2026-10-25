"""超限文件（>200MB 或 >200 页）的批量解析流程。

链路：PDF 拆分 → 申请批量上传链接（POST /api/v4/file-urls/batch）→ PUT 上传
分片（平台自动提交解析）→ 轮询整批状态 → 下载各分片结果 zip → 合并产物落库。

对外仍是一条任务记录（``file_records`` 存 ``mineru_batch_id``），前端无感知；
状态推进由任务列表的轮询自愈机制驱动（不依赖回调）。
"""

import io
import os
import re
import shutil
import traceback
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
from pypdf import PdfReader, PdfWriter

from database import get_sync_db
from documents import crud
from documents.knowledge import extract_zip, find_md_files
from mineru.fix_docx import fix_docx_image_sizes
from mineru.service import _download_zip_robust, get_mineru_config

# 平台限制：单文件 ≤200MB / ≤200 页；拆分留 5% 余量
MAX_PLATFORM_PAGES = 200
MAX_PLATFORM_BYTES = 200 * 1024 * 1024
SPLIT_MAX_PAGES = 190
SPLIT_MAX_BYTES = int(190 * 1024 * 1024)
# 单批申请上传链接上限（平台限制 50 个）
MAX_BATCH_FILES = 50

BASE_URL = "https://mineru.net/api/v4"


def count_pdf_pages(path: str) -> int:
    return len(PdfReader(path).pages)


def needs_split(path: str, ext: str) -> bool:
    """是否超限需要拆分（仅 PDF 支持自动拆分）。"""
    if ext != ".pdf":
        return False
    if os.path.getsize(path) > MAX_PLATFORM_BYTES:
        return True
    try:
        return count_pdf_pages(path) > MAX_PLATFORM_PAGES
    except Exception:
        traceback.print_exc()
        return False


def split_pdf(path: str, out_dir: str) -> list[str]:
    """把超限 PDF **平分**成 N 份；某份写出后仍超限时，**只对这一份再平均对半拆分**
    （递归直至达标），返回分片路径列表。

    - 初始份数 N：满足页数（≤190/份）与体积（≤190MB/份）双限制的最小值，
      总页数等分（各份页数差 ≤1）
    - 校验每份**实际字节数**（页面大小不均时估算不可靠）；超限的份对半平分后
      重新写出校验，已达标的其他份不动
    """
    reader = PdfReader(path)
    total_pages = len(reader.pages)
    file_bytes = os.path.getsize(path)

    os.makedirs(out_dir, exist_ok=True)
    stem = Path(path).stem

    # 初始平分页界：前 (total % n) 份各多 1 页
    n = max(
        -(-total_pages // SPLIT_MAX_PAGES),  # ceil 除法
        -(-int(file_bytes) // SPLIT_MAX_BYTES),
        1,
    )
    base, rem = divmod(total_pages, n)
    pending: list[tuple[int, int]] = []
    start = 0
    for k in range(n):
        end = start + base + (1 if k < rem else 0)
        pending.append((start, end))
        start = end

    # 已达标的份：(start, end, 文件路径)；写出→校验→超限份对半再拆
    done: list[tuple[int, int, str]] = []
    counter = 0
    while pending:
        if len(done) + len(pending) > MAX_BATCH_FILES:
            for _, _, p in done:
                os.remove(p)
            raise RuntimeError(
                f"文件拆分超过单批 {MAX_BATCH_FILES} 个上限，请手动分段上传"
            )
        counter += 1
        seg_start, seg_end = pending.pop(0)
        writer = PdfWriter()
        for i in range(seg_start, seg_end):
            writer.add_page(reader.pages[i])
        part_path = os.path.join(out_dir, f"{stem}_tmp{counter}.pdf")
        with open(part_path, "wb") as f:
            writer.write(f)
        actual = os.path.getsize(part_path)
        print(f"[MinerU] 拆分校验: 第 {seg_start + 1}-{seg_end} 页, "
              f"{actual / 1024 / 1024:.1f} MB")
        if actual > SPLIT_MAX_BYTES and seg_end - seg_start > 1:
            # 这一份仍超限：对半平均拆分，插队优先处理
            os.remove(part_path)
            mid = seg_start + (seg_end - seg_start + 1) // 2
            pending.insert(0, (mid, seg_end))
            pending.insert(0, (seg_start, mid))
        else:
            done.append((seg_start, seg_end, part_path))

    # 按页序重命名为 part1..N
    done.sort(key=lambda x: x[0])
    parts: list[str] = []
    for i, (_, _, tmp_path) in enumerate(done):
        final_path = os.path.join(out_dir, f"{stem}_part{i + 1}.pdf")
        os.rename(tmp_path, final_path)
        parts.append(final_path)

    print(f"[MinerU] 批量拆分: {total_pages} 页 -> {len(parts)} 份（初始 {n} 份，超限份已对半再拆）")
    return parts


def create_batch_upload_task(file_names: list[str]) -> tuple[str, list[str]]:
    """申请批量上传链接，返回 (batch_id, upload_urls)。上传完成后平台自动提交解析。"""
    cfg = get_mineru_config()
    payload = {
        "files": [{"name": n, "data_id": f"part-{i}"} for i, n in enumerate(file_names)],
        "model_version": "vlm",
        "is_ocr": True,
        "enable_formula": True,
        "enable_table": True,
        "language": "ch",
        "seed": cfg["seed"],
        "callback": cfg["callback_url"],
        "extra_formats": ["docx", "html"],
    }
    res = requests.post(f"{BASE_URL}/file-urls/batch", json=payload, timeout=30,
                        headers={"Authorization": f"Bearer {cfg['token']}"})
    res.raise_for_status()
    data = res.json()
    if data.get("code") != 0:
        raise RuntimeError(f"申请批量上传链接失败: {data.get('msg')}")
    return data["data"]["batch_id"], data["data"]["file_urls"]


def upload_part(upload_url: str, part_path: str, retries: int = 3) -> None:
    """PUT 上传分片到签名 URL（无需 Authorization / Content-Type）。"""
    last_err: Exception | None = None
    for _ in range(retries):
        try:
            with open(part_path, "rb") as f:
                resp = requests.put(upload_url, data=f, timeout=600)
            if resp.status_code == 200:
                return
            last_err = RuntimeError(f"分片上传失败: HTTP {resp.status_code}")
        except requests.RequestException as e:
            last_err = e
        print(f"[MinerU] {os.path.basename(part_path)} 上传失败重试: {last_err}")
    raise last_err


def fetch_batch_state(batch_id: str) -> Optional[list[dict]]:
    """查询整批解析状态，返回 extract_result 列表（失败返回 None）。"""
    cfg = get_mineru_config()
    try:
        res = requests.get(
            f"{BASE_URL}/extract-results/batch/{batch_id}",
            headers={"Authorization": f"Bearer {cfg['token']}"},
            timeout=15,
        )
        res.raise_for_status()
        data = res.json()
        if data.get("code") == 0:
            return data["data"].get("extract_result") or []
        print(f"[MinerU] 批量 {batch_id} 查询失败: {data.get('msg')}")
    except Exception:
        traceback.print_exc()
    return None


# 合并 Word 的格式化模板（A4 公文版式/默认字体/标题样式）；缺失时跳过格式化不阻断
TEMPLATE_DOCX = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "utils", "template.docx"
)


def apply_template(docx_path: str, template_path: str) -> None:
    """以模板样式格式化合并后的 docx（原地重写包内两个 XML）。

    - styles.xml：模板为底（默认字体/标题样式 1,2,3... 生效，ID 体系与
      MinerU docx 同源），再追加模板缺失的分片样式（FirstParagraph/SourceCode 等）
    - document.xml：body 末尾 sectPr 替换为模板的（A4 页面与页边距）
    - numbering 不动（保留分片的列表编号）
    """
    import shutil as _shutil
    from lxml import etree

    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    W = ns["w"]

    with zipfile.ZipFile(template_path) as zt:
        tpl_styles = etree.fromstring(zt.read("word/styles.xml"))
        tpl_sectpr = etree.fromstring(zt.read("word/document.xml")).find(f"{{{W}}}body/{{{W}}}sectPr")
        if tpl_sectpr is not None:
            tpl_sectpr = etree.fromstring(etree.tostring(tpl_sectpr))

    zin = zipfile.ZipFile(docx_path)
    styles = etree.fromstring(zin.read("word/styles.xml"))
    doc_xml = etree.fromstring(zin.read("word/document.xml"))

    # 追加模板缺失的分片样式（含 basedOn 链上的父样式，一并补齐）
    tpl_ids = {s.get(f"{{{W}}}styleId") for s in tpl_styles.findall(f"{{{W}}}style")}
    for style in styles.findall(f"{{{W}}}style"):
        if style.get(f"{{{W}}}styleId") not in tpl_ids:
            tpl_styles.append(style)

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
            else:
                data = zin.read(item.filename)
            zout.writestr(item, data, compress_type=item.compress_type)
    zin.close()
    _shutil.move(tmp_out, docx_path)


def merge_docx(docx_paths: list[str], out_path: str) -> None:
    """按序拼接多个 docx 的正文，输出到 ``out_path``。

    用 python-docx 在包级合并：源文档的 image part 复制进目标包并把元素上的
    旧 rId 重映射到新 rId（否则图片引用失效）；内容一律插到首片的 sectPr
    （页面设置）之前；分片之间插入分页符贴近原 PDF 的分片页界。
    各分片出自 MinerU 同一引擎，样式表同源，保留首片样式即可。
    """
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    dst = Document(docx_paths[0])
    body = dst.element.body
    sect_pr = body.find(qn("w:sectPr"))

    def _append(child) -> None:
        if sect_pr is not None:
            sect_pr.addprevious(child)
        else:
            body.append(child)

    for src_path in docx_paths[1:]:
        # 分片边界：分页符段落
        page_break_p = OxmlElement("w:p")
        run = OxmlElement("w:r")
        br = OxmlElement("w:br")
        br.set(qn("w:type"), "page")
        run.append(br)
        page_break_p.append(run)
        _append(page_break_p)

        src = Document(src_path)
        # ① 复制 image part，建立 旧 rId → 新 rId 映射。
        #    必须用 get_or_add_image（按 blob 走目标包的 image_parts，统一分配
        #    partname 且按 sha1 去重）；直接 relate_to 源 part 会造成
        #    word/media/ 内文件重名，Word 打开时丢图
        rid_map = {}
        for rel_id, rel in list(src.part.rels.items()):
            if "image" in rel.reltype:
                new_rid, _ = dst.part.get_or_add_image(io.BytesIO(rel.target_part.blob))
                rid_map[rel_id] = new_rid

        # ② 搬移正文元素（段落/表格），跳过分节的 sectPr，重映射图片引用
        for child in src.element.body:
            if child.tag == qn("w:sectPr"):
                continue
            for el in child.iter():
                for attr in (qn("r:embed"), qn("r:id"), qn("r:link")):
                    old = el.get(attr)
                    if old in rid_map:
                        el.set(attr, rid_map[old])
            _append(child)

    dst.save(out_path)
    # 用项目模板格式化（A4 版式/默认字体/标题样式）；模板缺失时跳过不阻断
    if os.path.exists(TEMPLATE_DOCX):
        apply_template(out_path, TEMPLATE_DOCX)


def process_mineru_batch(record_id: int, zip_urls: list[str], original_name: str) -> None:
    """下载各分片结果 zip → 合并产物（MD 拼接 / 图片汇总 / pandoc HTML+Word）→ 落库。

    与单任务的 ``process_mineru_zip`` 产物结构一致；Word/HTML 为合并 MD 的
    pandoc 版（MinerU 原生 docx 无法跨分片二进制合并）。
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    temp_dir = f"/tmp/mineru_batch_{timestamp}_{uuid.uuid4().hex}"
    try:
        import pypandoc

        from utils.oss_upload import (
            convert_md_file_to_docx,
            upload_bytes_to_oss,
            upload_to_oss,
        )

        name_base = os.path.splitext(original_name)[0]
        md_parts: list[str] = []
        # image_fname -> 本地路径（hash 命名天然跨分片去重）
        all_images: dict[str, str] = {}
        # 各分片"尺寸修复后的原生 docx"路径（有则 Word 走 docx 级拼接）
        fixed_docx_parts: list[str] = []

        # 1. 逐分片下载解压，收集 full.md / images / 修复后的原生 docx
        for idx, zip_url in enumerate(zip_urls):
            part_dir = os.path.join(temp_dir, f"part{idx}")
            extract_dir = os.path.join(part_dir, "extracted")
            os.makedirs(extract_dir, exist_ok=True)
            zip_path = os.path.join(part_dir, "result.zip")
            _download_zip_robust(zip_url, zip_path)
            extract_zip(zip_path, extract_dir)

            md_files = find_md_files(extract_dir)
            if not md_files:
                raise RuntimeError(f"分片 {idx + 1} 结果中未找到 .md 文件")
            md_path = next(
                (f for f in md_files if os.path.basename(f) == "full.md"), md_files[0]
            )
            md_parts.append(open(md_path, "r", encoding="utf-8").read())

            md_dir = os.path.dirname(md_path)
            images_dir = os.path.join(md_dir, "images")
            if os.path.isdir(images_dir):
                for img in os.listdir(images_dir):
                    if img not in all_images:
                        all_images[img] = os.path.join(images_dir, img)

            # 原生 docx（extra_formats 生成）先用 layout.json 修好图片真实尺寸
            native_docx = os.path.join(md_dir, "full.docx")
            layout_json = os.path.join(md_dir, "layout.json")
            if os.path.exists(native_docx) and os.path.exists(layout_json):
                fixed = os.path.join(part_dir, "full_real_size.docx")
                changes = fix_docx_image_sizes(
                    native_docx, layout_json, images_dir, fixed
                )
                print(f"[MinerU] 分片 {idx + 1}: 原生 docx 图片尺寸修复 {len(changes)} 处")
                fixed_docx_parts.append(fixed)

        # 2. 合并 MD 并上传图片替换引用
        merged_md = "\n\n".join(md_parts)
        uploaded_images: dict[str, str] = {}
        for img_fname, img_path in all_images.items():
            oss_key = f"mineru/images/{timestamp}/{img_fname}"
            uploaded_images[img_fname] = upload_to_oss(img_path, oss_key)["url"]
        for img_fname, oss_url in uploaded_images.items():
            merged_md = re.sub(
                rf"(!\[[^\]]*\]\()[^)]*{re.escape(img_fname)}(\))",
                rf"\g<1>{oss_url}\2",
                merged_md,
            )
            merged_md = re.sub(
                rf"(src=[\"\'])[^\"\']*{re.escape(img_fname)}([\"\'])",
                rf"\g<1>{oss_url}\2",
                merged_md,
            )

        oss_md_key = f"mineru/markdown/{timestamp}/{name_base}.md"
        oss_md_url = upload_bytes_to_oss(merged_md.encode("utf-8"), oss_md_key)["url"]

        # 3. HTML：pandoc 由合并 MD 生成（图片已是 OSS 绝对地址，自包含）
        html = pypandoc.convert_text(
            merged_md, "html", format="markdown",
            extra_args=["--standalone", "--mathml", "--metadata", "charset=utf-8"],
        )
        oss_html_key = f"mineru/html/{timestamp}/{name_base}.html"
        oss_html_url = upload_bytes_to_oss(html.encode("utf-8"), oss_html_key)["url"]

        # 4. Word：优先 docx 级拼接（各片原生 docx 已修图片尺寸，保留原生版式）；
        #    分片均无原生 docx 时才回退 pandoc 由合并 MD 转
        if len(fixed_docx_parts) == len(zip_urls) and fixed_docx_parts:
            merged_docx = os.path.join(temp_dir, "merged.docx")
            merge_docx(fixed_docx_parts, merged_docx)
            oss_docx_key = f"mineru/docx/{timestamp}/{name_base}.docx"
            oss_word_url = upload_to_oss(merged_docx, oss_docx_key)["url"]
            print(f"[MinerU] 批量任务 {record_id}: Word 为原生 docx 拼接版 "
                  f"({len(fixed_docx_parts)} 片)")
        else:
            merged_md_path = os.path.join(temp_dir, "merged.md")
            with open(merged_md_path, "w", encoding="utf-8") as f:
                f.write(merged_md)
            docx_result = convert_md_file_to_docx(
                merged_md_path, filename=f"{name_base}.docx",
                resource_path=temp_dir, oss_prefix="mineru/docx",
            )
            oss_word_url = docx_result["url"]

        db = get_sync_db()
        try:
            crud.update_file_record_mineru(
                db, record_id,
                mineru_state="done",
                oss_md_url=oss_md_url,
                oss_html_url=oss_html_url,
                oss_word_url=oss_word_url,
                oss_images=",".join(uploaded_images.values()) if uploaded_images else None,
                download_url=oss_md_url,
                md_download_url=oss_md_url,
            )
            print(f"[MinerU] 批量任务 {record_id} 合并完成: "
                  f"{len(zip_urls)} 片, {len(all_images)} 图, md={len(merged_md)} 字符")
        finally:
            db.close()
    except Exception as e:
        traceback.print_exc()
        db = get_sync_db()
        try:
            crud.update_file_record_mineru(
                db, record_id, mineru_state="error", mineru_error=f"合并处理异常: {e}"
            )
        finally:
            db.close()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def handle_mineru_batch_done(record_id: int, results: list[dict]) -> None:
    """整批 done 后的入口：按 data_id（part-N）排序取 zip 列表，触发合并。"""
    db = get_sync_db()
    try:
        record = crud.get_file_record(db, record_id)
        original_name = record.original_name if record else "merged"
    finally:
        db.close()

    def _part_key(r: dict) -> tuple[int, str]:
        data_id = str(r.get("data_id") or "")
        m = re.match(r"part-(\d+)", data_id)
        return (int(m.group(1)) if m else 999, str(r.get("file_name") or ""))

    zip_urls = [r["full_zip_url"] for r in sorted(results, key=_part_key)]
    process_mineru_batch(record_id, zip_urls, original_name)

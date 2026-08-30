import os
import re
import uuid
import shutil
import traceback
import zipfile
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from database import get_sync_db
from utils.oss_upload import upload_to_oss, upload_bytes_to_oss, convert_md_file_to_docx
from documents import crud

SUPPORTED_IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".svg", ".bmp", ".tiff", ".avif",
}


def _convert_tiff_to_png(tiff_path: str) -> str | None:
    """将 TIFF 无损转换为 PNG，返回临时 PNG 路径；失败返回 None。

    用 Pillow 以 PNG（无损）格式保存，多页 TIFF 取首页。图片转存流程遇到
    .tiff/.tif 时调用，转成 .png 后再上传 OSS（MD 引用也指向 png）。
    router._transfer_images_to_oss 与本模块的 zip 图片上传共用，避免循环 import。
    """
    try:
        from PIL import Image
    except ImportError:
        traceback.print_exc()
        return None
    png_path = os.path.splitext(tiff_path)[0] + ".png"
    try:
        with Image.open(tiff_path) as img:
            img.save(png_path, "PNG")
        return png_path
    except Exception:
        traceback.print_exc()
        return None


def _generate_timestamp() -> str:
    return datetime.now().strftime('%Y%m%d%H%M%S')


def extract_zip(zip_path: str, extract_dir: str) -> None:
    """解压 zip 文件到指定目录，防路径穿越攻击，自动处理中文文件名编码。"""
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for info in zf.infolist():
            # 尝试修复中文文件名编码（Windows zip 通常用 GBK，macOS/Linux 用 UTF-8）
            filename = info.filename
            try:
                filename = filename.encode('cp437').decode('utf-8')
            except (UnicodeDecodeError, UnicodeEncodeError):
                try:
                    filename = filename.encode('cp437').decode('gbk')
                except (UnicodeDecodeError, UnicodeEncodeError):
                    pass  # 无法解码则保留原名

            if filename.startswith('/') or '..' in filename.split('/'):
                raise ValueError(f"压缩包中包含不安全路径: {filename}")

            target_path = os.path.join(extract_dir, filename)
            if info.is_dir():
                os.makedirs(target_path, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with zf.open(info) as src, open(target_path, 'wb') as dst:
                    dst.write(src.read())


def build_image_index(extract_dir: str) -> dict[str, str]:
    """递归扫描目录，建立 {文件名: 绝对路径} 的图片索引。"""
    index: dict[str, str] = {}
    for root, _, files in os.walk(extract_dir):
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in SUPPORTED_IMAGE_EXTENSIONS:
                if fname not in index:
                    index[fname] = os.path.join(root, fname)
    return index


def find_md_files(extract_dir: str) -> list[str]:
    """递归查找所有 .md 文件，返回绝对路径列表。"""
    md_files: list[str] = []
    for root, _, files in os.walk(extract_dir):
        for fname in files:
            if fname.lower().endswith('.md'):
                md_files.append(os.path.join(root, fname))
    return sorted(md_files)


def fix_md_image_paths(
    md_content: str, md_dir: str, image_index: dict[str, str]
) -> tuple[str, list[str], list[str]]:
    """
    检查并修复 MD 内容中的图片路径，将错误路径修复为相对路径。

    Returns:
        (修复后内容, 使用的图片本地绝对路径列表, 警告列表)
    """
    warnings: list[str] = []
    used_images: list[str] = []

    def _resolve(ref_path: str) -> tuple[str | None, str | None]:
        """解析图片路径，返回 (实际本地绝对路径, 相对路径) 或 (None, None)。"""
        if ref_path.startswith(('http://', 'https://')):
            return None, None  # 在线 URL 不处理
        # Windows 绝对路径（如 D:\xxx）→ 按文件名匹配
        if re.match(r'^[A-Za-z]:', ref_path):
            bare_name = ref_path.replace('\\', '/').split('/')[-1]
            if bare_name in image_index:
                actual_abs = image_index[bare_name]
                rel_path = os.path.relpath(actual_abs, md_dir)
                return actual_abs, rel_path
            return None, None
        # 相对路径：先尝试直接解析
        resolved = os.path.normpath(os.path.join(md_dir, ref_path))
        if os.path.isfile(resolved):
            return resolved, ref_path  # 路径正确
        # 按文件名在索引中查找
        bare_name = os.path.basename(ref_path)
        if bare_name in image_index:
            actual_abs = image_index[bare_name]
            rel_path = os.path.relpath(actual_abs, md_dir)
            return actual_abs, rel_path
        return None, None

    # ![alt](path)
    def replace_md_image(match):
        alt = match.group(1)
        ref_path = match.group(2)
        actual_abs, rel_path = _resolve(ref_path)
        if actual_abs is None:
            if not ref_path.startswith(('http://', 'https://')):
                warnings.append(f"图片未找到: {ref_path}")
            return match.group(0)
        used_images.append(actual_abs)
        if rel_path == ref_path:
            return match.group(0)  # 路径正确，不需要修改
        return f"![{alt}]({rel_path})"

    fixed = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', replace_md_image, md_content)

    # <img src="..." />
    def replace_img_tag(match):
        tag = match.group(0)
        src_match = re.search(r'src=["\']([^"\']+)["\']', tag)
        if not src_match:
            return tag
        ref_path = src_match.group(1)
        actual_abs, rel_path = _resolve(ref_path)
        if actual_abs is None:
            if not ref_path.startswith(('http://', 'https://')):
                warnings.append(f"图片未找到(img标签): {ref_path}")
            return tag
        used_images.append(actual_abs)
        if rel_path == ref_path:
            return tag
        return tag.replace(src_match.group(1), rel_path)

    fixed = re.sub(r'<img\s[^>]*/?>', replace_img_tag, fixed, flags=re.DOTALL)

    return fixed, list(set(used_images)), warnings


def process_knowledge_zip(
    zip_path: str, zip_filename: str, uid: str | None, db_factory
) -> dict:
    """
    处理知识 zip 文件：解压 → 修复图片路径 → 转换 → 上传 OSS → 写数据库。

    Args:
        db_factory: 数据库 session 工厂函数（如 get_sync_db），每次调用返回新 session
    """
    timestamp = _generate_timestamp()
    temp_dir = f"/tmp/knowledge_{timestamp}_{uuid.uuid4().hex}"
    extract_dir = os.path.join(temp_dir, "extracted")

    try:
        # 1. 解压
        os.makedirs(extract_dir, exist_ok=True)
        extract_zip(zip_path, extract_dir)

        # 2. 构建图片索引
        image_index = build_image_index(extract_dir)

        # 3. 查找 .md 文件
        md_files = find_md_files(extract_dir)
        if not md_files:
            return {"status": "error", "data": {"filename": zip_filename, "download_url": None}}

        # 4. 图片去重上传映射 {本地路径: OSS URL}
        uploaded_images: dict[str, str] = {}
        all_warnings: list[str] = []
        results: list[dict] = []

        for md_path in md_files:
            try:
                md_dir = os.path.dirname(md_path)
                md_basename = os.path.splitext(os.path.basename(md_path))[0]
                md_filename = os.path.basename(md_path)

                # a. 读取并修复图片路径
                with open(md_path, "r", encoding="utf-8") as f:
                    md_content = f.read()

                fixed_content, used_images, fix_warnings = fix_md_image_paths(
                    md_content, md_dir, image_index
                )
                all_warnings.extend(fix_warnings)

                # b. 将修复后的内容写回文件（pypandoc 需要正确路径才能嵌入图片到 docx）
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(fixed_content)

                # c. 转 Word（使用 convert_md_file_to_docx）
                docx_result = convert_md_file_to_docx(
                    md_path, filename=f"{md_basename}.md",
                    resource_path=md_dir,
                    oss_prefix="knowledge/docx",
                )
                oss_word_url = docx_result["url"]

                # d. 并发上传图片到 OSS（去重）
                pending_uploads = {
                    img: img for img in used_images if img not in uploaded_images
                }
                if pending_uploads:
                    with ThreadPoolExecutor(max_workers=5) as executor:
                        futures = {}
                        for img_local_path in pending_uploads:
                            img_fname = os.path.basename(img_local_path)
                            # .tiff/.tif 先无损转 .png 再上传
                            to_upload_path = img_local_path
                            oss_fname = img_fname
                            if os.path.splitext(img_fname)[1].lower() in (".tiff", ".tif"):
                                png_path = _convert_tiff_to_png(img_local_path)
                                if png_path:
                                    to_upload_path = png_path
                                    oss_fname = os.path.basename(png_path)
                            oss_key = f"knowledge/images/{timestamp}/{oss_fname}"
                            futures[executor.submit(upload_to_oss, to_upload_path, oss_key)] = img_local_path
                        for future in as_completed(futures):
                            img_local_path = futures[future]
                            try:
                                uploaded_images[img_local_path] = future.result()["url"]
                            except Exception:
                                traceback.print_exc()

                # e. 替换 MD 中图片路径为 OSS URL
                md_with_oss_urls = fixed_content
                for img_local_path, oss_url in uploaded_images.items():
                    img_fname = os.path.basename(img_local_path)
                    md_with_oss_urls = re.sub(
                        rf'(!\[[^\]]*\]\()[^)]*{re.escape(img_fname)}(\))',
                        rf'\g<1>{oss_url}\2',
                        md_with_oss_urls,
                    )
                    md_with_oss_urls = re.sub(
                        rf'(src=["\'])[^"\']*{re.escape(img_fname)}(["\'])',
                        rf'\g<1>{oss_url}\2',
                        md_with_oss_urls,
                    )

                # f. 上传 MD 到 OSS
                oss_md_key = f"knowledge/markdown/{timestamp}/{md_filename}"
                md_upload = upload_bytes_to_oss(md_with_oss_urls.encode("utf-8"), oss_md_key)
                oss_md_url = md_upload["url"]

                # g. 写数据库
                db = db_factory()
                try:
                    oss_images_str = ",".join(uploaded_images.values()) if uploaded_images else None
                    record = crud.create_file_record(
                        db=db,
                        original_name=md_filename,
                        saved_name=f"{uuid.uuid4().hex}.md",
                        file_path=md_path,
                        file_size=len(md_with_oss_urls.encode("utf-8")),
                        download_url=oss_md_url,
                        uid=uid,
                        md_file_path=md_path,
                        md_download_url=oss_md_url,
                        oss_md_url=oss_md_url,
                        oss_word_url=oss_word_url,
                        oss_images=oss_images_str,
                        zip_source=zip_filename,
                    )
                finally:
                    db.close()

                results.append({
                    "id": record.id,
                    "filename": md_filename,
                    "uid": uid,
                    "oss_word_url": oss_word_url,
                    "oss_md_url": oss_md_url,
                })

            except Exception:
                traceback.print_exc()
                all_warnings.append(f"处理文件 {md_path} 失败")
                continue

        if not results:
            return {"status": "error", "data": {"filename": zip_filename, "download_url": None}}

        if len(results) == 1:
            return {"status": "ok", "data": results[0]}
        return {"status": "ok", "data": results}

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

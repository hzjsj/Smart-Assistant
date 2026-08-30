import os
import re
import uuid
import shutil
import requests
import pypandoc
import alibabacloud_oss_v2 as oss
from datetime import datetime
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv()

OSS_BUCKET = os.getenv("OSS_BUCKET", "kdsa")
OSS_REGION = os.getenv("OSS_REGION", "cn-shanghai")
OSS_ENDPOINT = os.getenv("OSS_ENDPOINT", "oss-cn-shanghai.aliyuncs.com")
OSS_UPLOAD_MAX_WORKERS = int(os.getenv("OSS_UPLOAD_MAX_WORKERS", "5"))
OSS_UPLOAD_RETRIES = int(os.getenv("OSS_UPLOAD_RETRIES", "3"))
OSS_DOWNLOAD_TIMEOUT = int(os.getenv("OSS_DOWNLOAD_TIMEOUT", "30"))

_OSS_CLIENT = None
_TEMPLATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template.docx")


def _generate_timestamp() -> str:
    return datetime.now().strftime('%Y%m%d%H%M%S')


def _get_oss_client():
    global _OSS_CLIENT
    if _OSS_CLIENT is None:
        credentials_provider = oss.credentials.EnvironmentVariableCredentialsProvider()
        cfg = oss.config.load_default()
        cfg.credentials_provider = credentials_provider
        cfg.region = OSS_REGION
        cfg.endpoint = OSS_ENDPOINT
        _OSS_CLIENT = oss.Client(cfg)
    return _OSS_CLIENT


def _guess_extension(content_type: str, url: str) -> str:
    ext_map = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
        "image/webp": ".webp", "image/svg+xml": ".svg", "image/bmp": ".bmp",
        "image/tiff": ".tiff", "image/avif": ".avif",
    }
    if content_type in ext_map:
        return ext_map[content_type]
    url_path = url.split("?")[0].rstrip("/")
    ext = os.path.splitext(url_path)[1].lower()
    if ext in ext_map.values():
        return ext
    return ".jpg"


def oss_object_exists(object_key: str) -> bool:
    client = _get_oss_client()
    return client.is_object_exist(OSS_BUCKET, object_key)


def _make_url(object_key: str) -> str:
    return f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{object_key}"


def upload_to_oss(local_file_path: str, object_key: str = None) -> dict:
    if object_key is None:
        object_key = os.path.basename(local_file_path)

    if oss_object_exists(object_key):
        return {"url": _make_url(object_key), "object_key": object_key, "bucket": OSS_BUCKET, "cached": True}

    client = _get_oss_client()
    result = client.put_object_from_file(
        oss.PutObjectRequest(bucket=OSS_BUCKET, key=object_key),
        local_file_path,
    )
    url = _make_url(object_key)
    return {
        "status_code": result.status_code,
        "request_id": result.request_id,
        "etag": result.etag,
        "content_md5": result.content_md5,
        "hash_crc64": result.hash_crc64,
        "url": url,
        "object_key": object_key,
        "bucket": OSS_BUCKET,
    }


def upload_url_to_oss(image_url: str, object_key: str = None, retries: int = None) -> dict:
    if object_key and oss_object_exists(object_key):
        return {"url": _make_url(object_key), "object_key": object_key, "bucket": OSS_BUCKET, "source_url": image_url, "cached": True}

    retries = retries if retries is not None else OSS_UPLOAD_RETRIES

    for attempt in range(retries):
        try:
            response = requests.get(image_url, timeout=OSS_DOWNLOAD_TIMEOUT)
            response.raise_for_status()
            break
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
    else:
        raise RuntimeError(f"下载失败: {image_url}")

    if object_key is None:
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
        ext = _guess_extension(content_type, image_url)
        object_key = uuid.uuid4().hex + ext

    client = _get_oss_client()
    result = client.put_object(oss.PutObjectRequest(
        bucket=OSS_BUCKET,
        key=object_key,
        body=response.content,
    ))
    url = _make_url(object_key)
    return {
        "status_code": result.status_code,
        "request_id": result.request_id,
        "etag": result.etag,
        "content_md5": result.content_md5,
        "hash_crc64": result.hash_crc64,
        "url": url,
        "object_key": object_key,
        "bucket": OSS_BUCKET,
        "source_url": image_url,
    }


_MD_IMAGE_PATTERN = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
_HTML_IMG_PATTERN = re.compile(r'<img\s[^>]*src=["\']([^"\']+)["\']', re.IGNORECASE)


def _is_oss_url(url: str) -> bool:
    return url.startswith(f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/")


def _transfer_one(image_url: str, timestamp: str) -> dict:
    try:
        content_type = None
        # 先下载获取 Content-Type 用于生成 object_key
        for attempt in range(OSS_UPLOAD_RETRIES):
            try:
                response = requests.get(image_url, timeout=OSS_DOWNLOAD_TIMEOUT)
                response.raise_for_status()
                content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
                break
            except requests.RequestException:
                if attempt == OSS_UPLOAD_RETRIES - 1:
                    raise

        ext = _guess_extension(content_type, image_url)
        object_key = f"images/{timestamp}/{uuid.uuid4().hex}{ext}"

        result = upload_url_to_oss(image_url, object_key)
        return {
            "success": True,
            "original_url": image_url,
            "oss_url": result["url"],
            "object_key": result["object_key"],
            "etag": result["etag"],
        }
    except Exception as e:
        return {
            "success": False,
            "original_url": image_url,
            "error": str(e),
        }


def upload_bytes_to_oss(data: bytes, object_key: str) -> dict:
    client = _get_oss_client()
    result = client.put_object(oss.PutObjectRequest(
        bucket=OSS_BUCKET,
        key=object_key,
        body=data,
    ))
    url = f"https://{OSS_BUCKET}.{OSS_ENDPOINT}/{object_key}"
    return {
        "status_code": result.status_code,
        "request_id": result.request_id,
        "etag": result.etag,
        "content_md5": result.content_md5,
        "hash_crc64": result.hash_crc64,
        "url": url,
        "object_key": object_key,
        "bucket": OSS_BUCKET,
    }


def transfer_md_images(md_content: str, filename: str = None) -> dict:
    timestamp = _generate_timestamp()

    seen_urls = set()
    url_list = []

    for _, url in _MD_IMAGE_PATTERN.findall(md_content):
        if url not in seen_urls and not _is_oss_url(url):
            seen_urls.add(url)
            url_list.append(url)

    for url in _HTML_IMG_PATTERN.findall(md_content):
        if url not in seen_urls and not _is_oss_url(url):
            seen_urls.add(url)
            url_list.append(url)

    replacements = []
    failed = []

    with ThreadPoolExecutor(max_workers=OSS_UPLOAD_MAX_WORKERS) as executor:
        futures = {executor.submit(_transfer_one, url, timestamp): url for url in url_list}
        for future in as_completed(futures):
            result = future.result()
            if result["success"]:
                replacements.append({
                    "original_url": result["original_url"],
                    "oss_url": result["oss_url"],
                    "object_key": result["object_key"],
                    "etag": result["etag"],
                })
            else:
                failed.append({
                    "url": result["original_url"],
                    "error": result["error"],
                })

    new_content = md_content
    for r in sorted(replacements, key=lambda x: len(x["original_url"]), reverse=True):
        new_content = new_content.replace(r["original_url"], r["oss_url"])

    # 将替换后的MD文件上传到OSS，文件名保持不变，路径：md/{timestamp}/{filename}
    safe_name = re.sub(r'[^\w\-.]', '_', filename) if filename else f"{uuid.uuid4().hex}.md"
    md_object_key = f"md/{timestamp}/{safe_name}"

    md_upload = upload_bytes_to_oss(new_content.encode("utf-8"), md_object_key)

    return {
        "total_images": len(seen_urls),
        "transferred": len(replacements),
        "failed": len(failed),
        "replacements": replacements,
        "failed_details": failed,
        "filename": filename or "",
        "md_url": md_upload["url"],
        "md_object_key": md_upload["object_key"],
    }


def convert_md_file_to_docx(md_file_path: str, filename: str = None, resource_path: str = None, oss_prefix: str = "docx") -> dict:
    """本地 .md 文件路径 → 转 .docx → 上传 OSS，返回后删除本地 docx 临时文件。"""
    timestamp = _generate_timestamp()
    tmp_dir = os.path.join("/tmp", f"md2docx_{timestamp}")
    os.makedirs(tmp_dir, exist_ok=True)

    tmp_docx = os.path.join(tmp_dir, "output.docx")

    try:
        extra_args = []
        if os.path.exists(_TEMPLATE_PATH):
            extra_args = ["--reference-doc", _TEMPLATE_PATH]
        if resource_path:
            extra_args.append(f"--resource-path={resource_path}")

        pypandoc.convert_file(
            md_file_path,
            "docx",
            outputfile=tmp_docx,
            extra_args=extra_args,
        )

        if filename:
            docx_name = os.path.splitext(filename)[0] + ".docx"
        else:
            docx_name = f"{uuid.uuid4().hex}.docx"
        object_key = f"{oss_prefix}/{timestamp}/{docx_name}"

        result = upload_to_oss(tmp_docx, object_key)

        return {
            "filename": filename or "",
            "url": result["url"],
        }
    finally:
        for f in [tmp_docx]:
            if os.path.exists(f):
                os.remove(f)
        if os.path.isdir(tmp_dir):
            os.rmdir(tmp_dir)


def convert_md_to_docx(md_content: str, filename: str = None) -> dict:
    timestamp = _generate_timestamp()
    tmp_dir = os.path.join("/tmp", f"md2docx_{timestamp}")
    os.makedirs(tmp_dir, exist_ok=True)

    tmp_md = os.path.join(tmp_dir, "input.md")
    tmp_docx = os.path.join(tmp_dir, "output.docx")

    try:
        with open(tmp_md, "w", encoding="utf-8") as f:
            f.write(md_content)

        extra_args = []
        if os.path.exists(_TEMPLATE_PATH):
            extra_args = ["--reference-doc", _TEMPLATE_PATH]

        pypandoc.convert_file(
            tmp_md,
            "docx",
            outputfile=tmp_docx,
            extra_args=extra_args,
        )

        safe_name = re.sub(r'[^\w\-.]', '_', filename) if filename else f"{uuid.uuid4().hex}.md"
        docx_name = os.path.splitext(safe_name)[0] + ".docx"
        object_key = f"docx/{timestamp}/{docx_name}"

        result = upload_to_oss(tmp_docx, object_key)

        return {
            "filename": filename or "",
            "url": result["url"],
        }
    finally:
        for f in [tmp_md, tmp_docx]:
            if os.path.exists(f):
                os.remove(f)
        if os.path.isdir(tmp_dir):
            os.rmdir(tmp_dir)


def convert_word_url_to_md(word_url: str, filename: str = None) -> dict:
    timestamp = _generate_timestamp()
    tmp_dir = os.path.join("/tmp", f"word2md_{timestamp}")
    os.makedirs(tmp_dir, exist_ok=True)

    tmp_docx = os.path.join(tmp_dir, "input.docx")
    tmp_md = os.path.join(tmp_dir, "output.md")
    extract_dir = os.path.join(tmp_dir, "media")

    try:
        for attempt in range(OSS_UPLOAD_RETRIES):
            try:
                resp = requests.get(word_url, timeout=OSS_DOWNLOAD_TIMEOUT)
                resp.raise_for_status()
                break
            except requests.RequestException:
                if attempt == OSS_UPLOAD_RETRIES - 1:
                    raise

        with open(tmp_docx, "wb") as f:
            f.write(resp.content)

        pypandoc.convert_file(
            tmp_docx, "md", outputfile=tmp_md,
            extra_args=[f"--extract-media={extract_dir}"],
        )

        with open(tmp_md, "r", encoding="utf-8") as f:
            md_content = f.read()

        media_dir = os.path.join(extract_dir, "media")
        image_url_map = {}

        if os.path.isdir(media_dir):
            for root, dirs, files in os.walk(media_dir):
                for fname in files:
                    local_img = os.path.join(root, fname)
                    oss_key = f"images/{timestamp}/{fname}"
                    result = upload_to_oss(local_img, oss_key)
                    image_url_map[fname] = result["url"]

        if image_url_map:
            def _replace_figure(match):
                tag = match.group(0)
                src_match = re.search(r'src="([^"]*)"', tag)
                caption_match = re.search(r'<figcaption[^>]*><p>([^<]*)</p></figcaption>', tag)
                if not src_match:
                    return tag
                fname = os.path.basename(src_match.group(1))
                alt = caption_match.group(1) if caption_match else ""
                oss_url = image_url_map.get(fname)
                return f"![{alt}]({oss_url})" if oss_url else tag

            md_content = re.sub(r'<figure>.*?</figure>', _replace_figure, md_content, flags=re.DOTALL)

            def _replace_img_tag(match):
                tag = match.group(0)
                src_match = re.search(r'src="([^"]*)"', tag)
                alt_match = re.search(r'alt="([^"]*)"', tag)
                if not src_match:
                    return tag
                fname = os.path.basename(src_match.group(1))
                alt = alt_match.group(1) if alt_match else ""
                oss_url = image_url_map.get(fname)
                return f"![{alt}]({oss_url})" if oss_url else tag

            md_content = re.sub(r'<img\s[^>]*/?>', _replace_img_tag, md_content, flags=re.DOTALL)

            def _replace_md_image(match):
                alt = match.group(1)
                path = match.group(2)
                fname = os.path.basename(path)
                oss_url = image_url_map.get(fname)
                return f"![{alt}]({oss_url})" if oss_url else match.group(0)

            md_content = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?', _replace_md_image, md_content)

            md_content = re.sub(r'</?figure[^>]*>', '', md_content)
            md_content = re.sub(r'<figcaption[^>]*>.*?</figcaption>', '', md_content, flags=re.DOTALL)
            md_content = re.sub(r'\n{3,}', '\n\n', md_content)

        safe_name = re.sub(r'[^\w\-.]', '_', filename) if filename else f"{uuid.uuid4().hex}.docx"
        md_name = os.path.splitext(safe_name)[0] + ".md"
        md_object_key = f"markdown/{timestamp}/{md_name}"

        md_upload = upload_bytes_to_oss(md_content.encode("utf-8"), md_object_key)

        return {
            "filename": filename or "",
            "url": md_upload["url"],
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

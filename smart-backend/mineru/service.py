"""mineru 解析服务：与上游 MinerU API 的对接 + 结果 zip 处理。

- ``submit_task_to_mineru``  — 提交 PDF/URL 给 MinerU
- ``process_mineru_zip``     — 下载结果 zip → 修图片路径 → 转 Word → 上 OSS
- ``handle_mineru_done``     — 回调里调用：联动 ``files.FileRecord`` 状态更新

注：文件记录目前仍存于 ``files.FileRecord`` 上（``mineru_task_id`` / ``mineru_state`` /
``mineru_zip_url`` 三个列），属历史偏离项，详见 ``docs/db_known_deviations.md``。
"""

import os
import re
import shutil
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional

import requests

from database import get_sync_db
from documents import crud
from documents.knowledge import (
    build_image_index,
    extract_zip,
    find_md_files,
    fix_md_image_paths,
)
from utils.oss_upload import (
    convert_md_file_to_docx,
    upload_bytes_to_oss,
    upload_to_oss,
)


# ─── 配置（运行时读取） ─────────────────────────────────────────────────
# 凭据通过 configs.service.get_active_mineru_config() 在调用时获取，
# 支持管理员经 /api/configs 切换激活而不需要重启服务。


# ─── 提交任务 ─────────────────────────────────────────────────────────
def get_mineru_config() -> dict:
    """返回 ``{token, uid, seed, callback_url}``，从 .env 读取。"""
    import os

    return {
        "token": os.getenv("MINERU_TOKEN", ""),
        "uid": os.getenv("MINERU_UID", ""),
        "seed": os.getenv("MINERU_SEED", ""),
        "callback_url": os.getenv("MINERU_CALLBACK_URL", ""),
    }


def submit_task_to_mineru(pdf_url: str) -> dict:
    """提交文档到 MinerU 进行解析，返回 ``{"task_id": "..."}``。失败抛出异常。"""
    cfg = get_mineru_config()
    url = "https://mineru.net/api/v4/extract/task"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg['token']}",
    }
    payload = {
        "url": pdf_url,
        "model_version": "vlm",
        "is_ocr": True,
        "seed": cfg["seed"],
        "callback": cfg["callback_url"],
    }
    res = requests.post(url, headers=headers, json=payload, timeout=10.0)
    res.raise_for_status()
    res_data = res.json()
    if res_data.get("code") != 0:
        raise RuntimeError(f"MinerU error: {res_data.get('msg')}")
    return {"task_id": res_data["data"]["task_id"]}


# ─── 结果 zip 处理（复用 files.knowledge） ────────────────────────────
def process_mineru_zip(
    zip_url: str, task_id: str, original_name: str = "full"
) -> Optional[dict]:
    """下载 MinerU 结果 zip → 解压 → 修复图片路径 → 转 Word 上传 OSS
    → 图片转存 OSS 替换引用 → MD 上传 OSS。

    返回 ``{oss_md_url, oss_word_url, oss_images, download_url, md_download_url}``，失败返回 None。
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    temp_dir = f"/tmp/mineru_{timestamp}_{uuid.uuid4().hex}"
    extract_dir = os.path.join(temp_dir, "extracted")

    try:
        # 1. 下载 zip
        os.makedirs(extract_dir, exist_ok=True)
        resp = requests.get(zip_url, timeout=120)
        resp.raise_for_status()
        zip_path = os.path.join(temp_dir, "result.zip")
        with open(zip_path, "wb") as f:
            f.write(resp.content)

        # 2. 解压（复用 knowledge.py，自动处理中文编码 + 防路径穿越）
        extract_zip(zip_path, extract_dir)

        # 3. 构建图片索引
        image_index = build_image_index(extract_dir)

        # 4. 查找 .md 文件（优先 full.md）
        md_files = find_md_files(extract_dir)
        if not md_files:
            print(f"[MinerU] 任务 {task_id}: zip 中未找到 .md 文件")
            return None

        md_path = next(
            (f for f in md_files if os.path.basename(f) == "full.md"),
            md_files[0],
        )
        md_dir = os.path.dirname(md_path)
        # 使用用户上传的原始文件名作为输出文件名
        name_base = os.path.splitext(original_name)[0]
        md_filename = f"{name_base}.md"

        # 5. 读取并修复图片路径
        with open(md_path, "r", encoding="utf-8") as f:
            md_content = f.read()

        fixed_content, used_images, fix_warnings = fix_md_image_paths(
            md_content, md_dir, image_index
        )
        for w in fix_warnings:
            print(f"[MinerU] 警告: {w}")

        # 6. 将修复后的内容写回文件（pypandoc 需要正确路径才能嵌入图片到 docx）
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(fixed_content)

        # 7. 转 Word 并上传 OSS
        docx_result = convert_md_file_to_docx(
            md_path,
            filename=md_filename,
            resource_path=md_dir,
            oss_prefix="mineru/docx",
        )
        oss_word_url = docx_result["url"]

        # 8. 并发上传图片到 OSS（去重）
        uploaded_images: dict[str, str] = {}
        if used_images:
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for img_local_path in used_images:
                    if img_local_path not in uploaded_images:
                        img_fname = os.path.basename(img_local_path)
                        oss_key = f"mineru/images/{timestamp}/{img_fname}"
                        futures[
                            executor.submit(upload_to_oss, img_local_path, oss_key)
                        ] = img_local_path
                for future in as_completed(futures):
                    img_local_path = futures[future]
                    try:
                        uploaded_images[img_local_path] = future.result()["url"]
                    except Exception:
                        traceback.print_exc()

        # 9. 替换 MD 中图片路径为 OSS URL
        md_with_oss_urls = fixed_content
        for img_local_path, oss_url in uploaded_images.items():
            img_fname = os.path.basename(img_local_path)
            md_with_oss_urls = re.sub(
                rf"(!\[[^\]]*\]\()[^)]*{re.escape(img_fname)}(\))",
                rf"\g<1>{oss_url}\2",
                md_with_oss_urls,
            )
            md_with_oss_urls = re.sub(
                rf"(src=[\"\'])[^\"\']*{re.escape(img_fname)}([\"\'])",
                rf"\g<1>{oss_url}\2",
                md_with_oss_urls,
            )

        # 10. 上传最终 MD 到 OSS
        oss_md_key = f"mineru/markdown/{timestamp}/{md_filename}"
        md_upload = upload_bytes_to_oss(md_with_oss_urls.encode("utf-8"), oss_md_key)
        oss_md_url = md_upload["url"]

        oss_images_str = ",".join(uploaded_images.values()) if uploaded_images else None

        return {
            "oss_md_url": oss_md_url,
            "oss_word_url": oss_word_url,
            "oss_images": oss_images_str,
            "download_url": oss_md_url,
            "md_download_url": oss_md_url,
        }

    except Exception:
        traceback.print_exc()
        return None
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ─── 后台处理：联动 FileRecord ────────────────────────────────────────
def handle_mineru_done(record_id: int, full_zip_url: str):
    """后台线程：下载 MinerU zip → 处理 → 更新 ``FileRecord``。"""
    db = get_sync_db()
    try:
        record = crud.get_file_record(db, record_id)
        original_name = record.original_name if record else "full"
        result = process_mineru_zip(full_zip_url, str(record_id), original_name)
        if result:
            crud.update_file_record_mineru(
                db, record_id,
                mineru_state="done",
                mineru_zip_url=full_zip_url,
                oss_md_url=result["oss_md_url"],
                oss_word_url=result.get("oss_word_url"),
                oss_images=result.get("oss_images"),
                download_url=result["download_url"],
                md_download_url=result["md_download_url"],
            )
            print(f"[MinerU] 记录 {record_id} 更新成功: oss_md_url={result['oss_md_url']}")
        else:
            crud.update_file_record_mineru(db, record_id, mineru_state="error")
            print(f"[MinerU] 记录 {record_id} zip 处理失败")
    except Exception:
        traceback.print_exc()
        crud.update_file_record_mineru(db, record_id, mineru_state="error")
    finally:
        db.close()

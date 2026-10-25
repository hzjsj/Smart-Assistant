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
import subprocess
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import requests

from database import get_sync_db
from documents import crud
from documents.knowledge import (
    build_image_index,
    extract_zip,
    find_md_files,
    fix_md_image_paths,
)
from mineru.fix_docx import EMU_PER_PT, fix_docx_image_sizes
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


def submit_task_to_mineru(
    pdf_url: str,
    *,
    model_version: str = "vlm",
    is_ocr: bool = True,
    enable_formula: bool = True,
    enable_table: bool = True,
    language: str = "ch",
    page_ranges: Optional[str] = None,
) -> dict:
    """提交文档到 MinerU 进行解析，返回 ``{"task_id": "..."}``。失败抛出异常。

    模型参数与 MinerU 精准解析 API 对齐；默认值保持原线上行为（vlm + OCR）。
    """
    cfg = get_mineru_config()
    url = "https://mineru.net/api/v4/extract/task"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg['token']}",
    }
    payload = {
        "url": pdf_url,
        "model_version": model_version,
        "is_ocr": is_ocr,
        "enable_formula": enable_formula,
        "enable_table": enable_table,
        "language": language,
        "seed": cfg["seed"],
        "callback": cfg["callback_url"],
        # MinerU 平台原生生成 full.docx / full.html（版式/公式还原优于本地 pandoc），
        # 结果 zip 内会附带 full.docx + full.html + layout.json（图片真实尺寸修复用）
        "extra_formats": ["docx", "html"],
    }
    if page_ranges:
        payload["page_ranges"] = page_ranges
    res = requests.post(url, headers=headers, json=payload, timeout=10.0)
    res.raise_for_status()
    res_data = res.json()
    if res_data.get("code") != 0:
        raise RuntimeError(f"MinerU error: {res_data.get('msg')}")
    return {"task_id": res_data["data"]["task_id"]}


# ─── 结果 zip 处理（复用 files.knowledge） ────────────────────────────

def _download_zip_robust(zip_url: str, dest: str) -> None:
    """下载结果 zip 到 dest。

    直连失败时兜底：本机代理（fake-ip 模式）劫持国内 CDN 域名的 DNS 会导致
    TLS 被重置（cdn-mineru.openxlab.org.cn 常见），此时用阿里 DoH 解析真实 IP，
    curl --resolve 绕过代理直连。参考 mineru_client.py 的同名兜底逻辑。
    """
    try:
        resp = requests.get(zip_url, timeout=120)
        resp.raise_for_status()
        with open(dest, "wb") as f:
            f.write(resp.content)
        return
    except requests.RequestException as e:
        print(f"[MinerU] zip 直连下载失败（{e}），尝试 DoH 解析真实 IP 绕过代理...")

    host = urlparse(zip_url).hostname or ""
    real_ip = None
    try:
        r = requests.get(
            "https://dns.alidns.com/resolve",
            params={"name": host, "type": "A"},
            timeout=10,
        )
        for ans in r.json().get("Answer", []):
            if ans.get("type") == 1 and not str(ans["data"]).startswith("198.18."):
                real_ip = ans["data"]
                break
    except requests.RequestException:
        pass
    if not real_ip:
        raise RuntimeError(f"zip 下载失败，且无法通过 DoH 解析 {host} 的真实 IP")

    print(f"[MinerU] 绕过代理直连真实 IP {real_ip} 下载...")
    subprocess.run(
        ["curl", "-sS", "--resolve", f"{host}:443:{real_ip}", "-o", dest, zip_url],
        check=True,
    )


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
        # 1. 下载 zip（含代理环境 DoH 兜底）
        os.makedirs(extract_dir, exist_ok=True)
        zip_path = os.path.join(temp_dir, "result.zip")
        _download_zip_robust(zip_url, zip_path)

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

        # 7. Word：优先用 MinerU 原生 docx（extra_formats 生成）+ layout.json 修复图片真实尺寸；
        #    zip 中缺失时兜底走本地 pandoc 转换（兼容历史任务/平台行为变化）
        native_docx = os.path.join(md_dir, "full.docx")
        layout_json = os.path.join(md_dir, "layout.json")
        if os.path.exists(native_docx) and os.path.exists(layout_json):
            fixed_docx = os.path.join(temp_dir, "full_real_size.docx")
            changes = fix_docx_image_sizes(
                native_docx, layout_json, os.path.join(md_dir, "images"), fixed_docx
            )
            for c in changes:
                old_pt = (
                    f"{c['old_emu'][0] / EMU_PER_PT:.0f}x{c['old_emu'][1] / EMU_PER_PT:.0f}pt"
                    if c["old_emu"] else "?"
                )
                print(
                    f"[MinerU] {task_id}: {c['image_path']} {old_pt} -> "
                    f"{c['new_wh_pt'][0]:.0f}x{c['new_wh_pt'][1]:.0f}pt"
                )
            oss_word_key = f"mineru/docx/{timestamp}/{name_base}.docx"
            oss_word_url = upload_to_oss(fixed_docx, oss_word_key)["url"]
        else:
            print(f"[MinerU] {task_id}: zip 无原生 docx，回退 pandoc 转换")
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

        # 11. 上传 HTML（extra_formats 生成时）。MinerU 的 full.html 是自包含单文件
        #     （图片以 data:image base64 内嵌），浏览器可直接打开预览；此处仍做一次
        #     图片引用替换以防平台未来改为相对路径引用。
        oss_html_url = None
        html_path = os.path.join(md_dir, "full.html")
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as f:
                html_content = f.read()
            for img_local_path, oss_img_url in uploaded_images.items():
                img_fname = os.path.basename(img_local_path)
                html_content = re.sub(
                    rf"(src=[\"\'])[^\"\']*{re.escape(img_fname)}([\"\'])",
                    rf"\g<1>{oss_img_url}\2",
                    html_content,
                )
            oss_html_key = f"mineru/html/{timestamp}/{name_base}.html"
            oss_html_url = upload_bytes_to_oss(
                html_content.encode("utf-8"), oss_html_key
            )["url"]

        oss_images_str = ",".join(uploaded_images.values()) if uploaded_images else None

        return {
            "oss_md_url": oss_md_url,
            "oss_word_url": oss_word_url,
            "oss_html_url": oss_html_url,
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
                oss_html_url=result.get("oss_html_url"),
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


# ─── 轮询兜底：主动向 MinerU 同步 submitted 任务状态 ──────────────────
# 回调丢失（本机 dev 回调地址不可达、平台故障）时任务会永久停在 submitted。
# 任务列表被拉取时在后台向 MinerU 查询真实状态并推进，与回调链路殊途同归：
# done → 复用 handle_mineru_done 下载产物落库；failed → 直接落库 error。

_sync_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mineru-sync")
# 进程内去重：避免前端轮询期间对同一记录重复触发处理
_syncing_ids: set[int] = set()


def _fetch_task_state(task_id: str) -> Optional[dict]:
    """查询 MinerU 平台任务真实状态，返回 ``{state, err_msg, full_zip_url}``，失败返回 None。"""
    cfg = get_mineru_config()
    url = f"https://mineru.net/api/v4/extract/task/{task_id}"
    try:
        res = requests.get(
            url,
            headers={"Authorization": f"Bearer {cfg['token']}"},
            timeout=8.0,
        )
        res.raise_for_status()
        data = res.json()
        if data.get("code") == 0:
            return data.get("data") or {}
        print(f"[MinerU] 轮询查询 {task_id} 失败: {data.get('msg')}")
    except Exception:
        traceback.print_exc()
    return None


def sync_submitted_tasks(task_dicts: list[dict]) -> None:
    """后台向 MinerU 同步 submitted 任务的真实状态（fire-and-forget，不阻塞调用方）。

    传入任务列表接口当前页的数据行；只处理 ``mineru_state == submitted`` 且有
    ``mineru_task_id`` 的行。状态变化由前端轮询自然呈现（下一轮拉取可见）。
    """
    pending = [
        t
        for t in task_dicts
        if t.get("mineru_state") == "submitted"
        and t.get("mineru_task_id")
        and t.get("id") not in _syncing_ids
    ]
    if not pending:
        return

    def _run():
        for t in pending:
            record_id = t["id"]
            task_id = t["mineru_task_id"]
            if record_id in _syncing_ids:
                continue
            _syncing_ids.add(record_id)
            try:
                state = _fetch_task_state(task_id)
                if not state:
                    continue
                if state.get("state") == "done" and state.get("full_zip_url"):
                    print(f"[MinerU] 轮询发现任务 {task_id} 已完成，触发结果处理")
                    handle_mineru_done(record_id, state["full_zip_url"])
                elif state.get("state") == "failed":
                    db = get_sync_db()
                    try:
                        crud.update_file_record_mineru(
                            db, record_id, mineru_state="error"
                        )
                    finally:
                        db.close()
                    print(
                        f"[MinerU] 轮询发现任务 {task_id} 失败: {state.get('err_msg')}"
                    )
                # running / waiting 等中间态：不动，等下一轮
            except Exception:
                traceback.print_exc()
            finally:
                _syncing_ids.discard(record_id)

    _sync_executor.submit(_run)


def _generate_html_from_md(record: dict) -> Optional[str]:
    """历史任务兜底：pandoc 把已转存 OSS 的 Markdown 转成 standalone HTML 并落库。

    用于 ``extra_formats`` 上线前解析的任务（zip 内无 full.html），
    让预览统一为 HTML 页面而非裸 Markdown 源码。
    """
    import pypandoc

    resp = requests.get(record["oss_md_url"], timeout=30)
    resp.raise_for_status()
    # OSS 的 .md 响应头无 charset，requests 默认按 ISO-8859-1 解码会产生乱码
    resp.encoding = "utf-8"
    html = pypandoc.convert_text(
        resp.text,
        "html",
        format="markdown",
        extra_args=["--standalone", "--mathml", "--metadata", "charset=utf-8"],
    )
    name_base = os.path.splitext(record["original_name"])[0]
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    oss_key = f"mineru/html/{timestamp}/{name_base}.html"
    url = upload_bytes_to_oss(html.encode("utf-8"), oss_key)["url"]

    db = get_sync_db()
    try:
        crud.update_file_record_mineru(db, int(record["id"]), oss_html_url=url)
    finally:
        db.close()
    return url


def ensure_html_preview(task_dicts: list[dict]) -> None:
    """后台补齐 done 任务缺失的 HTML 预览（fire-and-forget，复用同步线程池与去重）。

    新任务由 extra_formats 原生生成 full.html；此处只处理历史任务
    （``mineru_state=done`` 且有 MD 无 HTML）。
    """
    pending = [
        t
        for t in task_dicts
        if t.get("mineru_state") == "done"
        and t.get("oss_md_url")
        and not t.get("oss_html_url")
        and t.get("id") not in _syncing_ids
    ]
    if not pending:
        return

    def _run():
        for t in pending:
            record_id = t["id"]
            if record_id in _syncing_ids:
                continue
            _syncing_ids.add(record_id)
            try:
                url = _generate_html_from_md(t)
                if url:
                    print(f"[MinerU] 记录 {record_id}: 已补生成 HTML 预览 {url}")
            except Exception:
                traceback.print_exc()
            finally:
                _syncing_ids.discard(record_id)

    _sync_executor.submit(_run)

"""Open WebUI 兼容网关：以 MinerU Cloud API 的接口形态对外，内部走自有解析链路。

Open WebUI 配置 ``MINERU_API_URL={BASE}/api/mineru/proxy`` 后无感知接入：
- ``POST /file-urls/batch``       申请上传链接（file_urls 指向本服务，使上传经手
                                  我们——这是启用超限大文件平分拆分的前提）
- ``PUT /upload/{batch}/{i}``     接收文件字节，复用 documents 的上传处理
                                  （小文件单任务 / 超限拆分批量自动分流）
- ``GET /extract-results/batch/{id}``  按 MinerU 格式聚合状态（顺带触发轮询
                                  自愈推进），done 项改写 full_zip_url 指向本服务
- ``GET /zip/{record_id}``        返回结果 zip（full.md，图片已是 OSS 永久外链）
- 其余任意路径                     透传 https://mineru.net/api/v4/* 保底兼容

鉴权：申请上传 URL 与透传接口校验 ``Authorization: Bearer``；预签名上传、轮询、
结果下载不鉴权（Open WebUI 这些请求不携带 API Key）。
batch 与记录的关联存内存映射（重启丢失仅导致重新上传）。
"""

import os
import re
import tempfile
import uuid
from datetime import datetime

import httpx
import requests as _requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse

from database import get_sync_db
from documents import crud
from documents.router import _process_mineru_upload
from mineru.service import get_mineru_config, sync_submitted_tasks

router = APIRouter(prefix="/api/mineru/proxy", tags=["MinerU Open WebUI 网关"])

UPSTREAM = "https://mineru.net/api/v4"
# 允许的源 ZIP 域名后缀（302 回退用，防开放中继）
ZIP_HOST_ALLOWLIST = ("openxlab.org.cn", "aliyuncs.com", "mineru.net")

# batch_id -> {"names": [...], "record_ids": [...]}（内存映射，重启即失效）
_BATCHES: dict[str, dict] = {}


def _public_base() -> str:
    return (os.getenv("MINERU_PROXY_PUBLIC_BASE") or "http://127.0.0.1:5000").rstrip("/")


def _check_token(request: Request) -> None:
    """校验 Bearer token。

    Open WebUI 各版本的头格式不一（Bearer x / bearer x / Token x / 裸 token），
    统一做宽松解析：取 scheme 后的裸值与 MINERU_TOKEN 比对。错误信息带上收到的
    头片段，便于排查 Open WebUI 后台配置的 key 与 .env 不一致的问题。
    """
    cfg = get_mineru_config()
    auth = (request.headers.get("authorization") or "").strip()
    m = re.match(r"^(\S+)\s+(.+)$", auth)
    provided = m.group(2).strip() if m else auth  # 有 scheme 取值，否则整串视为 token
    if provided and provided == cfg["token"]:
        return
    hint = f"收到 Authorization={auth[:20]}... " if auth else "收到请求无 Authorization 头 "
    raise HTTPException(
        status_code=401,
        detail=f"Invalid API token. {hint}— 请确认 Open WebUI 的 MINERU_API_KEY "
        "与后端 .env 的 MINERU_TOKEN 完全一致",
    )


@router.post("/file-urls/batch")
async def apply_upload_urls(request: Request):
    """① 申请批量上传链接（兼容 /api/v4/file-urls/batch）。

    与 MinerU 的差异仅在 file_urls 指向本服务——Open WebUI 随后把文件 PUT 到
    我们这里，得以复用自有链路（含超限拆分）。
    """
    _check_token(request)
    body = await request.json()
    files = (body or {}).get("files") or []
    names = [str(f.get("name") or f"file{i}") for i, f in enumerate(files)]
    if not names:
        raise HTTPException(status_code=400, detail="files 不能为空")

    batch_id = uuid.uuid4().hex
    _BATCHES[batch_id] = {"names": names, "record_ids": []}
    base = _public_base()
    return {
        "code": 0,
        "data": {
            "batch_id": batch_id,
            "file_urls": [
                f"{base}/api/mineru/proxy/upload/{batch_id}/{i}" for i in range(len(names))
            ],
        },
        "msg": "ok",
    }


@router.put("/upload/{batch_id}/{index}")
async def receive_upload(batch_id: str, index: int, request: Request):
    """② 接收预签名 URL 的文件字节（无 Authorization），复用自有上传处理。"""
    batch = _BATCHES.get(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Unknown batch (服务可能已重启，请重新申请)")
    if index < 0 or index >= len(batch["names"]):
        raise HTTPException(status_code=400, detail=f"index 越界: {index}")

    original_name = batch["names"][index]
    ext = os.path.splitext(original_name)[1].lower()
    content = await request.body()
    if not content:
        raise HTTPException(status_code=400, detail="空文件")

    suffix = ext if ext else ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="owui_") as f:
        f.write(content)
        tmp_path = f.name

    try:
        # 复用文档解析上传链路：小文件单任务 / 超限 PDF 平分拆分批量，自动分流
        result = _process_mineru_upload(
            tmp_path, ext, original_name,
            datetime.now().strftime("%Y%m%d%H%M%S"), uid=None,
        )
    finally:
        # _process_mineru_upload 成功路径会自行删除文件；失败兜底再清一次
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    if result.get("status") != "ok":
        detail = result.get("errorMessage") or "上传解析失败"
        raise HTTPException(status_code=400, detail=detail)

    # 占位保证顺序（record_ids 按申请顺序对应 names）
    while len(batch["record_ids"]) < index:
        batch["record_ids"].append(None)
    if index < len(batch["record_ids"]):
        batch["record_ids"][index] = result["data"]["id"]
    else:
        batch["record_ids"].append(result["data"]["id"])
    return Response(status_code=200)


# MinerU 状态 → Open WebUI 期望的 state
_STATE_MAP = {"submitted": "running", "done": "done", "error": "failed"}


@router.get("/extract-results/batch/{batch_id}")
async def poll_batch(batch_id: str):
    """③ 轮询：按 MinerU 响应格式聚合状态，不要求 Authorization。"""
    batch = _BATCHES.get(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Unknown batch (服务可能已重启)")

    db = get_sync_db()
    try:
        task_rows = []
        for i, name in enumerate(batch["names"]):
            rid = batch["record_ids"][i] if i < len(batch["record_ids"]) else None
            row = {"id": rid, "mineru_state": None, "mineru_error": None,
                   "mineru_task_id": None, "mineru_batch_id": None, "file_name": name}
            if rid is not None:
                record = crud.get_file_record(db, rid)
                if record:
                    row.update(
                        mineru_state=record.mineru_state,
                        mineru_error=record.mineru_error,
                        mineru_task_id=record.mineru_task_id,
                        mineru_batch_id=record.mineru_batch_id,
                    )
            task_rows.append(row)
    finally:
        db.close()

    # 顺带触发轮询自愈，让 submitted 记录向 MinerU 查询真实状态
    sync_submitted_tasks([r for r in task_rows if r["mineru_state"] == "submitted"])

    base = _public_base()
    extract_result = []
    for row in task_rows:
        state = _STATE_MAP.get(row["mineru_state"] or "", "pending")
        item = {"file_name": row["file_name"], "state": state, "err_msg": ""}
        # 未上传（无记录）的文件保持 waiting-file，Open WebUI 会继续轮询
        if row["id"] is None:
            item["state"] = "waiting-file"
        if state == "done":
            item["full_zip_url"] = f"{base}/api/mineru/proxy/zip/{row['id']}"
        if state == "failed":
            item["err_msg"] = row["mineru_error"] or "解析失败"
        extract_result.append(item)

    return {"code": 0, "data": {"batch_id": batch_id, "extract_result": extract_result},
            "msg": "ok"}


@router.get("/zip/{record_id}")
async def download_zip(record_id: int):
    """④ 结果 zip：通过公开结果链接下载，不要求 Authorization。"""
    db = get_sync_db()
    try:
        record = crud.get_file_record(db, record_id)
    finally:
        db.close()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.mineru_state != "done" or not record.oss_md_url:
        # 处理异常时回退原始 zip（图片为 MinerU CDN 临时链接，兜底不中断）
        if record.mineru_zip_url:
            return RedirectResponse(record.mineru_zip_url)
        raise HTTPException(status_code=404, detail="结果尚未就绪")

    resp = _requests.get(record.oss_md_url, timeout=60)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    md_content = resp.text

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip", prefix="owui_zip_")
    try:
        import zipfile
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            base_name = os.path.splitext(record.original_name or "full")[0]
            z.writestr(f"{base_name}.md", md_content)
        return FileResponse(tmp.name, media_type="application/zip",
                            filename=f"{base_name}.zip")
    finally:
        # FileResponse 在响应完成后由 starlette 关闭句柄；临时文件交给系统清理，
        # 显式 unlink 放在发送之后不可行，故留作 /tmp 常规清理
        pass


_HOP_BY_HOP = {
    "host", "content-length", "connection", "keep-alive", "proxy-authenticate",
    "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade",
    "accept-encoding",
}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def passthrough(path: str, request: Request):
    """其余任意路径透传 MinerU Cloud API（归一化去掉多余的 api/v4 前缀）。"""
    _check_token(request)
    norm = path[len("api/v4/"):] if path.startswith("api/v4/") else path
    if norm.startswith(("file-urls/batch", "upload/", "extract-results/")):
        raise HTTPException(status_code=404, detail=f"路径不匹配: {path}")

    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}
    headers["accept-encoding"] = "identity"
    body = await request.body()

    async with httpx.AsyncClient(timeout=60.0) as client:
        upstream = await client.request(
            request.method, f"{UPSTREAM}/{norm}",
            headers=headers, params=request.query_params, content=body or None,
        )
    resp_headers = {
        k: v for k, v in upstream.headers.items()
        if k.lower() not in _HOP_BY_HOP and k.lower() != "content-length"
    }
    return Response(content=upstream.content, status_code=upstream.status_code,
                    headers=resp_headers, media_type=upstream.headers.get("content-type"))

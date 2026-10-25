"""mineru 领域路由。

对外端点（与拆分前完全一致）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/mineru/extract/submit         | 提交文档解析任务 |
| GET  | /api/mineru/extract/status/{task_id} | 主动查询任务状态 |
| POST | /api/mineru/callback               | 接收 MinerU 处理完成的回调 |
"""

import asyncio
import hashlib
import json
import os
import uuid
from urllib.parse import urlparse

import httpx
import requests
from fastapi import APIRouter, HTTPException, Depends, Query

from database import get_db, get_sync_db
from auth import get_current_user
from documents import crud

from mineru.schemas import CallbackRequest, SubmitRequest
from mineru.service import (
    ensure_html_preview,
    handle_mineru_done,
    submit_task_to_mineru,
    sync_submitted_tasks,
)
from mineru.service import get_mineru_config

router = APIRouter(prefix="/api/mineru", tags=["MinerU 解析模块"])


@router.post("/extract/submit", summary="提交文档解析任务")
def submit_task(
    request: SubmitRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        result = submit_task_to_mineru(
            request.pdf_url,
            model_version=request.model_version,
            is_ocr=request.is_ocr,
            enable_formula=request.enable_formula,
            enable_table=request.enable_table,
            language=request.language,
            page_ranges=request.page_ranges,
        )
        # 落库为任务记录（任务管理页可见，与文件上传解析同一张表）；
        # 后续状态推进复用任务列表接口的轮询自愈机制
        name = os.path.basename(urlparse(request.pdf_url).path) or "webpage"
        crud.create_file_record(
            db=db,
            original_name=name,
            saved_name=uuid.uuid4().hex,
            file_path="",
            file_size=0,
            download_url=request.pdf_url,
            uid=current_user.userid,
            mineru_task_id=result["task_id"],
            mineru_state="submitted",
        )
        return {"msg": "任务提交成功", "task_id": result["task_id"]}
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"请求 MinerU 失败: {str(e)}")


@router.get("/extract/status/{task_id}", summary="主动查询任务状态")
async def get_task_status(task_id: str, _user=Depends(get_current_user)):
    cfg = get_mineru_config()
    url = f"https://mineru.net/api/v4/extract/task/{task_id}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg['token']}",
    }
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(url, headers=headers, timeout=10.0)
            res.raise_for_status()
            res_data = res.json()
            if res_data.get("code") == 0:
                return res_data["data"]
            raise HTTPException(
                status_code=400, detail=f"查询失败: {res_data.get('msg')}"
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"请求 MinerU 失败: {str(e)}")


@router.post("/callback", summary="接收 MinerU 处理完成的回调")
async def callback(data: CallbackRequest):
    print(f"[MinerU] 接收回调: {data}")
    cfg = get_mineru_config()
    # 1. 签名校验
    combined_str = str(cfg["uid"]) + str(cfg["seed"]) + data.content
    expected_checksum = hashlib.sha256(combined_str.encode("utf-8")).hexdigest()
    if expected_checksum != data.checksum:
        raise HTTPException(status_code=400, detail="Checksum mismatch")

    # 2. 解析 content
    try:
        content_json = json.loads(data.content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid JSON in content")

    task_id = content_json.get("task_id")
    state = content_json.get("state")
    full_zip_url = content_json.get("full_zip_url")

    # 3. 查找对应的 FileRecord
    db = get_sync_db()
    try:
        record = crud.get_file_record_by_mineru_task_id(db, task_id)
        if not record:
            print(f"[MinerU] 回调: 未找到 task_id={task_id} 对应的记录")
            return {"msg": "ok"}

        if state == "done" and full_zip_url:
            # 异步处理 zip，立即返回
            loop = asyncio.get_event_loop()
            loop.run_in_executor(None, handle_mineru_done, record.id, full_zip_url)
            print(f"[MinerU] 任务 {task_id} 处理完成，已提交后台处理")
        else:
            err_msg = content_json.get("err_msg", "unknown error")
            crud.update_file_record_mineru(db, record.id, mineru_state="error")
            print(f"[MinerU] 任务 {task_id} 失败: {err_msg}")
    finally:
        db.close()

    return {"msg": "ok"}


@router.get("/tasks", summary="MinerU 解析任务列表（分页，供 /mineru 任务管理页）")
def list_mineru_tasks(
    current: float = Query(1, description="当前的页码"),
    pageSize: float = Query(10, description="页面的容量"),
    original_name: str | None = Query(None, description="任务名称（模糊搜索）"),
    state: str | None = Query(
        None, description="状态筛选: submitted(解析中) / done(成功) / error(失败)"
    ),
    favorite: bool | None = Query(None, description="收藏筛选：true 仅收藏 / false 仅未收藏 / 不传为全部"),
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    # 只返回当前登录用户自己提交的 MinerU 任务（mineru_task_id 非空）
    result = crud.get_mineru_tasks(
        db,
        int(current),
        int(pageSize),
        original_name=original_name,
        state=state,
        favorite=favorite,
        uid_filter=current_user.userid,
    )
    # 轮询兜底：后台向 MinerU 同步 submitted 任务的真实状态，不阻塞本次响应
    sync_submitted_tasks(result.get("data") or [])
    # 历史任务补齐：done 且无 HTML 预览的记录后台用 pandoc 生成（新任务原生有）
    ensure_html_preview(result.get("data") or [])
    return result


@router.post("/tasks/{task_id}/favorite", summary="收藏/取消收藏任务")
def toggle_task_favorite(
    task_id: int,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    record = crud.get_file_record(db, task_id)
    if not record or (record.uid and record.uid != current_user.userid):
        raise HTTPException(status_code=404, detail="任务不存在")
    record = crud.toggle_mineru_favorite(db, task_id)
    return {"id": task_id, "favorite": bool(record.favorite)}

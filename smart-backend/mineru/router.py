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

import httpx
import requests
from fastapi import APIRouter, HTTPException, Depends

from database import get_sync_db
from auth import get_current_user
from documents import crud

from mineru.schemas import CallbackRequest, SubmitRequest
from mineru.service import (
    handle_mineru_done,
    submit_task_to_mineru,
)
from mineru.service import get_mineru_config

router = APIRouter(prefix="/api/mineru", tags=["MinerU 解析模块"])


@router.post("/extract/submit", summary="提交文档解析任务")
def submit_task(request: SubmitRequest, _user=Depends(get_current_user)):
    try:
        result = submit_task_to_mineru(request.pdf_url)
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

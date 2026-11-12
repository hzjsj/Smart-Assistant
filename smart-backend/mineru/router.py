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
from fastapi import APIRouter, File, HTTPException, Depends, Query, UploadFile
from sqlalchemy.orm import Session

from database import get_db, get_sync_db
from auth import get_current_user, get_current_userid
from documents import crud

from mineru.schemas import (
    AttachmentChatRequest,
    AttachmentUploaded,
    CallbackRequest,
    SubmitRequest,
)
from mineru.models import MineruAttachment
from mineru.attachment_service import (
    delete_from_oss,
    inject_attachments,
    save_attachment,
)
from mineru.service import (
    ensure_html_preview,
    handle_mineru_done,
    submit_task_to_mineru,
    sync_submitted_tasks,
)
from mineru.service import get_mineru_config
# hermes 页面迁移：带附件聊天转发 + 会话采集落库
from conversations.crud import record_user_message
from conversations.service import stream_upstream_with_recording
from hermes.service import HermesError, open_chat_stream

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
            err_msg = str(content_json.get("err_msg") or "解析失败")
            crud.update_file_record_mineru(
                db, record.id, mineru_state="error", mineru_error=err_msg
            )
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


# ===== 聊天附件与带附件聊天（hermes 页面迁移） =====


def _attachment_response(record: MineruAttachment) -> AttachmentUploaded:
    return AttachmentUploaded(
        id=record.id,
        name=record.original_name,
        url=record.oss_url,
        size=record.file_size,
        ext=record.ext,
        created_at=record.created_at,
    )


@router.post("/attachments", response_model=AttachmentUploaded, summary="上传聊天附件")
async def upload_attachment(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    """保存附件到 OSS 并落库，返回公网 URL 供聊天请求引用。"""
    record = await save_attachment(db, user_id, file)
    return _attachment_response(record)


@router.get(
    "/attachments",
    response_model=list[AttachmentUploaded],
    summary="当前用户附件记录",
)
def list_attachments(
    limit: int = 50,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    limit = max(1, min(limit, 200))
    rows = (
        db.query(MineruAttachment)
        .filter(MineruAttachment.user_id == user_id)
        .order_by(MineruAttachment.created_at.desc(), MineruAttachment.id.desc())
        .limit(limit)
        .all()
    )
    return [_attachment_response(record) for record in rows]


@router.delete(
    "/attachments/{attachment_id}",
    status_code=204,
    summary="删除附件记录与 OSS 对象",
)
def delete_attachment(
    attachment_id: str,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    record = (
        db.query(MineruAttachment)
        .filter(
            MineruAttachment.id == attachment_id,
            MineruAttachment.user_id == user_id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="附件不存在")
    delete_from_oss(record.oss_object_key)
    db.delete(record)
    db.commit()
    return None


@router.post(
    "/chat/completions",
    summary="带附件的聊天：注入附件 URL 后转发 Hermes Agent",
)
async def chat_completions_with_attachments(
    payload: AttachmentChatRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
    _user=Depends(get_current_user),
):
    """把附件地址注入最后一条 user 消息后委托 hermes.service 转发上游。

    落库 content 用注入前的原始文本（附件卡片由 content_json.attachments
    还原）；上游流经 conversations 采集转发器——客户端断开不影响后端
    继续读完上游并落库。
    """
    messages = inject_attachments(
        [message.model_dump() for message in payload.messages],
        [attachment.model_dump() for attachment in payload.attachments],
    )
    upstream_payload: dict = {"messages": messages, "stream": True, "task": "chat"}
    if payload.model:
        upstream_payload["model"] = payload.model

    try:
        client, response = await open_chat_stream(upstream_payload)
    except HermesError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if payload.conversation_id:
        last_user = next(
            (m for m in reversed(payload.messages) if m.role == "user"), None
        )
        if last_user:
            content_json = (
                json.dumps(
                    {"attachments": [a.model_dump() for a in payload.attachments]},
                    ensure_ascii=False,
                )
                if payload.attachments
                else None
            )
            record_user_message(
                db,
                user_id=user_id,
                conversation_id=payload.conversation_id,
                content=last_user.content,
                model="hermes",
                content_json=content_json,
            )

    return stream_upstream_with_recording(
        client=client,
        response=response,
        user_id=user_id,
        conversation_id=payload.conversation_id,
        model="hermes",
    )

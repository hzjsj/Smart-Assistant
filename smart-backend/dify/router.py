"""Dify Agent 应用代理路由。

对外端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | /api/dify/info | 应用信息与参数（校验 key 与应用模式） |
| POST | /api/dify/chat/completions | 对话：Dify 事件翻译为 OpenAI 流后采集透传落库 |
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, get_current_userid
from conversations import crud
from conversations.service import stream_upstream_with_recording
from database import SessionLocal, get_db

from .schemas import DifyChatRequest
from .service import (
    DifyConversationExpired,
    DifyError,
    DifyStreamAdapter,
    build_files,
    extract_query,
    get_app_info,
    get_app_parameters,
    open_chat_stream,
)

router = APIRouter(
    prefix="/api/dify",
    tags=["Dify 对话模块"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/info", summary="Dify 应用信息与参数")
async def app_info():
    """返回应用名称/模式/标签与参数表单，用于确认 key 有效且为 Agent 应用。"""
    try:
        info = await get_app_info()
        parameters = await get_app_parameters()
    except DifyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return {"app": info, "parameters": parameters}


@router.post("/chat/completions", summary="Dify Agent 对话（SSE 流式）")
async def chat_completions(
    payload: DifyChatRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    """把 Dify 事件流翻译为 OpenAI chunk 后交给 conversations 采集转发器：

    - 多轮上下文由 Dify 维护，本地只保存 ``conversation_id`` 映射；
    - 客户端刷新/断线不影响后端读完上游并落库，仅手动 abort 终止；
    - ``agent_thought`` 转为思考内容 + 工具进度事件，复用现有工具链 UI。
    """
    try:
        query = extract_query([message.model_dump() for message in payload.messages])
        files = build_files(
            [attachment.model_dump() for attachment in payload.attachments]
        )
    except DifyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    upstream_id = None
    if payload.conversation_id:
        upstream_id = crud.get_upstream_conversation_id(
            db, user_id, payload.conversation_id
        )

    user = f"u{user_id}"
    try:
        try:
            client, response, settings = await open_chat_stream(
                query=query,
                conversation_id=upstream_id,
                user=user,
                files=files,
                inputs=payload.inputs,
            )
        except DifyConversationExpired:
            # 上游会话不存在/已结束：清空映射后作为新会话重开（仅重试一次）。
            crud.set_upstream_conversation_id(
                db, user_id, payload.conversation_id, None
            )
            client, response, settings = await open_chat_stream(
                query=query,
                conversation_id=None,
                user=user,
                files=files,
                inputs=payload.inputs,
            )
    except DifyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if payload.conversation_id:
        content_json = None
        if payload.attachments:
            content_json = json.dumps(
                {"attachments": [a.model_dump() for a in payload.attachments]},
                ensure_ascii=False,
            )
        crud.record_user_message(
            db,
            user_id=user_id,
            conversation_id=payload.conversation_id,
            content=query,
            model="dify",
            content_json=content_json,
        )

    def _save_upstream_id(upstream_conversation_id: str) -> None:
        """首个带 conversation_id 的事件到达时写回本地会话映射。"""
        if not payload.conversation_id:
            return
        with SessionLocal() as session:
            crud.set_upstream_conversation_id(
                session,
                user_id=user_id,
                conversation_id=payload.conversation_id,
                upstream_id=upstream_conversation_id,
            )

    adapter = DifyStreamAdapter(
        client=client,
        response=response,
        settings=settings,
        user=user,
        on_conversation_id=_save_upstream_id,
    )
    return stream_upstream_with_recording(
        client=client,
        response=adapter,
        user_id=user_id,
        conversation_id=payload.conversation_id,
        model="dify",
    )

"""OpenClaw Gateway 对话代理路由。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/openclaw/chat/completions | 对话：OpenAI 兼容流直通透传 + 会话落库 |
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, get_current_userid
from conversations import crud
from conversations.service import stream_upstream_with_recording
from database import get_db

from .schemas import OpenClawChatRequest
from .service import OpenClawError, open_chat_stream

router = APIRouter(
    prefix="/api/openclaw",
    tags=["OpenClaw 对话模块"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/chat/completions", summary="OpenClaw Agent 对话（SSE 流式）")
async def chat_completions(
    payload: OpenClawChatRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    """OpenClaw 网关直通透传：

    - 多轮上下文由上游 agent 会话维护（``user`` = conversations 表 ID）；
    - 客户端刷新/断线不影响后端读完上游并落库，仅手动 abort 终止；
    - 上游输出标准 OpenAI SSE，前端 Provider 无需区分。
    """
    if payload.conversation_id:
        content_json = None
        if payload.attachments:
            content_json = json.dumps(
                {"attachments": [a.model_dump() for a in payload.attachments]},
                ensure_ascii=False,
            )
        last_user = next(
            (
                message
                for message in reversed(payload.messages)
                if message.role == "user"
            ),
            None,
        )
        crud.record_user_message(
            db,
            user_id=user_id,
            conversation_id=payload.conversation_id,
            content=last_user.content if last_user else "",
            model="openclaw",
            content_json=content_json,
        )

    try:
        client, response = await open_chat_stream(payload.model_dump())
    except OpenClawError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return stream_upstream_with_recording(
        client=client,
        response=response,
        user_id=user_id,
        conversation_id=payload.conversation_id,
        model="openclaw",
    )

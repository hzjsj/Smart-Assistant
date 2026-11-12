"""DeepSeek 对话代理路由。

对外端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/deepseek/chat/completions | 普通对话：白名单字段转发 DeepSeek，SSE 采集透传落库 |
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, get_current_userid
from conversations.crud import record_user_message
from conversations.service import stream_upstream_with_recording
from database import get_db

from .schemas import DeepSeekChatRequest
from .service import DeepSeekError, open_chat_stream

router = APIRouter(prefix="/api/deepseek", tags=["DeepSeek 对话模块"])


@router.post(
    "/chat/completions",
    summary="普通对话：转发 DeepSeek（SSE 流式）",
)
async def chat_completions(
    payload: DeepSeekChatRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
    _user=Depends(get_current_user),
):
    """白名单转发 model/messages/attachments；上游流经 conversations 采集
    转发器——客户端断开（刷新/断线）不影响后端继续读完上游并落库。

    图片附件由 service 注入最后一条 user 消息（image_url 内容块）。
    前端沿用 HermesChatProvider 的 OpenAI 增量解析（content 与
    reasoning_content 思维链），无需针对 DeepSeek 做任何改动。
    """
    try:
        client, response = await open_chat_stream(
            {
                "messages": [
                    message.model_dump() for message in payload.messages
                ],
                "model": payload.model,
                "attachments": [
                    attachment.model_dump() for attachment in payload.attachments
                ],
            }
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if payload.conversation_id:
        last_user = next(
            (m for m in reversed(payload.messages) if m.role == "user"), None
        )
        if last_user:
            # content 兼容纯文本与内容块数组（图片注入发生在 service 层，请求体仍为文本）。
            content = (
                last_user.content
                if isinstance(last_user.content, str)
                else json.dumps(last_user.content, ensure_ascii=False)
            )
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
                content=content,
                model="deepseek",
                content_json=content_json,
            )

    return stream_upstream_with_recording(
        client=client,
        response=response,
        user_id=user_id,
        conversation_id=payload.conversation_id,
        model="deepseek",
    )

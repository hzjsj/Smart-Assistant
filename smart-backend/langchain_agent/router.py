"""LangChain Agent 对话路由。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/langchain/chat/completions | 对话：手动工具循环产出 OpenAI 兼容流，采集透传落库 |
"""

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, get_current_userid
from conversations import crud
from conversations.service import stream_upstream_with_recording
from database import get_db

from .schemas import LangChainChatRequest
from .service import (
    LangChainAgentError,
    LangChainStreamAdapter,
    _content_to_text,
    get_settings,
    _ensure_api_key,
)

router = APIRouter(
    prefix="/api/langchain",
    tags=["LangChain Agent 对话模块"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/chat/completions", summary="LangChain Agent 对话（SSE 流式）")
async def chat_completions(
    payload: LangChainChatRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    """手动 tool-calling 循环的流式对话：

    - 底层模型由 ``LANGCHAIN_AGENT_MODEL`` 决定（默认 deepseek-v4-flash）；
    - 多轮上下文使用前端随请求携带的完整 messages（与 deepseek 同构）；
    - 工具调用进度走 ``hermes.tool.progress`` 命名事件，前端过程面板复用；
    - 落库/续播/abort 全部由 conversations 采集器接管。
    """
    settings = get_settings()
    try:
        _ensure_api_key(settings)
    except LangChainAgentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    adapter = LangChainStreamAdapter(payload, settings)
    # 采集器收尾时会 aclose 该 client；本模块无上游连接，仅占位。
    client = httpx.AsyncClient()

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
            content=_content_to_text(payload.messages[-1].content)
            if payload.messages
            else "",
            model="langchain",
            content_json=content_json,
        )

    return stream_upstream_with_recording(
        client=client,
        response=adapter,
        user_id=user_id,
        conversation_id=payload.conversation_id,
        model="langchain",
    )

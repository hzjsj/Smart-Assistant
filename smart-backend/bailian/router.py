"""百炼对话路由：Agent 2.0 应用对话（SSE 流式 + 会话落库）。

从 hwzs bailian/router.py 迁移的 agent 端点；with_md 等 kb_chat 相关
端点不在迁移范围。
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_userid
from bailian.agent_service import (
    BailianAgentError,
    BailianSessionExpired,
    BailianStreamAdapter,
    build_lists,
    extract_prompt,
    open_agent_stream,
)
from bailian.schemas import BailianAgentChatRequest
from conversations import crud as conversations_crud
from conversations.service import stream_upstream_with_recording
from database import SessionLocal, get_db

router = APIRouter(prefix="/api/bailian", tags=["百炼大模型"])


@router.post(
    "/agent/chat/completions",
    summary="百炼 Agent 2.0 对话（SSE 流式 + 会话落库）",
)
async def agent_chat_completions(
    payload: BailianAgentChatRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_userid),
):
    """调用百炼 Agent 2.0 应用（``/apps/{APP_ID}/completion``）并翻译成
    OpenAI 兼容流，交给 conversations 采集转发器统一落库。

    - 多轮上下文由百炼 ``session_id`` 维护，本地只保存映射（1 小时有效）；
    - 图片附件 → ``image_list``，文档 → ``file_list``（OSS 公网 URL 直传）；
    - 客户端刷新/断线不影响后端读完上游并落库，仅手动 abort 终止。
    """
    try:
        prompt = extract_prompt([message.model_dump() for message in payload.messages])
        image_list, file_list = build_lists(
            [attachment.model_dump() for attachment in payload.attachments]
        )
    except BailianAgentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    session_id = None
    if payload.conversation_id:
        session_id = conversations_crud.get_upstream_conversation_id(
            db, user_id, payload.conversation_id
        )

    try:
        try:
            client, response, _settings = await open_agent_stream(
                prompt=prompt,
                session_id=session_id,
                image_list=image_list,
                file_list=file_list,
                enable_thinking=payload.enable_thinking,
                incremental_output=payload.incremental_output,
                app_id=payload.app_id,
            )
        except BailianSessionExpired:
            # 百炼 session 过期（约 1 小时）：清映射后作为新会话重开一次。
            conversations_crud.set_upstream_conversation_id(
                db, user_id, payload.conversation_id, None
            )
            client, response, _settings = await open_agent_stream(
                prompt=prompt,
                session_id=None,
                image_list=image_list,
                file_list=file_list,
                enable_thinking=payload.enable_thinking,
                incremental_output=payload.incremental_output,
                app_id=payload.app_id,
            )
    except BailianAgentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if payload.conversation_id:
        content_json = None
        if payload.attachments:
            content_json = json.dumps(
                {"attachments": [a.model_dump() for a in payload.attachments]},
                ensure_ascii=False,
            )
        conversations_crud.record_user_message(
            db,
            user_id=user_id,
            conversation_id=payload.conversation_id,
            content=prompt,
            model="bailian",
            content_json=content_json,
        )

    def _save_session_id(upstream_session_id: str) -> None:
        """首个带 session_id 的事件到达时写回本地会话映射。"""
        if not payload.conversation_id:
            return
        with SessionLocal() as session:
            conversations_crud.set_upstream_conversation_id(
                session,
                user_id=user_id,
                conversation_id=payload.conversation_id,
                upstream_id=upstream_session_id,
            )

    adapter = BailianStreamAdapter(
        client=client,
        response=response,
        on_session_id=_save_session_id,
    )
    return stream_upstream_with_recording(
        client=client,
        response=adapter,
        user_id=user_id,
        conversation_id=payload.conversation_id,
        model="bailian",
    )

import json
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from sqlalchemy.orm import Session

from auth import get_current_user
from chat import crud
from chat.llm import (
    DEFAULT_MODEL,
    MODELS,
    extract_reasoning,
    get_chat_model,
    get_context_tokens,
    list_models,
)
from chat.models import ChatSession
from chat.schemas import (
    ChatCompletionRequest,
    ChatMessageItem,
    ChatMessagesResponse,
    ChatSessionCreate,
    ChatSessionRename,
)
from database import SessionLocal, get_db
from users.models import User

router = APIRouter(prefix="/api/chat", tags=["AI 对话"])


def _require_own_session(db: Session, user: User, chat_id: str, allow_missing: bool = False) -> ChatSession | None:
    """校验会话归属。allow_missing 时会话不存在返回 None（如查历史：无会话即无消息）；
    存在但非本人抛 403；不允许缺失且不存在抛 404。"""
    obj = crud.get_session_by_chat_id(db, chat_id)
    if obj is None:
        if allow_missing:
            return None
        raise HTTPException(status_code=404, detail="会话不存在")
    if obj.user_id != user.userid:
        raise HTTPException(status_code=403, detail="无权访问该会话")
    return obj


# ── 模型与会话管理 ───────────────────────────────────────────────────

@router.get("/models")
def get_models():
    return {"success": True, "data": list_models(), "default": DEFAULT_MODEL}


@router.get("/sessions")
def get_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return {"success": True, "data": crud.list_sessions_grouped(db, user.userid)}


@router.post("/sessions")
def create_session(
    body: ChatSessionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if crud.get_session_by_chat_id(db, body.chat_id):
        raise HTTPException(status_code=400, detail="会话ID已存在")
    if body.model and body.model not in MODELS:
        raise HTTPException(status_code=400, detail=f"未知模型：{body.model}")
    obj = crud.create_session(db, user.userid, body.chat_id, body.title, body.model)
    return {"success": True, "data": {"chatId": obj.chat_id, "title": obj.title}}


@router.put("/sessions/{chat_id}")
def rename_session(
    chat_id: str,
    body: ChatSessionRename,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_own_session(db, user, chat_id)
    obj = crud.rename_session(db, chat_id, body.title)
    return {"success": True, "data": {"chatId": obj.chat_id, "title": obj.title}}


@router.delete("/sessions/{chat_id}")
def delete_session(
    chat_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_own_session(db, user, chat_id)
    crud.delete_session(db, chat_id)
    return {"success": True}


@router.get("/messages", response_model=ChatMessagesResponse)
def get_messages(
    chat_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # 会话不存在视为无历史（前端草稿会话也会来查），存在但非本人仍 403
    if _require_own_session(db, user, chat_id, allow_missing=True) is None:
        return ChatMessagesResponse(data=[])
    items = [
        ChatMessageItem(
            id=row.id,
            role=row.role,
            content=row.content,
            reasoningContent=row.reasoning_content,
            model=row.model,
            timestamp=int(row.created_at.timestamp() * 1000) if row.created_at else 0,
        )
        for row in crud.get_messages(db, chat_id)
    ]
    return ChatMessagesResponse(data=items)


# ── 流式对话 ─────────────────────────────────────────────────────────

def _sse(delta: dict, model: str, finish_reason: str | None = None) -> str:
    """构造 OpenAI 兼容的 SSE chunk（前端 XRequest 直接解析）。"""
    payload = {
        "id": "chatcmpl-smart",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _extract_last_user_content(messages: list[dict]) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user" and msg.get("content"):
            return str(msg["content"])
    raise HTTPException(status_code=400, detail="缺少用户消息")


@router.post("/completions")
async def chat_completions(
    body: ChatCompletionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.model not in MODELS:
        raise HTTPException(status_code=400, detail=f"未知模型：{body.model}")

    # 会话归属校验；不存在则自动建档（首条消息即建会话）
    session = crud.get_session_by_chat_id(db, body.chat_id)
    if session is None:
        content = _extract_last_user_content(body.messages)
        session = crud.create_session(
            db, user.userid, body.chat_id, content[:20], body.model
        )
    elif session.user_id != user.userid:
        raise HTTPException(status_code=403, detail="无权访问该会话")

    user_content = _extract_last_user_content(body.messages)
    crud.update_session_model(db, body.chat_id, body.model)
    if body.regenerate:
        # 重新生成：user 消息已在库中，只移除上一条 assistant 回复
        crud.delete_last_assistant(db, body.chat_id)
    else:
        crud.add_message(db, body.chat_id, "user", user_content)

    langchain_msgs = [
        HumanMessage(content=m["content"]) if m["role"] == "user" else AIMessage(content=m["content"])
        for m in crud.build_context(db, body.chat_id, get_context_tokens(body.model))
    ]
    chat_model = get_chat_model(body.model, body.enable_thinking)
    chat_id = body.chat_id

    async def event_generator():
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        db_session = None
        try:
            async for chunk in chat_model.astream(langchain_msgs):
                reasoning = extract_reasoning(chunk)
                if reasoning:
                    reasoning_parts.append(reasoning)
                    yield _sse({"reasoning_content": reasoning}, body.model)
                text = chunk.content if isinstance(chunk.content, str) else ""
                if text:
                    content_parts.append(text)
                    yield _sse({"content": text, "role": "assistant"}, body.model)
            yield _sse({}, body.model, finish_reason="stop")
        except Exception as e:  # 上游报错也要让前端看到并结束流
            yield _sse({"content": f"\n\n[调用模型失败：{e}]"}, body.model)
            yield _sse({}, body.model, finish_reason="stop")
        finally:
            # 聚合落库 assistant 消息；独立 Session，落库失败不影响已发出的流
            if content_parts or reasoning_parts:
                try:
                    db_session = SessionLocal()
                    crud.add_message(
                        db_session,
                        chat_id,
                        "assistant",
                        "".join(content_parts),
                        "".join(reasoning_parts) or None,
                        body.model,
                    )
                except Exception as e:  # noqa: BLE001
                    print(f"[chat] assistant 消息落库失败：{e}")
                finally:
                    if db_session:
                        db_session.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

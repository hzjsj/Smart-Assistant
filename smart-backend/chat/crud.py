from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from chat.models import ChatMessage, ChatSession


def get_session_by_chat_id(db: Session, chat_id: str) -> ChatSession | None:
    return db.query(ChatSession).filter(ChatSession.chat_id == chat_id).first()


def create_session(
    db: Session,
    user_id: str,
    chat_id: str,
    title: str = "新对话",
    model: str = "",
) -> ChatSession:
    obj = ChatSession(user_id=user_id, chat_id=chat_id, title=title, model=model)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


def list_sessions_grouped(db: Session, user_id: str) -> list[dict]:
    """当前用户的会话列表，按更新时间分为 今天/昨天/7天内/更早（直接匹配前端 Conversations 组件）。"""
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id)
        .order_by(ChatSession.updated_at.desc())
        .all()
    )
    now = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    def group_of(updated: datetime) -> str:
        if updated >= today:
            return "今天"
        if updated >= yesterday:
            return "昨天"
        if updated >= week_ago:
            return "7天内"
        return "更早"

    return [
        {"key": s.chat_id, "label": s.title, "group": group_of(s.updated_at)}
        for s in sessions
    ]


def rename_session(db: Session, chat_id: str, title: str) -> ChatSession | None:
    obj = get_session_by_chat_id(db, chat_id)
    if not obj:
        return None
    obj.title = title
    db.commit()
    db.refresh(obj)
    return obj


def update_session_model(db: Session, chat_id: str, model: str) -> None:
    obj = get_session_by_chat_id(db, chat_id)
    if obj and obj.model != model:
        obj.model = model
        db.commit()


def delete_session(db: Session, chat_id: str) -> bool:
    """删除会话并级联删除消息。"""
    obj = get_session_by_chat_id(db, chat_id)
    if not obj:
        return False
    db.query(ChatMessage).filter(ChatMessage.chat_id == chat_id).delete()
    db.delete(obj)
    db.commit()
    return True


def add_message(
    db: Session,
    chat_id: str,
    role: str,
    content: str,
    reasoning_content: str | None = None,
    model: str | None = None,
) -> ChatMessage:
    obj = ChatMessage(
        chat_id=chat_id,
        role=role,
        content=content,
        reasoning_content=reasoning_content,
        model=model,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


def get_messages(db: Session, chat_id: str, limit: int = 500) -> list[ChatMessage]:
    """会话消息（升序，供多轮上下文组装与前端历史恢复）。"""
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.chat_id == chat_id)
        .order_by(ChatMessage.id.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(rows))


def estimate_tokens(text: str) -> int:
    """保守 token 估算：按字符数（中文约 1 字符 1 token，英文更低，取保守值）。"""
    return len(text or "")


def build_context(db: Session, chat_id: str, context_tokens: int, reserve_tokens: int = 4096) -> list[dict]:
    """按上下文预算从新到旧保留消息，返回升序 [{role, content}]（不含 reasoning）。

    预算 = context_tokens - reserve_tokens（给输出留空间）。
    """
    budget = max(context_tokens - reserve_tokens, 1024)
    rows = get_messages(db, chat_id)
    kept: list[dict] = []
    used = 0
    for row in reversed(rows):
        cost = estimate_tokens(row.content) + 8
        if used + cost > budget:
            break
        kept.append({"role": row.role, "content": row.content})
        used += cost
    kept.reverse()
    return kept

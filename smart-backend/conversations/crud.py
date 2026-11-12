"""conversations 领域 CRUD 与跨端点落库入口。"""

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Conversation, ConversationMessage

DEFAULT_TITLE = "新对话"
TITLE_MAX_LEN = 24
DEFAULT_LIST_LIMIT = 100
DEFAULT_PAGE_LIMIT = 50


def create_conversation(
    db: Session,
    user_id: int,
    title: str | None = None,
    model: str = "hermes",
) -> Conversation:
    conv = Conversation(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=(title or DEFAULT_TITLE)[:255],
        model=model or "hermes",
        status=1,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def get_active_conversation(
    db: Session, user_id: int, conversation_id: str
) -> Conversation | None:
    """仅返回当前用户的 active 会话；不存在/不属于该用户/已删除一律 None。"""
    return (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.user_id == user_id,
            Conversation.status == 1,
        )
        .first()
    )


def get_upstream_conversation_id(
    db: Session, user_id: int, conversation_id: str
) -> str | None:
    """读取本地会话映射的上游会话 ID（Dify）；会话无效时返回 None。"""
    conv = get_active_conversation(db, user_id, conversation_id)
    return conv.upstream_conversation_id if conv else None


def set_upstream_conversation_id(
    db: Session,
    user_id: int,
    conversation_id: str,
    upstream_id: str | None,
) -> bool:
    """写回/清空上游会话 ID（多轮上下文由上游维护）。返回是否命中会话。"""
    conv = get_active_conversation(db, user_id, conversation_id)
    if conv is None:
        return False
    conv.upstream_conversation_id = upstream_id
    db.commit()
    return True


def list_conversations(
    db: Session, user_id: int, limit: int = DEFAULT_LIST_LIMIT
) -> list[tuple[Conversation, int]]:
    """会话列表（updated_at 倒序置顶）+ 消息计数，软删除不出现。"""
    limit = max(1, min(limit, DEFAULT_LIST_LIMIT))
    rows = (
        db.query(Conversation, func.count(ConversationMessage.id))
        .outerjoin(
            ConversationMessage,
            ConversationMessage.conversation_id == Conversation.id,
        )
        .filter(Conversation.user_id == user_id, Conversation.status == 1)
        .group_by(Conversation.id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
        .all()
    )
    return rows


def list_messages(
    db: Session,
    user_id: int,
    conversation_id: str,
    limit: int = DEFAULT_PAGE_LIMIT,
    before_id: int | None = None,
) -> tuple[list[ConversationMessage], bool, int | None]:
    """消息游标分页：id 倒序取最新一页后反转为正序返回。

    同一轮 user/assistant 可能同一秒落库，排序用自增 id 而非时间戳。
    """
    limit = max(1, min(limit, 200))
    query = db.query(ConversationMessage).filter(
        ConversationMessage.conversation_id == conversation_id,
        ConversationMessage.user_id == user_id,
    )
    if before_id:
        query = query.filter(ConversationMessage.id < before_id)
    rows = query.order_by(ConversationMessage.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows.reverse()
    next_before_id = rows[0].id if has_more and rows else None
    return rows, has_more, next_before_id


def _touch_conversation(conv: Conversation, model: str | None = None) -> None:
    """显式刷新会话 updated_at（新消息置顶），可选更新最后使用的模型。"""
    if model:
        conv.model = model
    conv.updated_at = func.now()


def record_user_message(
    db: Session,
    user_id: int,
    conversation_id: str,
    content: str,
    model: str = "hermes",
    content_json: str | None = None,
) -> ConversationMessage | None:
    """chat 端点转发前落 user 消息（供三个 chat 端点复用）。

    会话不存在 / 不属于该用户 / 已删除时返回 None——不报错，保持
    无 conversation_id 场景向后兼容；首条 user 消息自动生成标题
    （豆包同款：取前 24 字）。
    """
    conv = get_active_conversation(db, user_id, conversation_id)
    if conv is None:
        return None
    message = ConversationMessage(
        conversation_id=conversation_id,
        user_id=user_id,
        role="user",
        content=content or "",
        content_json=content_json,
        status=1,
    )
    if conv.title == DEFAULT_TITLE and content:
        conv.title = content[:TITLE_MAX_LEN]
    _touch_conversation(conv, model)
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def begin_assistant_message(
    db: Session, user_id: int, conversation_id: str
) -> ConversationMessage | None:
    """流开始时先落 status=0 的 assistant 占位行（供轮询续播）。

    会话不存在/不属于该用户时返回 None（与 record_user_message 一致的容错）。
    """
    conv = get_active_conversation(db, user_id, conversation_id)
    if conv is None:
        return None
    message = ConversationMessage(
        conversation_id=conversation_id,
        user_id=user_id,
        role="assistant",
        content="",
        status=0,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def update_streaming_message(
    db: Session,
    message_id: int,
    content: str,
    content_json: str | None,
) -> None:
    """采集过程中节流刷新生成中的内容（不改状态、不 touch 会话）。"""
    (
        db.query(ConversationMessage)
        .filter(ConversationMessage.id == message_id)
        .update(
            {
                "content": content,
                "content_json": content_json,
            }
        )
    )
    db.commit()


def finish_assistant_message(
    db: Session,
    message_id: int,
    content: str,
    content_json: str | None,
    status: int,
    finish_reason: str | None,
    usage: str | None,
    conversation_id: str,
    user_id: int,
) -> None:
    """采集结束时把占位行更新为终态（status: 1=done 2=error 3=aborted）并置顶会话。"""
    (
        db.query(ConversationMessage)
        .filter(ConversationMessage.id == message_id)
        .update(
            {
                "content": content,
                "content_json": content_json,
                "status": status,
                "finish_reason": finish_reason,
                "usage": usage,
            }
        )
    )
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
        .first()
    )
    if conv is not None:
        _touch_conversation(conv)
        db.add(conv)
    db.commit()

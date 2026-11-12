"""conversations 领域路由。

对外端点（全部绑定当前登录用户，越权访问统一返回 404）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST   | /api/conversations                    | 创建会话 |
| GET    | /api/conversations                    | 会话列表（updated_at 倒序 + 消息计数） |
| GET    | /api/conversations/{id}/messages      | 消息游标分页 |
| POST   | /api/conversations/{id}/abort         | 终止进行中的流式对话（→ aborted 落库） |
| PATCH  | /api/conversations/{id}               | 会话改名 |
| DELETE | /api/conversations/{id}               | 会话软删除 |
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_userid
from database import get_db

from . import crud, service
from .models import Conversation
from .schemas import (
    ConversationCreate,
    ConversationItem,
    ConversationRename,
    MessagePage,
)

router = APIRouter(prefix="/api/conversations", tags=["对话会话模块"])


def _require_conversation(
    db: Session, user_id: int, conversation_id: str
) -> Conversation:
    conv = crud.get_active_conversation(db, user_id, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conv


def _conversation_item(conv: Conversation, message_count: int) -> ConversationItem:
    return ConversationItem(
        id=conv.id,
        title=conv.title,
        model=conv.model,
        message_count=message_count,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


@router.post("", response_model=ConversationItem, summary="创建会话")
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    conv = crud.create_conversation(db, user_id, payload.title, payload.model or "hermes")
    return _conversation_item(conv, 0)


@router.get("", response_model=list[ConversationItem], summary="会话列表")
def list_conversations(
    limit: int = crud.DEFAULT_LIST_LIMIT,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    rows = crud.list_conversations(db, user_id, limit)
    return [_conversation_item(conv, count) for conv, count in rows]


@router.get(
    "/{conversation_id}/messages",
    response_model=MessagePage,
    summary="消息游标分页",
)
def list_messages(
    conversation_id: str,
    limit: int = crud.DEFAULT_PAGE_LIMIT,
    before_id: int | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    _require_conversation(db, user_id, conversation_id)
    rows, has_more, next_before_id = crud.list_messages(
        db, user_id, conversation_id, limit, before_id
    )
    return MessagePage(
        messages=[
            {
                "id": row.id,
                "role": row.role,
                "content": row.content,
                "content_json": row.content_json,
                "status": row.status,
                "finish_reason": row.finish_reason,
                "usage": row.usage,
                "created_at": row.created_at,
            }
            for row in rows
        ],
        has_more=has_more,
        next_before_id=next_before_id,
    )


@router.post("/{conversation_id}/abort", summary="终止进行中的流式对话")
def abort_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    _require_conversation(db, user_id, conversation_id)
    hit = service.abort_stream(conversation_id, user_id)
    return {"msg": "已终止" if hit else "当前没有进行中的对话"}


@router.patch("/{conversation_id}", response_model=ConversationItem, summary="会话改名")
def rename_conversation(
    conversation_id: str,
    payload: ConversationRename,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    conv = _require_conversation(db, user_id, conversation_id)
    conv.title = payload.title
    db.commit()
    db.refresh(conv)
    return _conversation_item(conv, -1)


@router.delete("/{conversation_id}", status_code=204, summary="会话软删除")
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    conv = _require_conversation(db, user_id, conversation_id)
    conv.status = 0
    db.commit()
    return None

"""conversations 领域请求/响应模型。"""

from datetime import datetime

from pydantic import BaseModel, Field


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    model: str | None = Field(default=None, max_length=32)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class ConversationItem(BaseModel):
    id: str
    title: str
    model: str
    message_count: int
    created_at: datetime
    updated_at: datetime


class MessageItem(BaseModel):
    id: int
    role: str
    content: str
    content_json: str | None
    status: int
    finish_reason: str | None
    usage: str | None
    created_at: datetime


class MessagePage(BaseModel):
    """消息分页：messages 按时间正序（前端可直接渲染），游标向更旧翻页。"""

    messages: list[MessageItem]
    has_more: bool
    next_before_id: int | None

"""Dify 对话代理请求模型。"""

from typing import Any

from pydantic import BaseModel, Field


class DifyChatMessage(BaseModel):
    role: str = Field(..., description="消息角色：system / user / assistant")
    content: str = Field(default="", description="消息内容")


class DifyChatAttachment(BaseModel):
    """随消息发送的附件（OSS 公网 URL，按 remote_url 交给 Dify）。"""

    url: str = Field(..., description="附件公网地址（http/https）")
    name: str | None = Field(default=None, description="附件名称（用于判断 image/document）")


class DifyChatRequest(BaseModel):
    messages: list[DifyChatMessage] = Field(
        ..., min_length=1, description="对话消息列表（仅最后一条 user 作为 query 上送）"
    )
    # 会话持久化：本地 conversations.id；上游 Dify conversation_id 由后端映射。
    conversation_id: str | None = Field(
        default=None, description="会话 ID（conversations 表）"
    )
    attachments: list[DifyChatAttachment] = Field(
        default_factory=list, description="随消息发送的附件"
    )
    inputs: dict[str, Any] = Field(
        default_factory=dict, description="Dify 应用输入变量（缺省为空对象）"
    )

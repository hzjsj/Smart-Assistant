"""OpenClaw 对话代理请求模型。"""

from typing import Any, Literal

from pydantic import BaseModel, Field


class OpenClawChatMessage(BaseModel):
    role: str = Field(..., description="消息角色：system / user / assistant")
    # content 兼容纯文本与 OpenAI 内容块数组（image_url 等），原样转发上游。
    content: str | list[dict[str, Any]] = Field(default="", description="消息内容")


class OpenClawChatAttachment(BaseModel):
    """随消息发送的附件（OSS 公网 URL），以文本提示注入由上游 agent 自行取用。"""

    url: str = Field(..., description="附件公网地址（http/https）")
    name: str | None = Field(default=None, description="附件名称")


class OpenClawChatRequest(BaseModel):
    messages: list[OpenClawChatMessage] = Field(
        ..., min_length=1, description="对话消息列表"
    )
    # 会话持久化：后端按它落 user 消息，并作为上游 user 会话键（同值复用
    # 同一 OpenClaw agent 会话）；空则跳过落库且无状态转发（向后兼容）。
    conversation_id: str | None = Field(
        default=None, description="会话 ID（conversations 表）"
    )
    attachments: list[OpenClawChatAttachment] = Field(
        default_factory=list, description="随消息发送的附件"
    )
    stream: Literal[True] = Field(default=True, description="恒为流式")

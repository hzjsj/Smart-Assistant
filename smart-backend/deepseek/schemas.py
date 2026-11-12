"""DeepSeek 对话代理请求模型。"""

from typing import Any

from pydantic import BaseModel, Field


class DeepSeekChatMessage(BaseModel):
    role: str = Field(..., description="消息角色：system / user / assistant")
    # content 兼容纯文本与 OpenAI 内容块数组（image_url 等），原样转发上游。
    content: str | list[dict[str, Any]] = Field(default="", description="消息内容")


class DeepSeekChatAttachment(BaseModel):
    """随消息发送的图片附件（OSS 公网 URL）。"""

    url: str = Field(..., description="图片公网地址（http/https）")
    name: str | None = Field(default=None, description="附件名称")


class DeepSeekChatRequest(BaseModel):
    messages: list[DeepSeekChatMessage] = Field(..., description="对话消息列表")
    model: str | None = Field(
        default=None, description="模型名，缺省取环境变量 DEEPSEEK_MODEL"
    )
    # 会话持久化：后端按它落 user 消息并关联 assistant 落库；空则跳过（向后兼容）。
    conversation_id: str | None = Field(
        default=None, description="会话 ID（conversations 表）"
    )
    attachments: list[DeepSeekChatAttachment] = Field(
        default_factory=list, description="随消息发送的图片附件"
    )

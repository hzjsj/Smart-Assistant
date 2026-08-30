from pydantic import BaseModel, Field
from typing import Optional


class ChatSessionCreate(BaseModel):
    """POST /api/chat/sessions 请求体"""
    chat_id: str = Field(min_length=8, max_length=64, description="会话ID（前端UUID）")
    title: str = Field(default="新对话", max_length=255)
    model: str = Field(default="", max_length=100)


class ChatSessionRename(BaseModel):
    """PUT /api/chat/sessions/{chat_id} 请求体"""
    title: str = Field(min_length=1, max_length=255)


class ChatMessageItem(BaseModel):
    """历史消息项（前端恢复气泡用）"""
    id: int
    role: str
    content: str
    reasoningContent: Optional[str] = None
    model: Optional[str] = None
    timestamp: int = Field(description="毫秒时间戳")


class ChatMessagesResponse(BaseModel):
    success: bool = True
    data: list[ChatMessageItem]


class ChatCompletionRequest(BaseModel):
    """POST /api/chat/completions 请求体（x-sdk 会发完整 messages，后端只取最后一条 user）"""
    chat_id: str = Field(min_length=1, max_length=64, alias="chatId")
    model: str = Field(min_length=1)
    messages: list[dict] = Field(description="OpenAI 格式消息数组，取最后一条 user")
    enable_thinking: bool = Field(default=False, alias="enableThinking")
    regenerate: bool = Field(
        default=False,
        alias="regenerate",
        description="重新生成：先删除该会话最后一条 assistant 消息（不新增 user 消息）",
    )
    md_urls: list[str] = Field(
        default=[],
        alias="mdUrls",
        description="参考文档 Markdown 的 URL 列表（如 OSS 地址），内容会注入对话上下文",
    )

    model_config = {"populate_by_name": True}


class ErrorResponse(BaseModel):
    errorCode: str = Field(description="业务约定的错误码")
    errorMessage: Optional[str] = None
    success: bool = False

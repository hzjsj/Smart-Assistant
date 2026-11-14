"""LangChain Agent 对话请求模型。

形状对齐 ``deepseek/schemas.py``；底层模型固定由 ``LANGCHAIN_AGENT_MODEL``
环境变量决定（不透传 model 字段），多轮上下文直接使用前端随请求携带的
完整 messages 历史（与 deepseek 同构，不做服务端历史拼接）。
"""

from typing import Any, Literal

from pydantic import BaseModel, Field


class LangChainChatMessage(BaseModel):
    role: str = Field(..., description="消息角色：system / user / assistant")
    # content 兼容纯文本与 OpenAI 内容块数组（前端历史即该形状），此处只取文本。
    content: str | list[dict[str, Any]] = Field(default="", description="消息内容")


class LangChainChatAttachment(BaseModel):
    """随消息发送的附件（OSS 公网 URL），由 agent 用 fetch_url 工具按需读取。"""

    url: str = Field(..., description="附件公网地址（http/https）")
    name: str | None = Field(default=None, description="附件名称")


class LangChainChatRequest(BaseModel):
    messages: list[LangChainChatMessage] = Field(
        ..., min_length=1, description="对话消息列表（含完整本地历史）"
    )
    conversation_id: str | None = Field(
        default=None, description="会话 ID（conversations 表），空则跳过落库（向后兼容）"
    )
    attachments: list[LangChainChatAttachment] = Field(
        default_factory=list, description="随消息发送的附件"
    )
    # 前端统一 payload 会携带 stream/task 字段（transformParams），此处声明
    # stream 以通过校验；task 仅 hermes 题库流程使用，langchain 恒为 chat。
    stream: Literal[True] = Field(default=True, description="恒为流式")

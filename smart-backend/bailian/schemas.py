"""百炼对话模块请求/响应模型（Agent 2.0 端点）。"""

from typing import List, Optional

from pydantic import BaseModel, Field


class BailianAgentChatMessage(BaseModel):
    role: str = Field(..., description="消息角色：system / user / assistant")
    content: str = Field(default="", description="消息内容")


class BailianAgentChatAttachment(BaseModel):
    """随消息发送的附件（OSS 公网 URL，按图片/文件分流上送）。"""

    url: str = Field(..., description="附件公网地址（http/https）")
    name: Optional[str] = Field(None, description="附件名称（用于判断图片/文件）")


class BailianAgentChatRequest(BaseModel):
    messages: List[BailianAgentChatMessage] = Field(
        ..., min_length=1, description="对话消息列表（仅最后一条 user 作为 prompt）"
    )
    conversation_id: Optional[str] = Field(
        None, description="会话 ID（conversations 表）；用于落库与 session 映射"
    )
    attachments: List[BailianAgentChatAttachment] = Field(
        default_factory=list, description="随消息发送的附件"
    )
    enable_thinking: bool = Field(
        False, description="是否开启深度思考（思考过程以 reasoning_content 下发）"
    )
    incremental_output: bool = Field(True, description="是否增量输出（推荐 true）")
    app_id: Optional[str] = Field(None, description="应用 ID，缺省取 BAILIAN_APP_ID")

"""mineru 领域 Pydantic schemas。"""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class SubmitRequest(BaseModel):
    """提交解析任务。参数与 MinerU 精准解析 API 对齐，默认值即当前线上行为。"""

    pdf_url: str = Field(..., description="需要解析的文件 URL")
    model_version: str = Field(
        "vlm", description="模型版本: pipeline(轻量) / vlm(推荐,默认) / MinerU-HTML(源文件为 html 时必选)"
    )
    is_ocr: bool = Field(True, description="是否启用 OCR（pipeline/vlm 有效）")
    enable_formula: bool = Field(True, description="公式识别（pipeline/vlm 有效；vlm 仅影响行内公式）")
    enable_table: bool = Field(True, description="表格识别（pipeline/vlm 有效）")
    language: str = Field("ch", description="文档语言: ch/en/japan/korean/chinese_cht 等")
    page_ranges: Optional[str] = Field(
        None, description='页码范围，如 "2,4-6"（4到6含端点）、"2--2"（第2页到倒数第2页）'
    )


class CallbackRequest(BaseModel):
    checksum: str = Field(..., description="签名校验值")
    content: str = Field(..., description="JSON 字符串")


class ChatAttachment(BaseModel):
    """聊天请求携带的附件引用（公网 URL，由上游 agent 自行拉取）。"""

    url: str = Field(..., description="附件公网访问 URL")
    name: str | None = Field(default=None, description="附件显示名")

    @field_validator("url")
    @classmethod
    def _url_must_be_http(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("附件 URL 必须是 http/https 地址")
        return value


class AttachmentChatMessage(BaseModel):
    """附件聊天端点的消息（与 hermes ChatMessage 字段一致但独立定义，避免跨模块耦合）。"""

    role: Literal["system", "user", "assistant"]
    content: str


class AttachmentChatRequest(BaseModel):
    """带附件的聊天请求：只服务普通聊天，不收 task / paper_config。"""

    model: str | None = None
    messages: list[AttachmentChatMessage] = Field(min_length=1)
    # 会话持久化：后端按它落 user 消息并关联 assistant 落库；空则跳过（向后兼容）。
    conversation_id: str | None = None
    stream: Literal[True] = True
    attachments: list[ChatAttachment] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def validate_last_message(self):
        if self.messages[-1].role != "user":
            raise ValueError("最后一条消息必须是用户消息")
        return self


class AttachmentUploaded(BaseModel):
    """附件上传/查询响应。"""

    id: str
    name: str
    url: str
    size: int
    ext: str
    created_at: datetime

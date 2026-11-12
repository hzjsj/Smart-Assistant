"""Hermes Agent 聊天请求模型。"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PaperGenerationConfig(BaseModel):
    """Validated form data for this request, never a persistent chat mode."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    subject: Literal["数学", "语文", "英语", "物理", "化学", "生物", "历史", "地理", "政治"]
    grade: str = Field(min_length=1, max_length=80)
    knowledge_points: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(default_factory=list, max_length=50)
    question_types: list[Annotated[str, Field(min_length=1, max_length=50)]] = Field(default_factory=list, max_length=30)
    quantity: int = Field(ge=1, le=50, strict=True)
    difficulty: int = Field(ge=1, le=10, strict=True)
    exam_type: Literal["期末考试", "随堂小测", "单元测试", "期中考试", "模拟考试"]
    remarks: str = Field(default="", max_length=4000)

    @field_validator("knowledge_points", "question_types")
    @classmethod
    def unique_tags(cls, values):
        return list(dict.fromkeys(values))

    @model_validator(mode="after")
    def validate_type_count(self):
        if len(self.question_types) > self.quantity:
            raise ValueError("题目总数不能少于已选题型数量")
        return self


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    content: str


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str | None = None
    messages: list[ChatMessage] = Field(min_length=1)
    # 会话持久化：后端按它落 user 消息并关联 assistant 落库；空则跳过（向后兼容）。
    conversation_id: str | None = None
    stream: Literal[True] = True
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    max_tokens: int | None = Field(default=None, gt=0)
    task: Literal["chat", "question_bank"] = "chat"
    paper_config: PaperGenerationConfig | None = None

    @model_validator(mode="after")
    def validate_task(self):
        if self.task == "question_bank":
            if self.paper_config is None:
                raise ValueError("提交组卷表单时必须提供 paper_config")
            if self.messages[-1].role != "user":
                raise ValueError("组卷请求的最后一条消息必须是用户消息")
        elif self.paper_config is not None:
            raise ValueError("普通聊天不能携带组卷配置")
        return self

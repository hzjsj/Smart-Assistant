"""Versioned question-bank and paper contracts owned by Hermes."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class QuestionOption(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    label: str = Field(min_length=1, max_length=20)
    content: str = Field(max_length=10000)


class Question(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=128)
    type: str = Field(min_length=1, max_length=50)
    content: str = Field(min_length=1, max_length=30000)
    options: list[QuestionOption] = Field(default_factory=list, max_length=26)
    answer: str = Field(default="", max_length=20000)
    analysis: str = Field(default="", max_length=30000)
    score: float | None = Field(default=None, ge=0, le=1000, allow_inf_nan=False)
    knowledge_points: list[str] = Field(default_factory=list, max_length=30)
    cognitive_level: str = Field(default="", max_length=100)
    difficulty: float | None = Field(default=None, ge=1, le=10, allow_inf_nan=False)

    @field_validator("id", mode="before")
    @classmethod
    def normalize_id(cls, value):
        return str(value) if isinstance(value, int) and not isinstance(value, bool) else value

    @field_validator("knowledge_points")
    @classmethod
    def normalize_knowledge_points(cls, values):
        if any(len(value) > 300 for value in values):
            raise ValueError("知识点名称过长")
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))

    @model_validator(mode="after")
    def validate_options(self):
        labels = [option.label for option in self.options]
        if len(labels) != len(set(labels)):
            raise ValueError(f"题目 {self.id} 的选项标号重复")
        if "选择" in self.type and len(self.options) < 2:
            raise ValueError(f"选择题 {self.id} 至少需要两个选项")
        return self


class QuestionBankDocument(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    type: Literal["question_bank"] = "question_bank"
    version: Literal[1] = 1
    id: str = Field(default="", max_length=128)
    title: str = Field(min_length=1, max_length=300)
    subject: str = Field(min_length=1, max_length=50)
    grade: str = Field(min_length=1, max_length=80)
    exam_type: str = Field(default="单元测试", max_length=80)
    difficulty: float | None = Field(default=None, ge=1, le=10, allow_inf_nan=False)
    questions: list[Question] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique_question_ids(self):
        ids = [question.id for question in self.questions]
        if len(ids) != len(set(ids)):
            raise ValueError("题目 id 必须唯一")
        return self


class ImportQuestionBankRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str | None = Field(default=None, max_length=10000)
    document: QuestionBankDocument | None = None
    title: str | None = Field(default=None, max_length=300)
    subject: str | None = Field(default=None, max_length=50)
    grade: str | None = Field(default=None, max_length=80)
    exam_type: str | None = Field(default=None, max_length=80)
    difficulty: float | None = Field(default=None, ge=1, le=10, allow_inf_nan=False)

    @model_validator(mode="after")
    def require_source(self):
        if bool(self.url) == bool(self.document):
            raise ValueError("请提供 url 或 document 中的一项")
        return self


class QuestionBankResponse(BaseModel):
    id: str
    question_count: int
    total_score: float | None
    document: QuestionBankDocument


class CreatePaperRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    bank_id: str = Field(min_length=1, max_length=64)
    selected_ids: list[str] = Field(min_length=1, max_length=500)
    title: str = Field(min_length=1, max_length=300)
    include_answers: bool = False


class PaperResponse(BaseModel):
    id: str
    bank_id: str
    title: str
    question_count: int
    total_score: float | None
    include_answers: bool
    document: QuestionBankDocument


class CreateExportRequest(BaseModel):
    format: Literal["docx", "xlsx", "json"]


class ExportResponse(BaseModel):
    id: str
    paper_id: str
    format: str
    status: Literal["generating", "ready", "failed"]
    filename: str
    download_url: str | None = None
    error: str | None = None

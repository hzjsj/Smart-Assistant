"""切题模块请求/响应模型。"""
from typing import Any, Optional

from pydantic import BaseModel, Field


class CutRequest(BaseModel):
    """切题请求：与外部 EduTutor 接口字段名保持一致（question_image_url）。"""

    question_image_url: str = Field(..., description="试卷/题目图片的公网 URL")


class UploadResponse(BaseModel):
    """上传响应：与参考项目 /api/upload/single 响应结构一致。"""

    success: bool = True
    filename: str = ""
    content_type: str = ""
    size: Optional[int] = None
    message: str = ""
    url: str = ""


class SnapshotPageQuestion(BaseModel):
    class Config:
        extra = "allow"


class SnapshotPayload(BaseModel):
    """快照同步请求体：前端直接提交 pages + currentPageIndex。"""

    pages: list[dict[str, Any]] = Field(default_factory=list)
    currentPageIndex: int = 0


class SnapshotSaveResponse(BaseModel):
    success: bool
    totalPages: int
    totalQuestions: int
    updatedAt: int


class SnapshotGetResponse(BaseModel):
    success: bool
    snapshot: Optional[dict[str, Any]] = None


class RecordsResponse(BaseModel):
    success: bool
    records: list[dict[str, Any]] = Field(default_factory=list)

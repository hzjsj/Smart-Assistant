from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


class FileRequestBody(BaseModel):
    """前端 POST /api/files 的统一请求体"""
    method: str = "post"
    data: Optional[dict[str, Any]] = None


class FileUpdate(BaseModel):
    original_name: Optional[str] = Field(None, max_length=255, description="新文件名")


class FileRecordResponse(BaseModel):
    id: int
    original_name: str
    saved_name: str
    file_path: str
    file_size: int
    download_url: str
    uid: Optional[str] = None
    md_file_path: Optional[str] = None
    md_download_url: Optional[str] = None
    oss_md_url: Optional[str] = None
    oss_word_url: Optional[str] = None
    oss_images: Optional[str] = None
    zip_source: Optional[str] = None
    mineru_task_id: Optional[str] = None
    mineru_state: Optional[str] = None
    mineru_zip_url: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ErrorResponse(BaseModel):
    errorCode: str = Field(description="业务约定的错误码")
    errorMessage: Optional[str] = Field(default=None, description="业务上的错误信息")
    success: bool = Field(description="业务上的请求是否成功")

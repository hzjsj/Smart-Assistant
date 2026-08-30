"""mineru 领域 Pydantic schemas。"""

from pydantic import BaseModel, Field


class SubmitRequest(BaseModel):
    pdf_url: str = Field(..., description="需要解析的文件 URL")


class CallbackRequest(BaseModel):
    checksum: str = Field(..., description="签名校验值")
    content: str = Field(..., description="JSON 字符串")

from pydantic import BaseModel, Field
from typing import Optional


class OssMdTextToDocxRequest(BaseModel):
    """POST /api/oss/convert-md-text-to-docx 请求体"""
    md_content: str = Field(description="Markdown 文本内容")
    filename: Optional[str] = Field(default=None, description="目标文件名（不含扩展名也可）")


class OssMdToDocxResponse(BaseModel):
    filename: str = ""
    url: str = Field(description="OSS 上的 Word 文件地址")

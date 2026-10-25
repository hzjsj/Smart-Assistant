"""mineru 领域 Pydantic schemas。"""

from typing import Optional

from pydantic import BaseModel, Field


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

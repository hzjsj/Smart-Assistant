import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import APIRouter, HTTPException

from oss.schemas import OssMdTextToDocxRequest, OssMdToDocxResponse
from utils.oss_upload import convert_md_to_docx

router = APIRouter(prefix="/api/oss", tags=["osSwenjianshangchuan"])


@router.post("/convert-md-text-to-docx", response_model=OssMdToDocxResponse, operation_id="ossMdTextToDocxApiOssConvertMdTextToDocxPost")
def oss_md_text_to_docx(req: OssMdTextToDocxRequest):
    """Markdown 文本 → Word（.docx）→ 上传 OSS，返回下载地址。

    供 copilot / generate-test-paper 页面导出 Word 使用。
    """
    if not req.md_content.strip():
        raise HTTPException(status_code=400, detail="Markdown内容不能为空")

    try:
        result = convert_md_to_docx(req.md_content, req.filename)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MD转Word失败: {str(e)}")

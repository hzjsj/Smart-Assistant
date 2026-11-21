"""上传文件统一校验：扩展名白名单 + 大小上限。

documents / qieti / mineru 上传入口共用，避免各模块重复实现
（参照 mineru/attachment_service.py 与 shuban/router.py 的既有实现）。
"""
import os

from fastapi import HTTPException, UploadFile

# 各上传通道默认上限（MB）。可用同名环境变量覆盖。
DOCUMENTS_UPLOAD_MAX_MB = int(os.getenv("DOCUMENTS_UPLOAD_MAX_MB", "100"))
MINERU_UPLOAD_MAX_MB = int(os.getenv("MINERU_UPLOAD_MAX_MB", "200"))
QIETI_UPLOAD_MAX_MB = int(os.getenv("QIETI_UPLOAD_MAX_MB", "50"))


def ensure_extension(filename: str | None, allowed: set[str]) -> str:
    """校验文件扩展名在白名单内，返回小写扩展名；不合法抛 HTTPException(400)。"""
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型 {ext or '(无扩展名)'}，仅支持 {' / '.join(sorted(allowed))}",
        )
    return ext


async def read_upload_limited(file: UploadFile, max_mb: int) -> bytes:
    """分片读取上传内容并强制大小上限（超限抛 HTTPException 413），避免大文件全量进内存。"""
    max_bytes = max_mb * 1024 * 1024
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(status_code=413, detail=f"文件过大，最大支持 {max_mb}MB")
    return bytes(buf)

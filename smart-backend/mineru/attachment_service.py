"""聊天附件服务：上传转存 OSS、记录管理、消息注入（纯函数）。

设计约定（见 mineru/README.md）：
- 附件以公网 URL 随问题交给上游 agent，由其用文件拉取工具自取；
- 本模块不做 MinerU 解析，解析仍走 /api/mineru/extract/submit。
"""

import logging
import os
import tempfile
import uuid
from typing import Any

import alibabacloud_oss_v2 as oss
from dotenv import load_dotenv
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from utils.oss_upload import OSS_BUCKET, OSS_ENDPOINT, OSS_REGION, upload_to_oss

load_dotenv()

logger = logging.getLogger(__name__)

ALLOWED_EXTS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx",
    ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".txt", ".md",
}
MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024  # 50MB，与前端提示一致
MAX_ATTACHMENTS_PER_MESSAGE = 5
OBJECT_KEY_PREFIX = "mineru-attachments"

_ATTACHMENT_CLIENT: oss.Client | None = None


def _get_attachment_oss_client() -> oss.Client:
    """附件模块自用的 OSS 客户端（utils/oss_upload 未暴露删除能力，这里自带一份）。"""
    global _ATTACHMENT_CLIENT
    if _ATTACHMENT_CLIENT is None:
        credentials_provider = oss.credentials.EnvironmentVariableCredentialsProvider()
        cfg = oss.config.load_default()
        cfg.credentials_provider = credentials_provider
        cfg.region = OSS_REGION
        cfg.endpoint = OSS_ENDPOINT
        _ATTACHMENT_CLIENT = oss.Client(cfg)
    return _ATTACHMENT_CLIENT


def delete_from_oss(object_key: str) -> None:
    """删除 OSS 对象；失败仅记日志，不阻断记录删除。"""
    try:
        client = _get_attachment_oss_client()
        client.delete_object(oss.DeleteObjectRequest(bucket=OSS_BUCKET, key=object_key))
    except Exception as exc:  # noqa: BLE001 - 物理清理失败不应影响业务删除
        logger.warning("删除 OSS 对象失败 %s: %s", object_key, exc)


def file_ext(name: str | None) -> str:
    """取小写扩展名（含点），无扩展名返回空串。"""
    _, ext = os.path.splitext(name or "")
    return ext.lower()


async def save_attachment(db: Session, user_id: int, upload_file: UploadFile):
    """校验并保存附件：转存 OSS + 落库，返回 MineruAttachment 记录。"""
    ext = file_ext(upload_file.filename)
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"不支持的附件类型：{ext or '未知'}")

    data = await upload_file.read()
    if not data:
        raise HTTPException(status_code=400, detail="附件内容为空")
    if len(data) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(status_code=400, detail="附件大小不能超过 50MB")

    fd, tmp_path = tempfile.mkstemp(suffix=ext)
    try:
        with os.fdopen(fd, "wb") as tmp_file:
            tmp_file.write(data)
        object_key = f"{OBJECT_KEY_PREFIX}/{uuid.uuid4().hex}{ext}"
        result = upload_to_oss(tmp_path, object_key)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    from mineru.models import MineruAttachment  # 局部导入避免循环依赖

    record = MineruAttachment(
        id=uuid.uuid4().hex,
        user_id=user_id,
        original_name=os.path.basename(upload_file.filename or "attachment"),
        oss_url=result["url"],
        oss_object_key=result["object_key"],
        file_size=len(data),
        ext=ext,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def inject_attachments(
    messages: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """把附件地址以参考资料块追加到最后一条 user 消息；无附件时原样返回。

    纯函数：不修改传入的 messages / attachments，返回新列表。
    """
    if not attachments:
        return messages

    lines = [
        "",
        "[用户上传的参考资料]",
        "请结合以下附件回答；可用你的文件工具按 URL 获取附件内容：",
    ]
    for index, attachment in enumerate(attachments, start=1):
        name = (attachment.get("name") or "").strip() or f"附件{index}"
        lines.append(f"{index}. {name}: {attachment['url']}")
    block = "\n".join(lines)

    merged = [dict(message) for message in messages]
    for position in range(len(merged) - 1, -1, -1):
        if merged[position].get("role") == "user":
            merged[position] = {
                **merged[position],
                "content": f"{merged[position].get('content', '')}{block}",
            }
            break
    return merged

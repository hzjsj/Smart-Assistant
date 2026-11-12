"""mineru 聊天附件表（hermes 页面迁移）。"""

from sqlalchemy import Column, Integer, String, Text

from database import Base, TimestampMixin


class MineruAttachment(TimestampMixin, Base):
    """聊天附件上传记录：原文件存 OSS 公网 URL，交上游 agent 自行拉取。"""

    __tablename__ = "mineru_attachments"

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    original_name = Column(String(500), nullable=False)
    oss_url = Column(Text, nullable=False)
    oss_object_key = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=False, default=0)
    ext = Column(String(16), nullable=False, default="")

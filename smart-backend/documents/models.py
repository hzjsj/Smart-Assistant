from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from datetime import datetime
from database import Base


class FileRecord(Base):
    __tablename__ = "file_records"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    original_name = Column(String(255), nullable=False, comment="原始文件名")
    saved_name = Column(String(255), nullable=False, comment="保存的文件名")
    file_path = Column(String(500), nullable=False, comment="文件存储路径")
    file_size = Column(Integer, nullable=False, comment="文件大小(字节)")
    download_url = Column(String(500), nullable=False, comment="下载地址")
    uid = Column(String(36), index=True, nullable=True, comment="所属用户 userid（非唯一，一个用户可有多条记录）")
    md_file_path = Column(String(500), nullable=True, comment="转换后的Markdown文件路径")
    md_download_url = Column(String(500), nullable=True, comment="Markdown文件下载地址")
    oss_md_url = Column(String(500), nullable=True, comment="OSS上的Markdown文件地址")
    oss_word_url = Column(String(500), nullable=True, comment="OSS上的Word文件地址")
    oss_images = Column(
        Text().with_variant(MEDIUMTEXT, "mysql"),
        nullable=True,
        comment="OSS上的图片地址列表,逗号分隔（变长，可能很多张图）",
    )
    zip_source = Column(String(500), nullable=True, comment="来源zip文件名")
    mineru_task_id = Column(String(100), nullable=True, index=True, comment="MinerU 任务ID")
    mineru_state = Column(String(20), nullable=True, comment="MinerU 任务状态: submitted/done/error")
    mineru_zip_url = Column(String(1000), nullable=True, comment="MinerU 返回的 zip 下载地址")
    created_at = Column(DateTime, default=datetime.now, comment="上传时间")

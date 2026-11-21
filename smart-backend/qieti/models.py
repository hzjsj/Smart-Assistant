"""切题模块数据模型：上传记录 + 题库快照。

迁移自 hwwh-manage-backend 切题模块（原为腾讯 CloudBase 集合），按本项目
约定适配：新表继承 TimestampMixin；快照 payload 用 MEDIUMTEXT（含 dataURL
页图，MySQL TEXT 64KB 会截断）；题图存阿里云 OSS kdsa 桶（公共读）。
"""
from sqlalchemy import Column, Index, Integer, String, Text
from sqlalchemy.dialects.mysql import MEDIUMTEXT

from database import Base, TimestampMixin


class QietiUploadRecord(TimestampMixin, Base):
    """切题图片上传记录（按 uid 隔离，见 todo 第 4/7 条）。"""

    __tablename__ = "qieti_upload_records"
    # (uid, created_at) 复合索引：记录页按用户 + 时间倒序查询的高频路径
    __table_args__ = (Index("ix_qieti_upload_uid_created", "uid", "created_at"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    uid = Column(String(50), nullable=True, comment="上传用户 userid（历史遗留行为 NULL）")
    file_name = Column(String(500), nullable=False, default="", comment="文件名")
    file_type = Column(String(100), nullable=False, default="", comment="MIME 类型")
    file_size = Column(Integer, nullable=False, default=0, comment="文件大小(字节)")
    uploaded_url = Column(String(1000), nullable=False, default="", comment="OSS 公网地址")


class QietiSnapshot(TimestampMixin, Base):
    """题库快照（按用户隔离：snapshot_key='latest:<uid>'；历史遗留行为 'latest'）。"""

    __tablename__ = "qieti_snapshots"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    snapshot_key = Column(String(50), nullable=False, unique=True, default="latest", comment="快照键")
    uid = Column(String(50), nullable=True, comment="快照属主 userid（历史遗留行为 NULL）")
    # with_variant：MySQL 上是 MEDIUMTEXT（快照含 dataURL 页图，TEXT 64KB 会截断），其他方言回落 TEXT
    payload = Column(Text().with_variant(MEDIUMTEXT(), "mysql"), nullable=False, comment="归一化后的快照 JSON")
    total_pages = Column(Integer, nullable=False, default=0, comment="总页数")
    total_questions = Column(Integer, nullable=False, default=0, comment="总题数")

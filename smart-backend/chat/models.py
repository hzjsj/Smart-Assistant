from sqlalchemy import Column, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.sql import func

from database import Base


class ChatSession(Base):
    """对话会话表。chat_id 由前端生成（UUID），与用户绑定。"""

    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(String(50), nullable=False, comment="所属用户 userid")
    chat_id = Column(String(64), nullable=False, unique=True, comment="会话ID（前端UUID）")
    title = Column(String(255), nullable=False, default="新对话", comment="会话标题")
    model = Column(String(100), nullable=False, default="", comment="会话使用的模型")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    __table_args__ = (Index("idx_chat_sessions_user_time", "user_id", "updated_at"),)


class ChatMessage(Base):
    """对话消息表。多轮上下文以此表为准（后端权威组装）。"""

    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    chat_id = Column(String(64), nullable=False, comment="会话ID")
    role = Column(String(32), nullable=False, comment="角色：user / assistant")
    # 大文本字段可能 >64KB，MySQL 端用 MEDIUMTEXT(16MB)
    content = Column(
        Text().with_variant(MEDIUMTEXT, "mysql"), nullable=False, comment="回答内容"
    )
    reasoning_content = Column(
        Text().with_variant(MEDIUMTEXT, "mysql"),
        nullable=True,
        comment="深度思考内容（仅 assistant）",
    )
    model = Column(String(100), nullable=True, comment="生成该消息的模型")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")

    __table_args__ = (Index("idx_chat_messages_chat_id", "chat_id", "id"),)

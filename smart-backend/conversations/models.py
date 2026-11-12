"""conversations 领域数据模型。

通过 ``conversations.router`` 的 import 在 main.py 启动 create_all 之前
完成注册，无需修改建表脚本；字段风格与 mineru/models.py 一致。
"""

from sqlalchemy import BigInteger, Column, Index, Integer, SmallInteger, String, Text

from database import Base, TimestampMixin


class Conversation(TimestampMixin, Base):
    """对话会话：跨模型通用，按用户隔离，软删除。

    updated_at 由 TimestampMixin 的 onupdate 自动维护；落库/回填消息时
    再显式 touch，保证有新消息的会话在侧栏按 updated_at 倒序置顶。
    """

    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True)  # 服务端 UUID4，兼作前端 conversationKey
    user_id = Column(Integer, nullable=False, index=True)
    title = Column(String(255), nullable=False, default="新对话")
    model = Column(String(32), nullable=False, default="hermes")
    status = Column(SmallInteger, nullable=False, default=1)  # 1=active 0=deleted
    # 上游会话 ID（如 Dify conversation_id）：多轮上下文由上游维护，
    # 本地只保存映射；无上游会话的模型（hermes/deepseek）保持 NULL。
    upstream_conversation_id = Column(String(64))


class ConversationMessage(TimestampMixin, Base):
    """对话消息：id 自增即分页游标（同轮 user/assistant 严格按 id 保序）。

    content 存规范文本（未来后端组装上游历史可直接用）；
    content_json 存显示快照 JSON（reasoning_content、attachments 等），
    供前端刷新后还原渲染——对应豆包 content / content_block 双存先例。
    """

    __tablename__ = "conversation_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    conversation_id = Column(String(36), nullable=False)
    user_id = Column(Integer, nullable=False, index=True)
    role = Column(String(16), nullable=False)  # user / assistant
    content = Column(Text, nullable=False, default="")
    content_json = Column(Text)
    status = Column(
        SmallInteger, nullable=False, default=1
    )  # 0=streaming 1=done 2=error 3=aborted
    finish_reason = Column(String(32))
    usage = Column(Text)


Index(
    "ix_conversation_messages_conv_id",
    ConversationMessage.conversation_id,
    ConversationMessage.id,
)

# 简易迁移：upstream_conversation_id 为 Dify 对接新增列，旧库需追加。
MIGRATION_TABLE = "conversations"
MIGRATIONS: list[tuple[str, str]] = [
    (
        "upstream_conversation_id",
        "ALTER TABLE conversations ADD COLUMN upstream_conversation_id VARCHAR(64)",
    ),
]

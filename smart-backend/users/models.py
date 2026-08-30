from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from database import Base


class User(Base):
    """用户表。字段与 Ant Design Pro 的 CurrentUser 结构对齐。"""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, comment="用户名")
    password_hash = Column(String(255), nullable=False, comment="密码哈希")
    name = Column(String(100), nullable=False, comment="显示名称")
    avatar = Column(String(500), nullable=False, default="", comment="头像URL")
    userid = Column(String(50), nullable=False, unique=True, comment="用户ID")
    email = Column(String(200), nullable=False, default="", comment="邮箱")
    signature = Column(String(500), nullable=True, default="", comment="签名")
    title = Column(String(100), nullable=True, default="", comment="职位")
    group_name = Column(String(200), nullable=True, default="", comment="组织")
    tags = Column(Text, nullable=True, default="[]", comment="标签JSON")
    notify_count = Column(Integer, default=0, comment="通知数")
    unread_count = Column(Integer, default=0, comment="未读数")
    country = Column(String(100), nullable=True, default="", comment="国家")
    access = Column(String(50), nullable=False, default="", comment="权限角色")
    geographic = Column(Text, nullable=True, default="{}", comment="地理信息JSON")
    address = Column(String(500), nullable=True, default="", comment="地址")
    phone = Column(String(50), nullable=True, default="", comment="电话")


class UserSession(Base):
    """登录会话持久化表。

    后端重启不丢失登录态；token 仅在 expires_at 未过期时有效。
    """
    __tablename__ = "user_sessions"

    token = Column(String(64), primary_key=True, comment="会话令牌")
    user_id = Column(Integer, nullable=False, index=True, comment="所属用户ID")
    expires_at = Column(DateTime, nullable=False, comment="过期时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")

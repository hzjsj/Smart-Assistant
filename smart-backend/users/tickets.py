"""一次性免密登录 ticket 持久化层（基于数据库表 login_tickets）。

管理员在用户管理页签发登录链接时生成 ticket，用户打开链接后由
/api/login/ticket 消费。ticket 短时效且一次性，消费即删除。
"""
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from users.models import LoginTicket

# ticket 有效期（分钟）。签发后需尽快使用，过期即失效。
TICKET_TTL_MINUTES = 10


def create_login_ticket(db: Session, user_id: int) -> str:
    """为 user_id 生成一条一次性免密登录 ticket。

    顺带清理已过期的 ticket，避免表无限膨胀。
    """
    ticket = secrets.token_urlsafe(32)
    expires_at = datetime.now() + timedelta(minutes=TICKET_TTL_MINUTES)
    db.add(LoginTicket(ticket=ticket, user_id=user_id, expires_at=expires_at))
    db.commit()
    _cleanup_expired(db)
    return ticket


def consume_login_ticket(db: Session, ticket: str | None) -> int | None:
    """校验并消费 ticket：有效则删除记录并返回 user_id；无效/过期返回 None。

    无论是否过期，消费后均删除记录（一次性）。
    """
    if not ticket:
        return None
    row = db.query(LoginTicket).filter(LoginTicket.ticket == ticket).first()
    if not row:
        return None
    db.delete(row)
    db.commit()
    if row.expires_at <= datetime.now():
        return None
    return row.user_id


def _cleanup_expired(db: Session) -> None:
    """删除已过期的 ticket 记录。"""
    db.query(LoginTicket).filter(
        LoginTicket.expires_at <= datetime.now(),
    ).delete()
    db.commit()

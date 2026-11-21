"""登录会话持久化层（基于数据库表 user_sessions）。

后端重启不丢失登录态。所有会话操作集中在此处，鉴权点统一调用。
"""
import os
import secrets
from datetime import datetime, timedelta

from fastapi import Response
from sqlalchemy.orm import Session

from users.models import UserSession

# 会话有效期（天）。与登录 cookie 的 max_age 保持一致。
SESSION_TTL_DAYS = 7
# 登录态 Cookie 名与 token 前缀（鉴权点统一从此处引用，避免魔法字符串）。
SESSION_COOKIE_NAME = "sa_session_token"
TOKEN_PREFIX = "sa-"


def create_session(db: Session, user_id: int) -> str:
    """为 user_id 生成并持久化一条会话，返回 token。

    登录成功后调用。同一用户可有多条会话（多端登录），各自独立过期。
    顺带清理该用户的过期会话，避免表无限膨胀。
    """
    token = f"{TOKEN_PREFIX}{secrets.token_hex(16)}"
    expires_at = datetime.now() + timedelta(days=SESSION_TTL_DAYS)
    db.add(UserSession(token=token, user_id=user_id, expires_at=expires_at))
    db.commit()
    _cleanup_user_expired(db, user_id)
    return token


def set_session_cookie(response: Response, token: str) -> None:
    """登录成功后统一签发会话 cookie（账号 / ticket / 企微三处共用）。

    HttpOnly 防止脚本读取 token；secure 由 env COOKIE_SECURE 控制
    （本地 HTTP 开发默认 false，生产经 HTTPS 部署设为 true）。
    """
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        samesite="lax",
        max_age=SESSION_TTL_DAYS * 24 * 3600,
    )


def get_session_user_id(db: Session, token: str | None) -> int | None:
    """根据 token 取有效（未过期）会话的 user_id；无效/过期返回 None。

    过期会话视同不存在（不主动删除，由 create_session/cleanup 顺带清理）。
    """
    if not token:
        return None
    session = (
        db.query(UserSession)
        .filter(UserSession.token == token)
        .filter(UserSession.expires_at > datetime.now())
        .first()
    )
    return session.user_id if session else None


def delete_session(db: Session, token: str | None) -> None:
    """登出时删除指定会话。token 为空或不存在均静默通过。"""
    if not token:
        return
    db.query(UserSession).filter(UserSession.token == token).delete()
    db.commit()


def _cleanup_user_expired(db: Session, user_id: int) -> None:
    """删除某用户已过期的会话记录。"""
    db.query(UserSession).filter(
        UserSession.user_id == user_id,
        UserSession.expires_at <= datetime.now(),
    ).delete()
    db.commit()


def cleanup_expired_sessions(db: Session) -> int:
    """删除全部已过期会话行，返回删除条数。

    登录时按用户顺带清理只覆盖活跃用户；不活跃用户的僵尸行由
    启动时的全量清理兜底（todo 第 13 条）。
    """
    deleted = (
        db.query(UserSession)
        .filter(UserSession.expires_at <= datetime.now())
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted

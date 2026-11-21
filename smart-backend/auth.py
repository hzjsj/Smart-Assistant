from datetime import datetime

from fastapi import Request, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from users.models import User, UserSession
from users.sessions import SESSION_COOKIE_NAME


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """从会话 Cookie 解析当前登录用户（单次 JOIN 合并 session+user 查询，todo 第 14 条）。

    通过 request.cookies 取值而非 Cookie() 声明，避免 FastAPI 把它登记进 OpenAPI
    parameters。会话校验走 users.sessions（数据库持久化，重启不丢）。

    校验完成后即断开会话：本依赖只读用户基本字段（无 lazy load），
    请求级长任务（分钟级上传处理等）不再占住连接池连接（todo 第 6 条）；
    需要 DB 的端点各自注入 get_db。
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    row = (
        db.query(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .filter(UserSession.token == token)
        .filter(UserSession.expires_at > datetime.now())
        .first()
    )
    if not row:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    _session, user = row
    db.close()
    return user


def get_current_userid(current_user: User = Depends(get_current_user)) -> str:
    """返回当前用户的业务 userid（字符串）。"""
    return current_user.userid


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """要求当前用户为管理员（access=='admin'），否则 403。用于用户管理等敏感接口。"""
    if current_user.access != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user

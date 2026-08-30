from fastapi import Request, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from users.models import User
from users.sessions import get_session_user_id


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """从 mock_token Cookie 解析当前登录用户。未登录或 token 失效抛 401。

    通过 request.cookies 取值而非 Cookie() 声明，避免 FastAPI 把它登记进 OpenAPI
    parameters。会话校验走 users.sessions（数据库持久化，重启不丢）。
    """
    mock_token = request.cookies.get("mock_token")
    user_id = get_session_user_id(db, mock_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


def get_current_userid(current_user: User = Depends(get_current_user)) -> str:
    """返回当前用户的业务 userid（字符串）。"""
    return current_user.userid


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """要求当前用户为管理员（access=='admin'），否则 403。用于用户管理等敏感接口。"""
    if current_user.access != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user

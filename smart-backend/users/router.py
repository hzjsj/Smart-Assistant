import json

from fastapi import APIRouter, Cookie, Query, Response, Depends
from sqlalchemy.orm import Session
from database import get_db
from users.schemas import (
    LoginParams, LoginResult, FakeCaptcha, ErrorResponse,
    CurrentUserResponse, CurrentUser, Geographic, Province, TagItem,
)
from users import crud
from users.models import User
from users.sessions import (
    create_session,
    delete_session,
    get_session_user_id,
    SESSION_TTL_DAYS,
)

router = APIRouter(tags=["用户管理"])


def _user_to_current_user(user: User) -> CurrentUser:
    tags = [TagItem(**t) for t in json.loads(user.tags or "[]")]
    geo = json.loads(user.geographic or "{}")
    geographic = Geographic(
        province=Province(**geo["province"]) if "province" in geo else Province(label="", key=""),
        city=Province(**geo["city"]) if "city" in geo else Province(label="", key=""),
    )
    return CurrentUser(
        name=user.name,
        avatar=user.avatar,
        userid=user.userid,
        email=user.email,
        signature=user.signature or "",
        title=user.title or "",
        group=user.group_name or "",
        tags=tags,
        notifyCount=user.notify_count,
        unreadCount=user.unread_count,
        country=user.country or "",
        access=user.access,
        geographic=geographic,
        address=user.address or "",
        phone=user.phone or "",
    )


# ── 认证接口 ─────────────────────────────────────────────────────────

@router.get("/api/currentUser", responses={401: {"model": ErrorResponse}})
def get_current_user(mock_token: str | None = Cookie(None), db: Session = Depends(get_db)):
    user_id = get_session_user_id(db, mock_token)
    if user_id is None:
        return Response(
            content=ErrorResponse(
                errorCode="401",
                errorMessage="请先登录！",
                success=False,
            ).model_dump_json(),
            status_code=401,
            media_type="application/json",
        )
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        return Response(
            content=ErrorResponse(errorCode="401", errorMessage="用户不存在", success=False).model_dump_json(),
            status_code=401,
            media_type="application/json",
        )
    return CurrentUserResponse(success=True, data=_user_to_current_user(user)).model_dump()


@router.post("/api/login/account", responses={401: {"model": ErrorResponse}})
def login_account(body: LoginParams, response: Response, db: Session = Depends(get_db)):
    user = crud.get_user_by_username(db, body.username)
    if not user or not crud.verify_password(body.password, user.password_hash):
        return LoginResult(status="error", type=body.type, currentAuthority="guest").model_dump()

    token = create_session(db, user.id)
    response.set_cookie(
        key="mock_token",
        value=token,
        httponly=False,
        samesite="lax",
        max_age=SESSION_TTL_DAYS * 24 * 3600,
    )
    return LoginResult(status="ok", type=body.type, currentAuthority=user.access).model_dump()


@router.post("/api/login/outLogin", responses={401: {"model": ErrorResponse}})
def logout(mock_token: str | None = Cookie(None), db: Session = Depends(get_db)):
    delete_session(db, mock_token)
    response = Response(content="{}", media_type="application/json")
    response.delete_cookie(key="mock_token")
    return response


@router.post("/api/login/captcha")
def get_captcha(phone: str | None = Query(None, description="手机号")):
    return FakeCaptcha().model_dump()

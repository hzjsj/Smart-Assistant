import json

from fastapi import APIRouter, Cookie, Depends, Query, Response
from sqlalchemy.orm import Session
from database import get_db
from auth import require_admin
from users.schemas import (
    LoginParams, LoginResult, FakeCaptcha, ErrorResponse,
    CurrentUserResponse, CurrentUser, Geographic, Province, TagItem,
    CreateUserRequest, UpdateUserRequest, DeleteUsersRequest,
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


# ── 用户 CRUD 接口（仅管理员）────────────────────────────────────────

@router.get("/api/users", responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}})
def list_users(
    current: int = Query(1, ge=1, description="页码"),
    pageSize: int = Query(10, ge=1, le=100, description="每页数量"),
    username: str | None = Query(None, description="用户名模糊搜索"),
    name: str | None = Query(None, description="姓名模糊搜索"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return crud.get_users(db, current, pageSize, username, name)


@router.post("/api/users", responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}})
def create_user(
    body: CreateUserRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if crud.get_user_by_username(db, body.username):
        return {"success": False, "errorMessage": "用户名已存在"}
    user = crud.create_user(
        db,
        username=body.username,
        password=body.password,
        name=body.name or body.username,
        email=body.email or "",
        phone=body.phone or "",
        title=body.title or "",
        group_name=body.group_name or "",
        access=body.access,
    )
    return {"success": True, "data": crud._to_dict(user)}


@router.put("/api/users/{user_id}", responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}})
def update_user(
    user_id: int,
    body: UpdateUserRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = crud.update_user(db, user_id, **body.model_dump(exclude_unset=True))
    if not user:
        return {"success": False, "errorMessage": "用户不存在"}
    return {"success": True, "data": crud._to_dict(user)}


@router.delete("/api/users", responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}})
def delete_users(
    body: DeleteUsersRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if admin.id in body.ids:
        return {"success": False, "errorMessage": "不能删除当前登录账号"}
    deleted = crud.delete_users(db, body.ids)
    return {"success": True, "deleted": deleted}

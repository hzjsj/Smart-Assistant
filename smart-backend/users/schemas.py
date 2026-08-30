from pydantic import BaseModel, Field
from typing import Optional


# ── 认证相关 schemas ────────────────────────────────────────────────

class TagItem(BaseModel):
    key: str
    label: str


class Province(BaseModel):
    label: str
    key: str


class Geographic(BaseModel):
    province: Province
    city: Province


class CurrentUser(BaseModel):
    name: str
    avatar: str
    userid: str
    email: str
    signature: str
    title: str
    group: str
    tags: list[TagItem]
    notifyCount: int
    unreadCount: int
    country: str
    access: str = ""
    geographic: Geographic
    address: str
    phone: str


class CurrentUserResponse(BaseModel):
    success: bool = True
    data: CurrentUser


class LoginParams(BaseModel):
    username: str
    password: str
    autoLogin: Optional[bool] = None
    type: str = "account"


class LoginResult(BaseModel):
    status: str
    type: str
    currentAuthority: str
    message: Optional[str] = None


class FakeCaptcha(BaseModel):
    code: int = 0
    status: str = "ok"


class ErrorResponse(BaseModel):
    errorCode: str = Field(description="业务约定的错误码")
    errorMessage: Optional[str] = Field(default=None, description="业务上的错误信息")
    success: bool = Field(description="业务上的请求是否成功")


# ── 用户 CRUD schemas ────────────────────────────────────────────────

class CreateUserRequest(BaseModel):
    """POST /api/users 请求体"""
    username: str = Field(min_length=1, description="用户名")
    password: str = Field(min_length=1, description="密码")
    name: Optional[str] = Field(default=None, description="姓名，缺省时使用 username")
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    group_name: Optional[str] = None
    access: str = Field(default="user", description="权限角色：admin / user")


class UpdateUserRequest(BaseModel):
    """PUT /api/users/{user_id} 请求体，全部字段可选；password 非空时重置密码"""
    name: Optional[str] = None
    password: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    group_name: Optional[str] = None
    access: Optional[str] = None


class DeleteUsersRequest(BaseModel):
    """DELETE /api/users 请求体"""
    ids: list[int] = Field(description="要删除的用户ID列表")


class UserItem(BaseModel):
    """用户列表项，不暴露 password_hash"""
    id: int
    username: str
    name: str
    avatar: str = ""
    userid: str = ""
    email: str = ""
    phone: str = ""
    title: str = ""
    group: str = ""
    access: str = ""


class UserList(BaseModel):
    data: list[UserItem]
    total: int = Field(description="总数")
    success: bool = True

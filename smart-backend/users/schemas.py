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

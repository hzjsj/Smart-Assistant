import os

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from database import get_db
from users.models import User
from users.schemas import ErrorResponse, LoginResult
from users.sessions import (
    create_session,
    set_session_cookie,
)
from wecom.client import WeComClient

router = APIRouter(prefix="/api/wecom", tags=["企业微信"])


@router.get("/check-env")
def check_wecom_env(request: Request):
    """判断当前浏览器是否在企业微信内置浏览器中，并下发前端拼授权链接所需配置。"""
    ua = request.headers.get("user-agent", "")
    is_wecom = "wxwork" in ua.lower()
    info = {
        "userAgent": ua,
        "ip": request.client.host if request.client else "",
        "host": request.headers.get("host", ""),
        "referer": request.headers.get("referer", ""),
        "origin": request.headers.get("origin", ""),
        "acceptLanguage": request.headers.get("accept-language", ""),
        "platform": request.headers.get("sec-ch-ua-platform", "").strip('"'),
        "mobile": request.headers.get("sec-ch-ua-mobile", "") == "?1",
    }
    config = {
        "CORPID": os.getenv("WECOM_CORPID", ""),
        "AGENTID": os.getenv("WECOM_AGENTID", ""),
        "REDIRECT_URI": os.getenv("WECOM_REDIRECT_URI", ""),
    }
    return {"isWxWork": is_wecom, "config": config, "info": info}


@router.get("/login", responses={401: {"model": ErrorResponse}})
async def wecom_login(
    code: str = Query(..., description="企业微信 OAuth 授权 code"),
    response: Response = None,
    db: Session = Depends(get_db),
):
    """企业微信登录：code 换 userid，按 userid 查找/自动注册用户并签发会话 cookie。"""
    try:
        result = await WeComClient.get_userinfo(code)
    except HTTPException as e:
        return LoginResult(
            status="error", type="wecom", currentAuthority="guest",
            message=f"企业微信请求失败: {e.detail}",
        )
    except Exception as e:
        return LoginResult(
            status="error", type="wecom", currentAuthority="guest",
            message=f"企业微信请求异常: {str(e)}",
        )
    if result.get("errcode", 0) != 0:
        return LoginResult(
            status="error", type="wecom", currentAuthority="guest",
            message=f"企业微信认证失败({result.get('errcode', -1)}): {result.get('errmsg', '未知错误')}",
        )

    wecom_userid = result.get("userid")
    if not wecom_userid:
        return LoginResult(
            status="error", type="wecom", currentAuthority="guest",
            message="企业微信返回数据异常：未获取到 userid",
        )

    # 按 userid 查找用户，不存在则自动注册（初始密码=用户名+123456，access=user）
    user = db.query(User).filter_by(userid=wecom_userid).first()
    if not user:
        # 企微用户初始密码设为「用户名+123456」，使其也能通过账密面板登录
        initial_password = f"{wecom_userid}123456"
        user = User(
            username=wecom_userid,
            password_hash=bcrypt.hashpw(initial_password.encode(), bcrypt.gensalt()).decode(),
            name=wecom_userid,
            userid=wecom_userid,
            access="user",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # 签发会话 + 写 cookie（与 /api/login/account 一致）
    token = create_session(db, user.id)
    set_session_cookie(response, token)
    return LoginResult(status="ok", type="wecom", currentAuthority=user.access).model_dump()

import os
import time

import httpx
from fastapi import HTTPException

WECOM_BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin"

# 内存缓存 access_token；修改 .env 配置后需重启后端生效
_token_cache: dict = {"token": None, "expires_at": 0}


def _get_corp_config() -> tuple[str, str]:
    """从 .env 读取企业微信凭证（corpid/corpsecret）。"""
    corpid = os.getenv("WECOM_CORPID", "")
    corpsecret = os.getenv("WECOM_CORPSECRET", "")
    if not corpid or not corpsecret:
        raise HTTPException(status_code=500, detail="未配置 WECOM_CORPID 或 WECOM_CORPSECRET")
    return corpid, corpsecret


class WeComClient:
    """企业微信 API 客户端（登录所需的最小实现），自动管理 access_token。"""

    @staticmethod
    async def get_token() -> str:
        """获取 access_token，带内存缓存（提前 300 秒过期）。"""
        if _token_cache["token"] and time.time() < _token_cache["expires_at"]:
            return _token_cache["token"]

        corpid, corpsecret = _get_corp_config()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{WECOM_BASE_URL}/gettoken",
                params={"corpid": corpid, "corpsecret": corpsecret},
            )
            data = resp.json()

        if data.get("errcode", 0) != 0:
            raise HTTPException(status_code=400, detail=f"获取token失败: {data.get('errmsg')}")

        _token_cache["token"] = data["access_token"]
        _token_cache["expires_at"] = time.time() + data.get("expires_in", 7200) - 300
        return _token_cache["token"]

    @staticmethod
    async def get_userinfo(code: str) -> dict:
        """通过 OAuth code 获取用户 userid。"""
        access_token = await WeComClient.get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{WECOM_BASE_URL}/auth/getuserinfo",
                params={"code": code, "access_token": access_token},
            )
            return resp.json()

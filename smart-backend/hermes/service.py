"""Hermes Agent 上游配置与 HTTP 调用。"""

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx
from .schemas import ChatCompletionRequest
from .workspace_prompt import build_upstream_payload

DEFAULT_BASE_URL = "http://127.0.0.1:8642/v1"
DEFAULT_MODEL = "hermes-agent"


class HermesError(Exception):
    """可安全返回给客户端的 Hermes 代理错误。"""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class HermesSettings:
    base_url: str
    api_key: str
    model: str
    timeout: httpx.Timeout


def get_settings() -> HermesSettings:
    api_key = os.getenv("HERMES_AGENT_API_KEY", "").strip()
    if not api_key:
        raise HermesError(500, "服务端未配置 HERMES_AGENT_API_KEY")

    try:
        connect_timeout = float(os.getenv("HERMES_AGENT_CONNECT_TIMEOUT", "10"))
        read_timeout = float(os.getenv("HERMES_AGENT_READ_TIMEOUT", "300"))
    except ValueError as exc:
        raise HermesError(500, "Hermes Agent 超时配置无效") from exc

    return HermesSettings(
        base_url=os.getenv("HERMES_AGENT_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        api_key=api_key,
        model=os.getenv("HERMES_AGENT_MODEL", DEFAULT_MODEL),
        timeout=httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=30,
            pool=connect_timeout,
        ),
    )


def get_headers(settings: HermesSettings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
    }


def upstream_error_detail(body: bytes) -> str:
    """仅提取上游公开错误消息，不把完整响应或配置返回给浏览器。"""
    try:
        payload = json.loads(body)
        error = payload.get("error", {})
        message = error.get("message") if isinstance(error, dict) else None
        if isinstance(message, str) and message.strip():
            return f"Hermes Agent 上游错误：{message.strip()[:500]}"
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        pass
    return "Hermes Agent 上游请求失败"


def upstream_status_code(status_code: int) -> int:
    if status_code == 429:
        return 429
    return 502


async def get_models() -> Any:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=settings.timeout) as client:
            response = await client.get(
                f"{settings.base_url}/models",
                headers=get_headers(settings),
            )
    except httpx.TimeoutException as exc:
        raise HermesError(504, "Hermes Agent 连接超时") from exc
    except httpx.RequestError as exc:
        raise HermesError(502, "无法连接 Hermes Agent 服务") from exc

    if response.is_error:
        raise HermesError(
            upstream_status_code(response.status_code),
            upstream_error_detail(response.content),
        )
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise HermesError(502, "Hermes Agent 返回了无效的模型数据") from exc


async def open_chat_stream(payload: dict[str, Any]) -> tuple[httpx.AsyncClient, httpx.Response]:
    """在开始向浏览器响应前打开并检查上游流。"""
    settings = get_settings()
    body = build_upstream_payload(ChatCompletionRequest.model_validate(payload), settings.model)
    client = httpx.AsyncClient(timeout=settings.timeout)
    try:
        request = client.build_request(
            "POST",
            f"{settings.base_url}/chat/completions",
            headers=get_headers(settings),
            json=body,
        )
        response = await client.send(request, stream=True)
        if response.is_error:
            error_body = await response.aread()
            detail = upstream_error_detail(error_body)
            status_code = upstream_status_code(response.status_code)
            await response.aclose()
            raise HermesError(status_code, detail)
        return client, response
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise HermesError(504, "Hermes Agent 连接超时") from exc
    except httpx.RequestError as exc:
        await client.aclose()
        raise HermesError(502, "无法连接 Hermes Agent 服务") from exc
    except Exception:
        await client.aclose()
        raise

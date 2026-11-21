"""Hermes Agent 上游配置与 HTTP 调用（骨架委托 chat_proxy 公共层）。"""

import json
from typing import Any

import httpx

from chat_proxy import (
    UpstreamError,
    UpstreamSettings,
    bearer_headers,
    load_settings,
    open_upstream_stream,
    upstream_error_detail as _shared_error_detail,
    upstream_status_code as _shared_status_code,
)
from .schemas import ChatCompletionRequest
from .workspace_prompt import build_upstream_payload

DEFAULT_BASE_URL = "http://127.0.0.1:8642/v1"
DEFAULT_MODEL = "hermes-agent"
_LABEL = "Hermes Agent"


class HermesError(UpstreamError):
    """可安全返回给客户端的 Hermes 代理错误。"""


# 兼容别名（Phase D 骨架统一后的过渡别名）
HermesSettings = UpstreamSettings


def get_settings() -> UpstreamSettings:
    return load_settings(
        env_prefix="HERMES_AGENT",
        default_base_url=DEFAULT_BASE_URL,
        default_model=DEFAULT_MODEL,
        error_cls=HermesError,
        label=_LABEL,
    )


def get_headers(settings: UpstreamSettings) -> dict[str, str]:
    return bearer_headers(settings, accept_sse=False)


def upstream_error_detail(body: bytes) -> str:
    return _shared_error_detail(body, _LABEL)


def upstream_status_code(status_code: int) -> int:
    return _shared_status_code(status_code)


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
    return await open_upstream_stream(
        settings,
        "/chat/completions",
        body,
        error_cls=HermesError,
        label=_LABEL,
    )

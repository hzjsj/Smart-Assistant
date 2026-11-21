"""聊天适配器公共 HTTP 骨架。

五份复制代理骨架（deepseek/hermes/openclaw/dify/bailian）的公共部分：
设置加载、鉴权头、上游错误清洗、状态码映射、流式打开与错误转换。
各适配器保留差异部分（Error 子类、payload 构造、特殊鉴权头）。
"""

import json
import os
from dataclasses import dataclass
from typing import Any, Type

import httpx


class UpstreamError(Exception):
    """可安全返回给客户端的上游代理错误（各适配器 Error 的基类）。"""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class UpstreamSettings:
    base_url: str
    api_key: str
    model: str
    timeout: httpx.Timeout


def load_settings(
    *,
    env_prefix: str,
    default_model: str,
    error_cls: Type[UpstreamError],
    label: str,
    default_base_url: str | None = None,
    default_connect_timeout: float = 10,
    write_timeout: float = 30,
) -> UpstreamSettings:
    """按 env 前缀读取 ``<PREFIX>_API_KEY/_BASE_URL/_MODEL/_CONNECT_TIMEOUT/_READ_TIMEOUT``。

    base_url 未配置且无默认值时报错（require 式，如 openclaw 必须显式配置）。
    """
    api_key = os.getenv(f"{env_prefix}_API_KEY", "").strip()
    if not api_key:
        raise error_cls(500, f"服务端未配置 {env_prefix}_API_KEY")

    base_url = os.getenv(f"{env_prefix}_BASE_URL", default_base_url or "").strip().rstrip("/")
    if not base_url:
        raise error_cls(500, f"服务端未配置 {env_prefix}_BASE_URL")

    try:
        connect_timeout = float(os.getenv(f"{env_prefix}_CONNECT_TIMEOUT", str(default_connect_timeout)))
        read_timeout = float(os.getenv(f"{env_prefix}_READ_TIMEOUT", "300"))
    except ValueError as exc:
        raise error_cls(500, f"{label} 超时配置无效") from exc

    return UpstreamSettings(
        base_url=base_url,
        api_key=api_key,
        model=os.getenv(f"{env_prefix}_MODEL", default_model),
        timeout=httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=write_timeout,
            pool=connect_timeout,
        ),
    )


def bearer_headers(settings: UpstreamSettings, *, accept_sse: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
    }
    if accept_sse:
        headers["Accept"] = "text/event-stream"
    return headers


def upstream_error_detail(body: bytes, label: str) -> str:
    """仅提取上游公开错误消息，不把完整响应或配置返回给浏览器。"""
    try:
        payload = json.loads(body)
        error = payload.get("error", {})
        message = error.get("message") if isinstance(error, dict) else None
        if isinstance(message, str) and message.strip():
            return f"{label} 上游错误：{message.strip()[:500]}"
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        pass
    return f"{label} 上游请求失败"


def upstream_status_code(status_code: int) -> int:
    """429 透传（限流原样告知），408 归并为 504，其余上游错误归并为 502。"""
    if status_code == 429:
        return 429
    if status_code == 408:
        return 504
    return 502


async def open_upstream_stream(
    settings: UpstreamSettings,
    path: str,
    body: dict[str, Any],
    *,
    error_cls: Type[UpstreamError],
    label: str,
    accept_sse: bool = False,
    headers: dict[str, str] | None = None,
) -> tuple[httpx.AsyncClient, httpx.Response]:
    """POST ``{base_url}{path}`` 并流式打开，错误响应转为 UpstreamError 抛出。

    调用方在拿到 (client, response) 后负责流式消费与最终 aclose
    （conversations.stream_upstream_with_recording 的既有约定）。
    """
    client = httpx.AsyncClient(timeout=settings.timeout)
    try:
        request = client.build_request(
            "POST",
            f"{settings.base_url}{path}",
            headers=headers if headers is not None else bearer_headers(settings, accept_sse=accept_sse),
            json=body,
        )
        response = await client.send(request, stream=True)
        if response.is_error:
            error_body = await response.aread()
            detail = upstream_error_detail(error_body, label)
            status_code = upstream_status_code(response.status_code)
            await response.aclose()
            raise error_cls(status_code, detail)
        return client, response
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise error_cls(504, f"{label} 连接超时") from exc
    except httpx.RequestError as exc:
        await client.aclose()
        raise error_cls(502, f"无法连接 {label} 服务") from exc
    except Exception:
        await client.aclose()
        raise

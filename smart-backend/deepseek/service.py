"""DeepSeek OpenAI 兼容接口配置与流式转发。"""

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"


class DeepSeekError(Exception):
    """可安全返回给客户端的 DeepSeek 代理错误。"""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class DeepSeekSettings:
    base_url: str
    api_key: str
    model: str
    timeout: httpx.Timeout


def get_settings() -> DeepSeekSettings:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise DeepSeekError(500, "服务端未配置 DEEPSEEK_API_KEY")

    try:
        connect_timeout = float(os.getenv("DEEPSEEK_CONNECT_TIMEOUT", "10"))
        read_timeout = float(os.getenv("DEEPSEEK_READ_TIMEOUT", "300"))
    except ValueError as exc:
        raise DeepSeekError(500, "DeepSeek 超时配置无效") from exc

    return DeepSeekSettings(
        base_url=os.getenv("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        api_key=api_key,
        model=os.getenv("DEEPSEEK_MODEL", DEFAULT_MODEL),
        timeout=httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=30,
            pool=connect_timeout,
        ),
    )


def get_headers(settings: DeepSeekSettings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }


def upstream_error_detail(body: bytes) -> str:
    """仅提取上游公开错误消息，不把完整响应或配置返回给浏览器。"""
    try:
        payload = json.loads(body)
        error = payload.get("error", {})
        message = error.get("message") if isinstance(error, dict) else None
        if isinstance(message, str) and message.strip():
            return f"DeepSeek 上游错误：{message.strip()[:500]}"
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        pass
    return "DeepSeek 上游请求失败"


def upstream_status_code(status_code: int) -> int:
    if status_code == 429:
        return 429
    return 502


def inject_images(
    messages: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """把图片附件以 image_url 内容块注入最后一条 user 消息。

    DeepSeek 图像理解要求图片仅出现在 user 消息中（system/assistant
    带图返回 400），因此只追加到最后一条 user 消息。
    """
    if not attachments:
        return messages
    target = next(
        (
            index
            for index in range(len(messages) - 1, -1, -1)
            if messages[index].get("role") == "user"
        ),
        None,
    )
    if target is None:
        raise DeepSeekError(422, "DeepSeek 对话需要至少一条用户消息来携带图片")
    message = messages[target]
    content = message.get("content")
    blocks: list[dict[str, Any]] = (
        [{"type": "text", "text": content}]
        if isinstance(content, str)
        else list(content or [])
    )
    for attachment in attachments:
        url = (attachment or {}).get("url") or ""
        if not url.startswith(("http://", "https://")):
            raise DeepSeekError(422, "图片附件地址无效")
        blocks.append({"type": "image_url", "image_url": {"url": url}})
    messages[target] = {**message, "content": blocks}
    return messages


async def open_chat_stream(
    payload: dict[str, Any],
) -> tuple[httpx.AsyncClient, httpx.Response]:
    """在开始向浏览器响应前打开并检查 DeepSeek 上游流。

    白名单转发：只传 model / messages / stream；附件图片注入消息后
    上传，前端本地字段（task 等 Hermes 专用字段）不透传，避免上游校验失败。
    """
    settings = get_settings()
    messages = inject_images(
        payload.get("messages") or [], payload.get("attachments") or []
    )
    body = {
        "model": payload.get("model") or settings.model,
        "messages": messages,
        "stream": True,
    }
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
            raise DeepSeekError(status_code, detail)
        return client, response
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise DeepSeekError(504, "DeepSeek 连接超时") from exc
    except httpx.RequestError as exc:
        await client.aclose()
        raise DeepSeekError(502, "无法连接 DeepSeek 服务") from exc
    except Exception:
        await client.aclose()
        raise

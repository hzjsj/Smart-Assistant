"""DeepSeek OpenAI 兼容接口配置与流式转发（骨架委托 chat_proxy 公共层）。"""

import os
from typing import Any

import httpx

from chat_proxy import (
    UpstreamError,
    UpstreamSettings,
    load_settings,
    open_upstream_stream,
    upstream_error_detail as _shared_error_detail,
    upstream_status_code as _shared_status_code,
)

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
_LABEL = "DeepSeek"


class DeepSeekError(UpstreamError):
    """可安全返回给客户端的 DeepSeek 代理错误。"""


# 兼容别名（Phase D 骨架统一后的过渡别名）
DeepSeekSettings = UpstreamSettings


def get_settings() -> UpstreamSettings:
    return load_settings(
        env_prefix="DEEPSEEK",
        default_base_url=DEFAULT_BASE_URL,
        default_model=DEFAULT_MODEL,
        error_cls=DeepSeekError,
        label=_LABEL,
    )


def get_headers(settings: UpstreamSettings) -> dict[str, str]:
    from chat_proxy import bearer_headers

    return bearer_headers(settings, accept_sse=True)


def upstream_error_detail(body: bytes) -> str:
    return _shared_error_detail(body, _LABEL)


def upstream_status_code(status_code: int) -> int:
    return _shared_status_code(status_code)


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
    return await open_upstream_stream(
        settings,
        "/chat/completions",
        body,
        error_cls=DeepSeekError,
        label=_LABEL,
        accept_sse=True,
    )

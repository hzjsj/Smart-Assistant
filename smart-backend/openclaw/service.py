"""OpenClaw Gateway OpenAI 兼容接口配置与流式转发。

上游是完整的 OpenClaw agent（自带系统提示词、技能与 40+ 工具），
因此多轮上下文交由上游会话维护：带 conversation_id 时以 ``user``
字段为会话键并只发最后一条用户消息；无会话 ID 时无状态转发完整
messages。上游输出标准 OpenAI SSE，直接交由 conversations 采集器
直通落库（deepseek 同款，无需适配器）。
"""

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://mcp.example.invalid/v1"  # 占位：必须显式配置
DEFAULT_MODEL = "openclaw/default"


class OpenClawError(Exception):
    """可安全返回给客户端的 OpenClaw 代理错误。"""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class OpenClawSettings:
    base_url: str
    api_key: str
    model: str
    timeout: httpx.Timeout


def get_settings() -> OpenClawSettings:
    api_key = os.getenv("OPENCLAW_API_KEY", "").strip()
    if not api_key:
        raise OpenClawError(500, "服务端未配置 OPENCLAW_API_KEY")

    base_url = os.getenv("OPENCLAW_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        raise OpenClawError(500, "服务端未配置 OPENCLAW_BASE_URL")

    try:
        connect_timeout = float(os.getenv("OPENCLAW_CONNECT_TIMEOUT", "15"))
        # OpenClaw agent 内部可能执行多轮工具循环，单次请求耗时较长。
        read_timeout = float(os.getenv("OPENCLAW_READ_TIMEOUT", "300"))
    except ValueError as exc:
        raise OpenClawError(500, "OpenClaw 超时配置无效") from exc

    return OpenClawSettings(
        base_url=base_url,
        api_key=api_key,
        model=os.getenv("OPENCLAW_MODEL", DEFAULT_MODEL),
        timeout=httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=60,
            pool=connect_timeout,
        ),
    )


def get_headers(settings: OpenClawSettings) -> dict[str, str]:
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
            return f"OpenClaw 上游错误：{message.strip()[:500]}"
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        pass
    return "OpenClaw 上游请求失败"


def upstream_status_code(status_code: int) -> int:
    if status_code == 429:
        return 429
    if status_code == 408:
        return 504
    return 502


def _content_to_text(content: str | list[dict[str, Any]]) -> str:
    """兼容纯文本与 OpenAI 内容块数组，只取文本段。"""
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "".join(parts)


def _append_attachment_hint(
    last_user: dict[str, Any], attachments: list[dict[str, Any]]
) -> dict[str, Any]:
    """把附件 URL 清单以文本提示追加进最后一条 user 消息。

    OpenClaw agent 自带文件处理工具（且网关禁 URL 抓图），由它按 URL
    自行取用；本代理不做 image_url/dataURI 转码。"""
    lines = ["[用户上传的参考资料]", "请结合以下附件回答；可按 URL 获取附件内容："]
    for index, attachment in enumerate(attachments, start=1):
        name = attachment.get("name") or "附件"
        lines.append(f"{index}. {name}: {attachment.get('url')}")
    hint = "\n".join(lines)
    content = last_user.get("content")
    text = content if isinstance(content, str) else _content_to_text(content)
    return {**last_user, "content": f"{text}\n\n{hint}"}


def build_upstream_payload(
    messages: list[dict[str, Any]],
    conversation_id: str | None,
    attachments: list[dict[str, Any]],
    model: str,
) -> dict[str, Any]:
    """按会话语义构造上游请求体。

    带 conversation_id：``user`` 即会话键，上游 agent 维护多轮上下文，
    只发最后一条用户消息（避免与上游记忆重复堆叠）；无会话 ID：无状态
    转发完整 messages。
    """
    if conversation_id:
        last_user = next(
            (
                message
                for message in reversed(messages)
                if message.get("role") == "user"
            ),
            None,
        )
        if last_user is None:
            raise OpenClawError(422, "OpenClaw 对话需要至少一条用户消息")
        outbound = [_append_attachment_hint(last_user, attachments) if attachments else last_user]
        return {"model": model, "user": conversation_id, "messages": outbound, "stream": True}

    outbound = list(messages)
    if attachments:
        last_user = next(
            (
                message
                for message in reversed(outbound)
                if message.get("role") == "user"
            ),
            None,
        )
        if last_user is not None:
            outbound[outbound.index(last_user)] = _append_attachment_hint(
                last_user, attachments
            )
    return {"model": model, "messages": outbound, "stream": True}


async def open_chat_stream(
    payload: dict[str, Any],
) -> tuple[httpx.AsyncClient, httpx.Response]:
    """在开始向浏览器响应前打开并检查 OpenClaw 上游流。

    白名单转发：只传 model / user / messages / stream；前端本地字段
    （task 等 Hermes 专用字段）不透传，避免上游校验失败。
    """
    settings = get_settings()
    body = build_upstream_payload(
        payload.get("messages") or [],
        payload.get("conversation_id"),
        payload.get("attachments") or [],
        settings.model,
    )
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
            raise OpenClawError(status_code, detail)
        return client, response
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise OpenClawError(504, "OpenClaw 连接超时") from exc
    except httpx.RequestError as exc:
        await client.aclose()
        raise OpenClawError(502, "无法连接 OpenClaw 服务") from exc
    except Exception:
        await client.aclose()
        raise

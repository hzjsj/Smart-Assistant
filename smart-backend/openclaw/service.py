"""OpenClaw Gateway OpenAI 兼容接口配置与流式转发（骨架委托 chat_proxy 公共层）。

上游是完整的 OpenClaw agent（自带系统提示词、技能与 40+ 工具），
因此多轮上下文交由上游会话维护：带 conversation_id 时以 ``user``
字段为会话键并只发最后一条用户消息；无会话 ID 时无状态转发完整
messages。上游输出标准 OpenAI SSE，直接交由 conversations 采集器
直通落库（deepseek 同款，无需适配器）。
"""

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

# 占位：必须显式配置 OPENCLAW_BASE_URL
DEFAULT_BASE_URL = None
DEFAULT_MODEL = "openclaw/default"
_LABEL = "OpenClaw"


class OpenClawError(UpstreamError):
    """可安全返回给客户端的 OpenClaw 代理错误。"""


# 兼容别名：既有测试与调用方以 OpenClawSettings 命名构造（Phase D 骨架统一后的过渡别名）
OpenClawSettings = UpstreamSettings


def get_settings() -> UpstreamSettings:
    return load_settings(
        env_prefix="OPENCLAW",
        default_base_url=DEFAULT_BASE_URL,
        default_model=DEFAULT_MODEL,
        error_cls=OpenClawError,
        label=_LABEL,
        default_connect_timeout=15,
        write_timeout=60,
    )


def get_headers(settings: UpstreamSettings) -> dict[str, str]:
    return bearer_headers(settings, accept_sse=True)


def upstream_error_detail(body: bytes) -> str:
    return _shared_error_detail(body, _LABEL)


def upstream_status_code(status_code: int) -> int:
    return _shared_status_code(status_code)


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
    return await open_upstream_stream(
        settings,
        "/chat/completions",
        body,
        error_cls=OpenClawError,
        label=_LABEL,
        accept_sse=True,
    )

"""百炼 Agent 2.0 应用对话：流式转发与事件翻译。

DashScope 应用接口（``POST {base}/{APP_ID}/completion``，Header
``X-DashScope-SSE: enable``）返回事件式 SSE，每帧形如::

    data: {"output": {"text": "...", "session_id": "...", "finish_reason": null},
           "usage": {...}, "request_id": "..."}

本项目既有的落库采集器（conversations/service.py）与前端 Provider 都按
OpenAI chunk 解析，因此这里用适配器把百炼事件翻译成 OpenAI 兼容帧，
从而复用权威落库、刷新续播与手动停止：

- ``output.text``（incremental_output=true 时为增量）→ ``delta.content``
- ``output.thoughts[].thought``（action=reasoning）→ ``delta.reasoning_content``
- ``output.session_id`` → 回调写回本地会话（多轮上下文由百炼维护）
- ``output.finish_reason == "stop"`` → 收尾 chunk（含 usage）+ ``[DONE]``
- 流内 ``{code, message}`` 错误帧 → 收尾 chunk（finish_reason=error）+ ``[DONE]``

已知限制：百炼应用接口无停止 API，手动停止只关闭本地上游读取（已生成部分
照常落库为 aborted）；思考过程仅在 ``enable_thinking``/``has_thoughts`` 开启
时由上游返回。
"""

import json
import os
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1/apps"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}


class BailianAgentError(Exception):
    """可安全返回给客户端的百炼代理错误。"""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class BailianSessionExpired(BailianAgentError):
    """本地保存的百炼 session 已失效，需清映射后作为新会话重开。"""


@dataclass(frozen=True)
class BailianAgentSettings:
    base_url: str
    api_key: str
    app_id: str
    timeout: httpx.Timeout


def get_settings(app_id: str | None = None) -> BailianAgentSettings:
    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        raise BailianAgentError(500, "服务端未配置 DASHSCOPE_API_KEY")

    resolved_app_id = (app_id or os.getenv("BAILIAN_APP_ID", "")).strip()
    if not resolved_app_id:
        raise BailianAgentError(500, "服务端未配置 BAILIAN_APP_ID")

    try:
        connect_timeout = float(os.getenv("BAILIAN_APP_CONNECT_TIMEOUT", "10"))
        read_timeout = float(os.getenv("BAILIAN_APP_READ_TIMEOUT", "300"))
    except ValueError as exc:
        raise BailianAgentError(500, "百炼应用超时配置无效") from exc

    return BailianAgentSettings(
        base_url=os.getenv("BAILIAN_APP_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        api_key=api_key,
        app_id=resolved_app_id,
        timeout=httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=30,
            pool=connect_timeout,
        ),
    )


def get_headers(settings: BailianAgentSettings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
        "X-DashScope-SSE": "enable",
    }


def _parse_error(body: bytes) -> tuple[str, str | None]:
    """提取 DashScope 公开错误消息与错误码，不返回完整响应或配置。"""
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "百炼上游请求失败", None
    if not isinstance(payload, dict):
        return "百炼上游请求失败", None
    code = payload.get("code") if isinstance(payload.get("code"), str) else None
    message = payload.get("message")
    if isinstance(message, str) and message.strip():
        return f"百炼上游错误：{message.strip()[:500]}", code
    return "百炼上游请求失败", code


def _is_session_expired(
    status_code: int, code: str | None, detail: str
) -> bool:
    """判断上游错误是否为 session 失效（需清映射后重开）。"""
    text = f"{code or ''} {detail or ''}".lower()
    if status_code == 404:
        return True
    if "session" not in text:
        return False
    return any(
        keyword in text
        for keyword in ("invalid", "not found", "notfound", "expired", "expire", "不存在", "过期")
    )


def upstream_status_code(status_code: int) -> int:
    if status_code == 429:
        return 429
    return 502


def build_lists(attachments: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """附件拆成 DashScope 的 ``image_list`` 与 ``file_list``（URL 直传）。"""
    images: list[str] = []
    files: list[str] = []
    for attachment in attachments:
        url = (attachment or {}).get("url") or ""
        if not url.startswith(("http://", "https://")):
            raise BailianAgentError(422, "附件地址无效")
        name = (attachment or {}).get("name") or ""
        ext = os.path.splitext(name.split("?")[0])[1].lower()
        if not ext:
            ext = os.path.splitext(url.split("?")[0])[1].lower()
        (images if ext in IMAGE_EXTS else files).append(url)
    return images, files


def extract_prompt(messages: list[dict[str, Any]]) -> str:
    """取最后一条 user 消息作为 prompt（多轮上下文由 session_id 维护）。"""
    last_user = next(
        (message for message in reversed(messages) if message.get("role") == "user"),
        None,
    )
    if last_user is None:
        raise BailianAgentError(422, "百炼对话需要至少一条用户消息")
    content = last_user.get("content")
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)


async def open_agent_stream(
    *,
    prompt: str,
    session_id: str | None,
    image_list: list[str],
    file_list: list[str],
    enable_thinking: bool = False,
    incremental_output: bool = True,
    app_id: str | None = None,
) -> tuple[httpx.AsyncClient, httpx.Response, BailianAgentSettings]:
    """在开始向浏览器响应前打开并检查百炼应用上游流。"""
    settings = get_settings(app_id=app_id)
    inputs: dict[str, Any] = {"prompt": prompt}
    if session_id:
        inputs["session_id"] = session_id
    if image_list:
        inputs["image_list"] = image_list
    if file_list:
        inputs["file_list"] = file_list

    body = {
        "input": inputs,
        "parameters": {
            "incremental_output": incremental_output,
            "enable_thinking": enable_thinking,
            # 只有显式要求时才回传思考过程，避免默认增加带宽与渲染噪音。
            "has_thoughts": enable_thinking,
        },
        "debug": {},
    }

    client = httpx.AsyncClient(timeout=settings.timeout)
    try:
        request = client.build_request(
            "POST",
            f"{settings.base_url}/{settings.app_id}/completion",
            headers=get_headers(settings),
            json=body,
        )
        response = await client.send(request, stream=True)
        if response.is_error:
            detail, code = _parse_error(await response.aread())
            expired = bool(session_id) and _is_session_expired(
                response.status_code, code, detail
            )
            await response.aclose()
            if expired:
                raise BailianSessionExpired(409, detail)
            raise BailianAgentError(upstream_status_code(response.status_code), detail)
        return client, response, settings
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise BailianAgentError(504, "百炼连接超时") from exc
    except httpx.RequestError as exc:
        await client.aclose()
        raise BailianAgentError(502, "无法连接百炼服务") from exc
    except Exception:
        await client.aclose()
        raise


def _sse_frame(payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload, ensure_ascii=False)
    return f"data: {body}\n\n".encode("utf-8")


def _done_frame() -> bytes:
    return b"data: [DONE]\n\n"


def _finish_frame(
    finish_reason: str,
    usage: dict[str, Any] | None = None,
    error: str | None = None,
) -> bytes:
    payload: dict[str, Any] = {
        "choices": [{"delta": {}, "finish_reason": finish_reason}]
    }
    if usage:
        payload["usage"] = usage
    if error:
        payload["error"] = {"message": error}
    return _sse_frame(payload)


def _map_usage(usage: Any) -> dict[str, Any] | None:
    """DashScope usage.models[] → OpenAI usage（多模型求和）。"""
    if not isinstance(usage, dict):
        return None
    models = usage.get("models")
    if not isinstance(models, list) or not models:
        return None
    prompt_tokens = 0
    completion_tokens = 0
    for model in models:
        if not isinstance(model, dict):
            continue
        prompt_tokens += int(model.get("input_tokens") or 0)
        completion_tokens += int(model.get("output_tokens") or 0)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


NON_TERMINAL_FINISH = {"", "null", "none"}


def _normalize_finish_reason(value: Any) -> str | None:
    """DashScope 非收尾帧把 finish_reason 写成字符串 "null"，按未结束处理。"""
    if value is None:
        return None
    reason = str(value).strip().lower()
    if not reason or reason in NON_TERMINAL_FINISH:
        return None
    return reason


def _split_frames(buffer: bytes) -> tuple[list[bytes], bytes]:
    frames: list[bytes] = []
    while b"\n\n" in buffer:
        raw, buffer = buffer.split(b"\n\n", 1)
        if raw.strip():
            frames.append(raw)
    return frames, buffer


def _parse_frame(raw: bytes) -> dict[str, Any] | None:
    data_lines: list[str] = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        if line.startswith("data:"):
            data_lines.append(line[5:].strip())
    if not data_lines:
        return None
    data = "\n".join(data_lines).strip()
    if not data or data == "[DONE]":
        return None
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


class BailianStreamAdapter:
    """把百炼事件流翻译成 OpenAI 兼容 SSE，供采集器与前端复用。

    采集器只调用 ``aiter_bytes`` 与 ``aclose``，因此可替代 ``httpx.Response``。
    """

    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        response: httpx.Response,
        on_session_id: Callable[[str], None] | None = None,
    ):
        self._client = client
        self._response = response
        self._on_session_id = on_session_id
        self._buffer = b""
        self._session_id: str | None = None
        self._usage: dict[str, Any] | None = None
        self._finished = False
        self._closed = False

    async def aiter_bytes(self) -> AsyncIterator[bytes]:
        async for chunk in self._response.aiter_bytes():
            self._buffer = (self._buffer + chunk).replace(b"\r\n", b"\n")
            frames, self._buffer = _split_frames(self._buffer)
            for frame in frames:
                for out in self._translate(frame):
                    yield out
                if self._finished:
                    return
        if self._buffer.strip():
            for out in self._translate(self._buffer):
                yield out
        if not self._finished:
            # 上游未给 finish_reason 就结束：补收尾帧，避免前端挂住。
            self._finished = True
            yield _finish_frame("stop", self._usage)
            yield _done_frame()

    def _translate(self, frame: bytes) -> Iterator[bytes]:
        payload = _parse_frame(frame)
        if payload is None:
            return

        # 流内错误帧（HTTP 200 但业务失败）：{"code": "...", "message": "..."}
        if "output" not in payload and payload.get("code"):
            message = payload.get("message")
            text = (
                str(message).strip()[:500]
                if isinstance(message, str) and message.strip()
                else "百炼生成失败"
            )
            self._finished = True
            yield _finish_frame("error", error=text)
            yield _done_frame()
            return

        output = payload.get("output")
        if not isinstance(output, dict):
            return

        # usage 只在收尾帧出现，先缓存，供 stop/兜底帧使用。
        usage = _map_usage(payload.get("usage"))
        if usage:
            self._usage = usage

        session_id = output.get("session_id")
        if (
            isinstance(session_id, str)
            and session_id
            and session_id != self._session_id
        ):
            self._session_id = session_id
            if self._on_session_id:
                self._on_session_id(session_id)

        text = output.get("text")
        if isinstance(text, str) and text:
            yield _sse_frame({"choices": [{"delta": {"content": text}}]})

        thoughts = output.get("thoughts")
        if isinstance(thoughts, list):
            for thought in thoughts:
                if not isinstance(thought, dict):
                    continue
                if (
                    thought.get("action") == "reasoning"
                    or thought.get("action_name") == "思考过程"
                ):
                    reasoning = thought.get("thought")
                    if isinstance(reasoning, str) and reasoning:
                        yield _sse_frame(
                            {"choices": [{"delta": {"reasoning_content": reasoning}}]}
                        )

        finish = _normalize_finish_reason(output.get("finish_reason"))
        if finish:
            self._finished = True
            yield _finish_frame(finish, self._usage)
            yield _done_frame()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            await self._response.aclose()
        finally:
            await self._client.aclose()

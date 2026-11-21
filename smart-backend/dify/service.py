"""Dify Agent 应用接口配置、事件流翻译与会话停止。

Dify 的流式返回是事件式 SSE（message / agent_message / agent_thought /
message_end / error ...），而本项目既有的落库采集器
（conversations/service.py）与前端 Provider 都按 OpenAI chunk 解析。
本模块把 Dify 事件翻译成 OpenAI 兼容帧，从而复用权威落库、刷新续播与
手动停止（前端零解析改动）：

- ``agent_message`` / ``message`` 增量 → ``choices[0].delta.content``
- ``agent_thought`` → ``delta.reasoning_content`` + ``hermes.tool.progress``
  自定义事件（复用现有工具链 UI）
- ``message_end`` → 收尾 chunk（finish_reason=stop + usage）+ ``[DONE]``
- ``error`` → 收尾 chunk（finish_reason=error + error.message）+ ``[DONE]``

已知限制：``message_replace``（内容安全替换）无法在追加式采集器里截断
重写，仅发提示；``workflow_*`` / ``node_*`` 事件不参与渲染。
"""

import asyncio
import json
import os
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from typing import Any

import httpx

from chat_proxy import UpstreamError, upstream_status_code as _shared_status_code

DEFAULT_BASE_URL = "https://api.dify.ai/v1"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


class DifyError(UpstreamError):
    """可安全返回给客户端的 Dify 代理错误。"""


class DifyConversationExpired(DifyError):
    """本地保存的 Dify 会话已失效（不存在/已完成），需清映射后重开。"""


@dataclass(frozen=True)
class DifySettings:
    base_url: str
    api_key: str
    timeout: httpx.Timeout


def get_settings() -> DifySettings:
    api_key = os.getenv("DIFY_API_KEY", "").strip()
    if not api_key:
        raise DifyError(500, "服务端未配置 DIFY_API_KEY")

    try:
        connect_timeout = float(os.getenv("DIFY_CONNECT_TIMEOUT", "10"))
        read_timeout = float(os.getenv("DIFY_READ_TIMEOUT", "300"))
    except ValueError as exc:
        raise DifyError(500, "Dify 超时配置无效") from exc

    return DifySettings(
        base_url=os.getenv("DIFY_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        api_key=api_key,
        timeout=httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=30,
            pool=connect_timeout,
        ),
    )


def get_headers(
    settings: DifySettings, *, accept: str = "text/event-stream"
) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
        "Accept": accept,
    }


def _parse_error(body: bytes) -> tuple[str, str | None]:
    """提取 Dify 公开错误消息与错误码，不把完整响应或配置返回浏览器。"""
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "Dify 上游请求失败", None
    if not isinstance(payload, dict):
        return "Dify 上游请求失败", None
    code = payload.get("code") if isinstance(payload.get("code"), str) else None
    message = payload.get("message")
    if isinstance(message, str) and message.strip():
        return f"Dify 上游错误：{message.strip()[:500]}", code
    return "Dify 上游请求失败", code


def upstream_status_code(status_code: int) -> int:
    return _shared_status_code(status_code)


def build_files(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """附件转 Dify ``files``：现有附件是 OSS 公网 URL → remote_url。"""
    files: list[dict[str, Any]] = []
    for attachment in attachments:
        url = (attachment or {}).get("url") or ""
        if not url.startswith(("http://", "https://")):
            raise DifyError(422, "附件地址无效")
        name = (attachment or {}).get("name") or ""
        ext = os.path.splitext(name.split("?")[0])[1].lower()
        if not ext:
            # 名称无扩展名时退回按 URL 路径判断（图片必须标 image，否则被拒）。
            ext = os.path.splitext(url.split("?")[0])[1].lower()
        files.append(
            {
                "type": "image" if ext in IMAGE_EXTS else "document",
                "transfer_method": "remote_url",
                "url": url,
            }
        )
    return files


def extract_query(messages: list[dict[str, Any]]) -> str:
    """取最后一条 user 消息作为 Dify query（上下文由上游会话维护）。"""
    last_user = next(
        (message for message in reversed(messages) if message.get("role") == "user"),
        None,
    )
    if last_user is None:
        raise DifyError(422, "Dify 对话需要至少一条用户消息")
    content = last_user.get("content")
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)


async def open_chat_stream(
    *,
    query: str,
    conversation_id: str | None,
    user: str,
    files: list[dict[str, Any]],
    inputs: dict[str, Any] | None = None,
) -> tuple[httpx.AsyncClient, httpx.Response, DifySettings]:
    """在开始向浏览器响应前打开并检查 Dify 上游流。"""
    settings = get_settings()
    body: dict[str, Any] = {
        "inputs": inputs or {},
        "query": query,
        "response_mode": "streaming",
        "user": user,
        # 标题由本项目按首条消息生成，避免 Dify 自动改名覆盖侧栏标题。
        "auto_generate_name": False,
    }
    if conversation_id:
        body["conversation_id"] = conversation_id
    if files:
        body["files"] = files

    client = httpx.AsyncClient(timeout=settings.timeout)
    try:
        request = client.build_request(
            "POST",
            f"{settings.base_url}/chat-messages",
            headers=get_headers(settings),
            json=body,
        )
        response = await client.send(request, stream=True)
        if response.is_error:
            detail, code = _parse_error(await response.aread())
            expired = conversation_id and (
                response.status_code == 404 or code == "conversation_completed"
            )
            await response.aclose()
            if expired:
                raise DifyConversationExpired(409, detail)
            raise DifyError(upstream_status_code(response.status_code), detail)
        return client, response, settings
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise DifyError(504, "Dify 连接超时") from exc
    except httpx.RequestError as exc:
        await client.aclose()
        raise DifyError(502, "无法连接 Dify 服务") from exc
    except Exception:
        await client.aclose()
        raise


def _sse_frame(payload: dict[str, Any], event: str | None = None) -> bytes:
    body = json.dumps(payload, ensure_ascii=False)
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {body}\n\n".encode("utf-8")


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


def _map_usage(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Dify message_end.metadata.usage → OpenAI usage。"""
    metadata = payload.get("metadata")
    raw = metadata.get("usage") if isinstance(metadata, dict) else None
    if not isinstance(raw, dict):
        return None
    return {
        "prompt_tokens": raw.get("prompt_tokens") or 0,
        "completion_tokens": raw.get("completion_tokens") or 0,
        "total_tokens": raw.get("total_tokens") or 0,
    }


def _split_frames(buffer: bytes) -> tuple[list[bytes], bytes]:
    """按 ``\\n\\n`` 切出完整 SSE 帧；半截帧留待下个 chunk。"""
    frames: list[bytes] = []
    while b"\n\n" in buffer:
        raw, buffer = buffer.split(b"\n\n", 1)
        if raw.strip():
            frames.append(raw)
    return frames, buffer


def _parse_frame(raw: bytes) -> tuple[str | None, dict[str, Any] | None]:
    """解析一帧：兼容 ``event:`` 行与 JSON 内 ``event`` 字段。"""
    event_name: str | None = None
    data_lines: list[str] = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].strip())
    if not data_lines:
        return event_name, None
    data = "\n".join(data_lines).strip()
    if not data or data == "[DONE]":
        return event_name, None
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return event_name, None
    if not isinstance(payload, dict):
        return event_name, None
    return event_name, payload


class DifyStreamAdapter:
    """把 Dify SSE 翻译成 OpenAI 兼容 SSE，供采集器与前端复用。

    采集器（conversations/service.py）只调用 ``aiter_bytes`` 与 ``aclose``，
    因此可直接替代 ``httpx.Response``：落库、节流刷新、终态与 abort 均沿用。
    """

    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        response: httpx.Response,
        settings: DifySettings,
        user: str,
        on_conversation_id: Callable[[str], None] | None = None,
    ):
        self._client = client
        self._response = response
        self._settings = settings
        self._user = user
        self._on_conversation_id = on_conversation_id
        self._buffer = b""
        self._task_id: str | None = None
        self._conversation_id: str | None = None
        self._saw_agent_message = False
        self._finished = False
        self._aborted = False
        self._closed = False

    async def aiter_bytes(self) -> AsyncIterator[bytes]:
        try:
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
                # 上游未发 message_end 就结束：补收尾帧，避免前端挂住。
                self._finished = True
                yield _finish_frame("stop")
                yield _done_frame()
        except (asyncio.CancelledError, GeneratorExit):
            # 仅用户手动停止会取消采集任务；客户端断开不会走到这里。
            self._aborted = True
            raise

    def _translate(self, frame: bytes) -> Iterator[bytes]:
        event_name, payload = _parse_frame(frame)
        if payload is None:
            return
        event = payload.get("event") or event_name or "message"

        task_id = payload.get("task_id")
        if isinstance(task_id, str) and task_id and not self._task_id:
            self._task_id = task_id
        upstream_id = payload.get("conversation_id")
        if (
            isinstance(upstream_id, str)
            and upstream_id
            and upstream_id != self._conversation_id
        ):
            self._conversation_id = upstream_id
            if self._on_conversation_id:
                self._on_conversation_id(upstream_id)

        if event in ("agent_message", "message"):
            answer = payload.get("answer")
            if not isinstance(answer, str) or not answer:
                return
            if event == "agent_message":
                self._saw_agent_message = True
            elif self._saw_agent_message:
                # Agent 应用收尾 message 携带完整答案，已由增量拼接，忽略。
                return
            yield _sse_frame({"choices": [{"delta": {"content": answer}}]})
            return

        if event == "agent_thought":
            thought = payload.get("thought")
            if isinstance(thought, str) and thought.strip():
                yield _sse_frame(
                    {"choices": [{"delta": {"reasoning_content": thought}}]}
                )
            tool = payload.get("tool")
            if isinstance(tool, str) and tool:
                observation = payload.get("observation")
                position = payload.get("position")
                yield _sse_frame(
                    {
                        "tool": tool,
                        "toolCallId": f"dify:{position if position is not None else tool}",
                        "label": tool,
                        "status": "completed" if observation else "running",
                        "message": observation if isinstance(observation, str) else "",
                    },
                    event="hermes.tool.progress",
                )
            return

        if event == "reasoning_chunk":
            data = payload.get("data")
            reasoning = data.get("reasoning") if isinstance(data, dict) else None
            if isinstance(reasoning, str) and reasoning:
                yield _sse_frame(
                    {"choices": [{"delta": {"reasoning_content": reasoning}}]}
                )
            return

        if event == "message_file":
            url = payload.get("url")
            if isinstance(url, str) and url:
                yield _sse_frame(
                    {"kind": "status", "text": f"已生成文件：{url}"},
                    event="hermes.status",
                )
            return

        if event == "message_replace":
            # 采集器只做追加，无法截断重写；提示用户刷新查看最终内容。
            yield _sse_frame(
                {"kind": "warning", "text": "部分内容已被内容安全策略替换。"},
                event="hermes.status",
            )
            return

        if event == "message_end":
            self._finished = True
            yield _finish_frame("stop", _map_usage(payload))
            yield _done_frame()
            return

        if event == "error":
            message = payload.get("message")
            text = (
                message.strip()[:500]
                if isinstance(message, str) and message.strip()
                else "Dify 生成失败"
            )
            self._finished = True
            yield _finish_frame("error", error=text)
            yield _done_frame()
            return

        # ping / workflow_* / node_* / agent_log 等不参与对话渲染。

    async def aclose(self) -> None:
        """关闭上游；手动停止时尽力通知 Dify 终止本次生成。"""
        if self._closed:
            return
        self._closed = True
        try:
            await self._response.aclose()
        finally:
            if self._aborted and self._task_id:
                asyncio.create_task(
                    _stop_upstream(self._settings, self._task_id, self._user)
                )
            await self._client.aclose()


async def _stop_upstream(settings: DifySettings, task_id: str, user: str) -> None:
    try:
        timeout = httpx.Timeout(connect=5, read=5, write=5, pool=5)
        async with httpx.AsyncClient(timeout=timeout) as client:
            await client.post(
                f"{settings.base_url}/chat-messages/{task_id}/stop",
                headers=get_headers(settings, accept="application/json"),
                json={"user": user},
            )
    except Exception:  # noqa: BLE001 停止为尽力而为，失败不影响本地落库
        pass


async def _get_json(path: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        timeout = httpx.Timeout(connect=10, read=30, write=10, pool=10)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                f"{settings.base_url}{path}",
                headers=get_headers(settings, accept="application/json"),
            )
            if response.is_error:
                detail, _code = _parse_error(await response.aread())
                raise DifyError(upstream_status_code(response.status_code), detail)
            payload = response.json()
            return payload if isinstance(payload, dict) else {}
    except httpx.TimeoutException as exc:
        raise DifyError(504, "Dify 连接超时") from exc
    except httpx.RequestError as exc:
        raise DifyError(502, "无法连接 Dify 服务") from exc


async def get_app_info() -> dict[str, Any]:
    """应用基本信息（名称/模式/标签），用于校验 key 与应用类型。"""
    return await _get_json("/info")


async def get_app_parameters() -> dict[str, Any]:
    """应用参数（inputs 表单、文件上传开关等）。"""
    return await _get_json("/parameters")

"""conversations 领域服务：流式转发 + 权威落库。

转发器把上游 SSE 读取与浏览器响应解耦：独立采集任务负责读上游、
解析增量并累积 assistant 消息；响应通道只消费队列做字节透传。
因此前端页面刷新 / 断线 / 超时只影响队列消费者，采集任务继续读
上游至 [DONE] 并落库——仅用户手动 abort 才终止（已生成部分落为
aborted）。四个 chat 端点（hermes/mineru/deepseek/dify）共用本转发器。
"""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any, Protocol

import httpx
from fastapi.responses import StreamingResponse

from database import SessionLocal

from . import crud


class StreamResponse(Protocol):
    """采集器只需「按字节读流 + 关闭」两项能力。

    上游既可以是 ``httpx.Response``，也可以是 Dify 等适配器
    （把事件流翻译成 OpenAI chunk 后再交给采集器落库）。
    """

    def aiter_bytes(self) -> AsyncIterator[bytes]: ...

    async def aclose(self) -> None: ...


# 进行中的采集任务注册表：conversation_id -> {"task": Task, "user_id": int}
# uvicorn 固定单进程运行（AGENTS.md 部署约定），内存注册表安全；扩容前须迁 Redis。
_active_streams: dict[str, dict[str, Any]] = {}


def abort_stream(conversation_id: str, user_id: int) -> bool:
    """取消会话进行中的采集任务（→ status=aborted 落库）。返回是否命中。"""
    entry = _active_streams.get(conversation_id)
    if entry is None or entry.get("user_id") != user_id:
        return False
    entry["task"].cancel()
    return True


def _parse_sse_events(buffer: bytes) -> tuple[list[dict], bytes]:
    """从字节缓冲里切出完整 SSE 事件并解析 JSON；半截事件留待下个 chunk。"""
    events: list[dict] = []
    while b"\n\n" in buffer:
        raw, buffer = buffer.split(b"\n\n", 1)
        text = raw.decode("utf-8", errors="replace").strip()
        if not text.startswith("data:"):
            continue
        data = text[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            events.append(json.loads(data))
        except json.JSONDecodeError:
            continue  # 非 JSON 事件（如心跳/注释）原样透传即可
    return events, buffer


def _accumulate(
    events: list[dict], state: dict[str, Any]
) -> None:
    """从解析后的 OpenAI chunk 中累积 content / reasoning_content / 收尾信息。"""
    for event in events:
        choice = (event.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        content = delta.get("content")
        reasoning = delta.get("reasoning_content")
        if isinstance(content, str):
            state["content"].append(content)
        if isinstance(reasoning, str):
            state["reasoning"].append(reasoning)
        if choice.get("finish_reason"):
            state["finish_reason"] = choice["finish_reason"]
        if event.get("usage"):
            state["usage"] = event["usage"]


def _snapshot_json(state: dict[str, Any]) -> str:
    return json.dumps(
        {
            "content": "".join(state["content"]),
            "reasoning_content": "".join(state["reasoning"]),
            "finish_reason": state["finish_reason"],
            "usage": state["usage"],
        },
        ensure_ascii=False,
    )


STREAM_FLUSH_INTERVAL = 0.8  # 秒：生成中内容的节流刷新间隔（供前端续播）


def stream_upstream_with_recording(
    *,
    client: httpx.AsyncClient,
    response: StreamResponse,
    user_id: int,
    conversation_id: str | None,
    model: str,
) -> StreamingResponse:
    """把上游流式响应包装为「透传 + 权威落库」的 StreamingResponse。

    流成功打开后先落 status=0 占位行，采集过程中节流刷新内容——
    前端刷新/断线后轮询即可拿到增长中的内容做续播渲染。
    """
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    # 流已成功打开：落占位行拿 message_id（会话无效则为 None，纯透传）。
    message_id: int | None = None
    if conversation_id:
        with SessionLocal() as db:
            placeholder = crud.begin_assistant_message(
                db, user_id=user_id, conversation_id=conversation_id
            )
            message_id = placeholder.id if placeholder else None

    async def _recording_task() -> None:
        state: dict[str, Any] = {
            "content": [],
            "reasoning": [],
            "finish_reason": None,
            "usage": None,
        }
        status = 1  # 1=done 2=error 3=aborted
        buffer = b""
        last_flush = 0.0
        try:
            # aiter_bytes 按 Content-Encoding 自动解压（上游可能 gzip SSE）。
            async for chunk in response.aiter_bytes():
                buffer += chunk
                events, buffer = _parse_sse_events(buffer)
                _accumulate(events, state)
                await queue.put(chunk)  # 无界队列：无消费者时亦不阻塞
                # 节流刷新生成中内容：前端刷新/断线后轮询可续播。
                now = asyncio.get_running_loop().time()
                if message_id and now - last_flush > STREAM_FLUSH_INTERVAL:
                    last_flush = now
                    with SessionLocal() as db:
                        crud.update_streaming_message(
                            db,
                            message_id=message_id,
                            content="".join(state["content"]),
                            content_json=_snapshot_json(state),
                        )
            if buffer:
                await queue.put(buffer)
        except asyncio.CancelledError:
            status = 3  # 用户手动终止：吞掉取消异常，finally 落已生成部分
        except Exception:  # noqa: BLE001 上游/网络异常，落 error 后继续收尾
            status = 2
        finally:
            try:
                await response.aclose()
            finally:
                await client.aclose()
            await queue.put(None)  # 响应通道结束信号（无消费者也无妨）
            _active_streams.pop(conversation_id or "", None)
            if message_id:
                # 采集任务脱离请求作用域，用独立 Session 落终态。
                with SessionLocal() as db:
                    crud.finish_assistant_message(
                        db,
                        message_id=message_id,
                        content="".join(state["content"]),
                        content_json=_snapshot_json(state),
                        status=status,
                        finish_reason=state["finish_reason"],
                        usage=(
                            json.dumps(state["usage"], ensure_ascii=False)
                            if state["usage"]
                            else None
                        ),
                        conversation_id=conversation_id or "",
                        user_id=user_id,
                    )

    task = asyncio.create_task(_recording_task())
    if conversation_id:
        _active_streams[conversation_id] = {"task": task, "user_id": user_id}

    async def _event_generator():
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            yield chunk
            # 客户端断开时本生成器被取消，采集任务不受影响继续落库。

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

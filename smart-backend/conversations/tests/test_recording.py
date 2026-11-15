"""conversations 采集转发器核心路径测试（不触网、不落真库）。

mock crud/SessionLocal，真实走 stream_upstream_with_recording 编排逻辑：
占位落库 → 节流刷新 → 终态落库；abort 注册表命中/越权；SSE 跨包半截
事件解析；异常与中止分支的 status 判定。
"""

import asyncio
import json
import unittest
from unittest.mock import patch

import conversations.service as service
from conversations.service import (
    _parse_sse_events,
    abort_stream,
    stream_upstream_with_recording,
)


def sse_event(payload: dict) -> bytes:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


class FakeSession:
    """替代 SessionLocal：上下文管理器形态，db 即自身。"""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeCrudRecorder:
    """记录 crud 调用序列，供断言编排顺序与终态参数。"""

    def __init__(self):
        self.calls = []
        self.next_id = 42

    def begin_assistant_message(self, db, *, user_id, conversation_id):
        self.calls.append(("begin", user_id, conversation_id))
        message_id = self.next_id
        self.next_id += 1
        return type("Row", (), {"id": message_id})()

    def update_streaming_message(self, db, *, message_id, content, content_json):
        self.calls.append(("update", message_id, content, content_json))

    def finish_assistant_message(
        self,
        db,
        *,
        message_id,
        content,
        content_json,
        status,
        finish_reason,
        usage,
        conversation_id,
        user_id,
    ):
        self.calls.append(
            ("finish", message_id, content, content_json, status, finish_reason, usage)
        )


class FakeResponse:
    """按脚本分片吐字节（模拟网络分包）；元素为 Exception 时在分片处抛错。"""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False

    async def aiter_bytes(self):
        for chunk in self._chunks:
            if isinstance(chunk, Exception):
                raise chunk
            yield chunk
            await asyncio.sleep(0.01)

    async def aclose(self):
        self.closed = True


class FakeClient:
    def __init__(self):
        self.closed = False

    async def aclose(self):
        self.closed = True


class RecordingTestBase(unittest.IsolatedAsyncioTestCase):
    """公共脚手架：patch crud/SessionLocal/节流间隔，收集消费字节与 crud 调用。"""

    def setUp(self):
        self.crud_recorder = FakeCrudRecorder()
        self.service = service
        for patcher in (
            patch("conversations.service.crud", self.crud_recorder),
            patch("conversations.service.SessionLocal", FakeSession),
            patch("conversations.service.STREAM_FLUSH_INTERVAL", 0.0),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    async def run_stream(
        self, response, user_id=1, conversation_id="c1"
    ) -> tuple[bytes, FakeCrudRecorder]:
        client = FakeClient()
        response_obj = stream_upstream_with_recording(
            client=client,
            response=response,
            user_id=user_id,
            conversation_id=conversation_id,
            model="unit-test",
        )
        collected = bytearray()
        async for chunk in response_obj.body_iterator:
            collected.extend(chunk)
        # 等采集任务收尾（finally 落库后才从注册表移除）
        for _ in range(100):
            entry = service._active_streams.get(conversation_id)
            if not entry:
                break
            await asyncio.wait_for(asyncio.shield(entry["task"]), timeout=5)
        return bytes(collected), self.crud_recorder


class NormalStreamTest(RecordingTestBase):
    async def test_full_flow_placeholder_updates_finish(self):
        reasoning2 = sse_event({"choices": [{"delta": {"reasoning_content": "想完"}}]})
        final = sse_event({
            "choices": [{"delta": {"content": "好"}, "finish_reason": "stop"}],
            "usage": {"total_tokens": 9},
        })
        cut = len(reasoning2) - 3  # 跨包半截：最后一个事件切成两段
        response = FakeResponse([
            sse_event({"choices": [{"delta": {"content": "你"}}]}),
            reasoning2[:cut],
            reasoning2[cut:],
            final,
            b"data: [DONE]\n\n",
        ])
        raw, recorder = await self.run_stream(response)

        # 消费端收齐全部字节（含 [DONE] 与重组后的完整帧）
        self.assertIn(b"data: [DONE]", raw)
        # 编排顺序：占位 → ≥1 次节流刷新 → 终态
        kinds = [call[0] for call in recorder.calls]
        self.assertEqual(kinds[0], "begin")
        self.assertIn("update", kinds)
        self.assertEqual(kinds[-1], "finish")
        finish_call = recorder.calls[-1]
        self.assertEqual(finish_call[0], "finish")
        self.assertEqual(finish_call[4], 1)  # status=done
        self.assertEqual(finish_call[5], "stop")
        self.assertIn('"total_tokens": 9', finish_call[6])  # usage 落库前序列化为 JSON 文本
        # 累积内容含"你好"，思考内容"想完"经跨包重组完整落地
        self.assertIn("你好", finish_call[2])
        self.assertIn("想完", finish_call[3])
        # 上游资源均被关闭
        self.assertTrue(response.closed)

    async def test_non_json_events_passthrough_without_breaking(self):
        raw, recorder = await self.run_stream(
            FakeResponse([
                b": heartbeat\n\n",
                b"data: not-json\n\n",
                sse_event({"choices": [{"delta": {"content": "ok"}}]}),
                b"data: [DONE]\n\n",
            ])
        )
        self.assertIn(b"not-json", raw)  # 非 JSON 事件原样透传
        self.assertIn(b": heartbeat", raw)
        self.assertEqual(recorder.calls[-1][4], 1)


class ErrorStreamTest(RecordingTestBase):
    async def test_upstream_error_marks_status_2_with_partial_content(self):
        response = FakeResponse([
            sse_event({"choices": [{"delta": {"content": "部分"}}]}),
            RuntimeError("上游断开"),
            sse_event({"choices": [{"delta": {"content": "不应出现"}}]}),
            b"data: [DONE]\n\n",
        ])
        raw, recorder = await self.run_stream(response)
        self.assertIn("部分".encode(), raw)
        self.assertNotIn("不应出现".encode(), raw)
        finish_call = [call for call in recorder.calls if call[0] == "finish"][0]
        self.assertEqual(finish_call[4], 2)  # status=error
        self.assertEqual(finish_call[2], "部分")


class AbortTest(RecordingTestBase):
    async def test_abort_marks_status_3(self):
        release = asyncio.Event()

        class SlowResponse(FakeResponse):
            def __init__(self):
                self.closed = False

            async def aiter_bytes(self):
                yield sse_event({"choices": [{"delta": {"content": "生成中"}}]})
                await release.wait()
                yield sse_event({"choices": [{"delta": {"content": "不应出现"}}]})
                yield b"data: [DONE]\n\n"

        conversation_id = "c-abort"
        client = FakeClient()
        response_obj = stream_upstream_with_recording(
            client=client,
            response=SlowResponse(),
            user_id=1,
            conversation_id=conversation_id,
            model="unit-test",
        )
        received = bytearray()

        async def consume():
            async for chunk in response_obj.body_iterator:
                received.extend(chunk)

        consumer = asyncio.create_task(consume())
        await asyncio.sleep(0.15)  # 等首块到达、采集任务入注册表
        self.assertTrue(abort_stream(conversation_id, user_id=1))
        await asyncio.wait_for(consumer, timeout=5)
        for _ in range(100):
            entry = self.service._active_streams.get(conversation_id)
            if not entry:
                break
            await asyncio.wait_for(asyncio.shield(entry["task"]), timeout=5)
        self.assertIn("生成中".encode(), received)
        self.assertNotIn("不应出现".encode(), received)
        finish_call = [call for call in self.crud_recorder.calls if call[0] == "finish"][0]
        self.assertEqual(finish_call[4], 3)  # status=aborted
        self.assertTrue(client.closed)


class AbortStreamRegistryTest(unittest.IsolatedAsyncioTestCase):
    async def test_registry_hit_miss_and_cross_user(self):
        class FakeTask:
            def __init__(self):
                self.cancelled = False

            def cancel(self):
                self.cancelled = True

        fake_task = FakeTask()
        service._active_streams["c1"] = {"task": fake_task, "user_id": 7}
        try:
            self.assertTrue(abort_stream("c1", user_id=7))
            self.assertTrue(fake_task.cancelled)
            self.assertFalse(abort_stream("c1", user_id=8))  # 越权用户
            self.assertFalse(abort_stream("unknown", user_id=7))  # 未知会话
        finally:
            service._active_streams.pop("c1", None)


class SseParseEdgeTest(unittest.TestCase):
    def test_split_events_across_chunks(self):
        buffer = b'data: {"a": 1}\n\ndata: {"a": 2'
        events, leftover = _parse_sse_events(buffer)
        self.assertEqual([e["a"] for e in events], [1])
        self.assertEqual(leftover, b'data: {"a": 2')

    def test_done_and_empty_lines_skipped(self):
        events, leftover = _parse_sse_events(
            b"data: [DONE]\n\ndata: \n\n\n\n.data: x\n\n"
        )
        self.assertEqual(events, [])
        self.assertEqual(leftover, b"")


if __name__ == "__main__":
    unittest.main()

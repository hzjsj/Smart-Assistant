"""Dify → OpenAI 事件翻译单元测试（不触网、不落库）。

覆盖：agent_message 增量与收尾 message 去重、agent_thought 思考/工具事件、
message_end 收尾与 usage、error 收尾、上游无 message_end 的兜底收尾，
并验证输出可被 conversations 采集器按 OpenAI chunk 累积。
"""

import json
import unittest

import httpx

from conversations.service import _accumulate, _parse_sse_events
from dify.service import DifyError, DifySettings, DifyStreamAdapter, build_files, extract_query


def dify_sse(*events: dict) -> bytes:
    return "".join(
        f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events
    ).encode("utf-8")


class DummyClient:
    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class DummyResponse:
    """按两段分片吐出字节，模拟网络分包（含跨包半截事件）。"""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload
        self.closed = False

    async def aiter_bytes(self):
        mid = len(self._payload) // 2
        yield self._payload[:mid]
        yield self._payload[mid:]

    async def aclose(self) -> None:
        self.closed = True


SETTINGS = DifySettings(
    base_url="https://example.test/v1",
    api_key="app-test",
    timeout=httpx.Timeout(1),
)


async def collect(adapter: DifyStreamAdapter) -> bytes:
    return b"".join([chunk async for chunk in adapter.aiter_bytes()])


def accumulate(raw: bytes) -> dict:
    state = {"content": [], "reasoning": [], "finish_reason": None, "usage": None}
    events, leftover = _parse_sse_events(raw)
    assert not leftover
    _accumulate(events, state)
    state["content"] = "".join(state["content"])
    state["reasoning"] = "".join(state["reasoning"])
    return state


class DifyStreamAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def make_adapter(self, payload: bytes, captured: list[str] | None = None):
        return DifyStreamAdapter(
            client=DummyClient(),
            response=DummyResponse(payload),
            settings=SETTINGS,
            user="u1",
            on_conversation_id=(captured.append if captured is not None else None),
        )

    async def test_agent_message_fragments_and_final_message_deduped(self):
        captured: list[str] = []
        adapter = await self.make_adapter(
            dify_sse(
                {
                    "event": "agent_message",
                    "task_id": "t1",
                    "message_id": "m1",
                    "conversation_id": "c1",
                    "answer": "你",
                },
                {
                    "event": "agent_message",
                    "task_id": "t1",
                    "conversation_id": "c1",
                    "answer": "好",
                },
                {
                    "event": "message",
                    "task_id": "t1",
                    "conversation_id": "c1",
                    "answer": "你好",
                },
                {
                    "event": "message_end",
                    "task_id": "t1",
                    "conversation_id": "c1",
                    "metadata": {
                        "usage": {
                            "prompt_tokens": 3,
                            "completion_tokens": 2,
                            "total_tokens": 5,
                        }
                    },
                },
            ),
            captured,
        )
        raw = await collect(adapter)
        state = accumulate(raw)
        # 收尾 message 的完整答案不重复拼接
        self.assertEqual(state["content"], "你好")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertEqual(state["usage"]["total_tokens"], 5)
        self.assertIn(b"data: [DONE]", raw)
        self.assertEqual(captured, ["c1"])
        self.assertEqual(adapter._task_id, "t1")

    async def test_chatflow_message_fragments_are_appended(self):
        adapter = await self.make_adapter(
            dify_sse(
                {"event": "message", "answer": "Hel"},
                {"event": "message", "answer": "lo"},
                {"event": "message_end", "metadata": {}},
            )
        )
        state = accumulate(await collect(adapter))
        self.assertEqual(state["content"], "Hello")
        self.assertEqual(state["finish_reason"], "stop")

    async def test_agent_thought_maps_to_reasoning_and_tool_progress(self):
        adapter = await self.make_adapter(
            dify_sse(
                {
                    "event": "agent_thought",
                    "position": 1,
                    "thought": "先搜索资料",
                    "tool": "web_search",
                    "tool_input": '{"q": "x"}',
                    "observation": "",
                },
                {
                    "event": "agent_thought",
                    "position": 1,
                    "thought": "",
                    "tool": "web_search",
                    "observation": "找到 3 条结果",
                },
                {"event": "agent_message", "answer": "结论"},
                {"event": "message_end", "metadata": {}},
            )
        )
        raw = await collect(adapter)
        state = accumulate(raw)
        self.assertEqual(state["reasoning"], "先搜索资料")
        self.assertEqual(state["content"], "结论")

        frames = [
            frame.decode("utf-8")
            for frame in raw.split(b"\n\n")
            if frame.strip()
        ]
        tool_frames = [
            frame for frame in frames if "hermes.tool.progress" in frame
        ]
        self.assertEqual(len(tool_frames), 2)
        first = json.loads(tool_frames[0].split("data: ", 1)[1])
        second = json.loads(tool_frames[1].split("data: ", 1)[1])
        self.assertEqual(first["tool"], "web_search")
        self.assertEqual(first["status"], "running")
        self.assertEqual(second["status"], "completed")
        self.assertEqual(second["message"], "找到 3 条结果")

    async def test_error_event_ends_stream_with_error_reason(self):
        adapter = await self.make_adapter(
            dify_sse(
                {"event": "agent_message", "answer": "部分"},
                {"event": "error", "status": 400, "code": "bad_request", "message": "boom"},
            )
        )
        raw = await collect(adapter)
        state = accumulate(raw)
        self.assertEqual(state["finish_reason"], "error")
        self.assertEqual(state["content"], "部分")
        self.assertIn(b'"message": "boom"', raw)
        self.assertIn(b"data: [DONE]", raw)

    async def test_stream_without_message_end_gets_synthetic_finish(self):
        adapter = await self.make_adapter(
            dify_sse({"event": "agent_message", "answer": "半截"})
        )
        raw = await collect(adapter)
        state = accumulate(raw)
        self.assertEqual(state["content"], "半截")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertTrue(raw.endswith(b"data: [DONE]\n\n"))

    async def test_ping_and_workflow_events_are_ignored(self):
        adapter = await self.make_adapter(
            dify_sse(
                {"event": "ping"},
                {"event": "workflow_started", "data": {}},
                {"event": "node_started", "data": {}},
                {"event": "message", "answer": "ok"},
                {"event": "message_end", "metadata": {}},
            )
        )
        state = accumulate(await collect(adapter))
        self.assertEqual(state["content"], "ok")
        self.assertEqual(state["reasoning"], "")


class DifyRequestMappingTest(unittest.TestCase):
    def test_build_files_uses_image_and_document_types(self):
        files = build_files(
            [
                {"url": "https://x.test/a.png", "name": "a.png"},
                {"url": "https://x.test/b.pdf", "name": "b.pdf"},
            ]
        )
        self.assertEqual([f["type"] for f in files], ["image", "document"])
        self.assertTrue(all(f["transfer_method"] == "remote_url" for f in files))

    def test_build_files_falls_back_to_url_extension(self):
        files = build_files([{"url": "https://x.test/c.JPG?sign=1"}])
        self.assertEqual(files[0]["type"], "image")

    def test_build_files_rejects_invalid_url(self):
        with self.assertRaises(DifyError):
            build_files([{"url": "file:///etc/passwd"}])

    def test_extract_query_uses_last_user_message(self):
        query = extract_query(
            [
                {"role": "user", "content": "第一问"},
                {"role": "assistant", "content": "回答"},
                {"role": "user", "content": "第二问"},
            ]
        )
        self.assertEqual(query, "第二问")

    def test_extract_query_requires_user_message(self):
        with self.assertRaises(DifyError):
            extract_query([{"role": "assistant", "content": "hi"}])


if __name__ == "__main__":
    unittest.main()

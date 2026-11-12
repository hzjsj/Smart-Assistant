"""百炼 Agent 2.0 事件翻译单元测试（不触网、不落库）。

覆盖：增量 text、thoughts→reasoning、usage/finish、流内错误、无 finish 兜底、
附件图片/文件分流、prompt 提取与 session 失效判定，并复用 conversations
采集器的解析函数断言落库结果。
"""

import json
import unittest

import httpx

from bailian.agent_service import (
    BailianAgentError,
    BailianStreamAdapter,
    _is_session_expired,
    build_lists,
    extract_prompt,
)
from conversations.service import _accumulate, _parse_sse_events


def dashscope_sse(*events: dict) -> bytes:
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


async def collect(adapter: BailianStreamAdapter) -> bytes:
    return b"".join([chunk async for chunk in adapter.aiter_bytes()])


def accumulate(raw: bytes) -> dict:
    state = {"content": [], "reasoning": [], "finish_reason": None, "usage": None}
    events, leftover = _parse_sse_events(raw)
    assert not leftover
    _accumulate(events, state)
    state["content"] = "".join(state["content"])
    state["reasoning"] = "".join(state["reasoning"])
    return state


class BailianStreamAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def make_adapter(self, payload: bytes, captured: list[str] | None = None):
        return BailianStreamAdapter(
            client=DummyClient(),
            response=DummyResponse(payload),
            on_session_id=(captured.append if captured is not None else None),
        )

    async def test_incremental_text_usage_and_session(self):
        captured: list[str] = []
        adapter = await self.make_adapter(
            dashscope_sse(
                {
                    "output": {"text": "你", "session_id": "s1", "finish_reason": None},
                    "request_id": "r1",
                },
                {
                    "output": {"text": "好", "session_id": "s1", "finish_reason": None},
                    "request_id": "r1",
                },
                {
                    "output": {"text": "", "session_id": "s1", "finish_reason": "stop"},
                    "usage": {
                        "models": [
                            {"model_id": "qwen-plus", "input_tokens": 3, "output_tokens": 2}
                        ]
                    },
                    "request_id": "r1",
                },
            ),
            captured,
        )
        raw = await collect(adapter)
        state = accumulate(raw)
        self.assertEqual(state["content"], "你好")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertEqual(state["usage"]["total_tokens"], 5)
        self.assertIn(b"data: [DONE]", raw)
        self.assertEqual(captured, ["s1"])

    async def test_thoughts_map_to_reasoning(self):
        adapter = await self.make_adapter(
            dashscope_sse(
                {
                    "output": {
                        "text": "答案",
                        "session_id": "s1",
                        "thoughts": [
                            {
                                "action": "reasoning",
                                "action_name": "思考过程",
                                "thought": "先分析",
                            }
                        ],
                        "finish_reason": "stop",
                    }
                }
            )
        )
        state = accumulate(await collect(adapter))
        self.assertEqual(state["reasoning"], "先分析")
        self.assertEqual(state["content"], "答案")

    async def test_usage_sums_multiple_models(self):
        adapter = await self.make_adapter(
            dashscope_sse(
                {
                    "output": {"text": "ok", "finish_reason": "stop"},
                    "usage": {
                        "models": [
                            {"input_tokens": 10, "output_tokens": 5},
                            {"input_tokens": 2, "output_tokens": 1},
                        ]
                    },
                }
            )
        )
        state = accumulate(await collect(adapter))
        self.assertEqual(state["usage"]["prompt_tokens"], 12)
        self.assertEqual(state["usage"]["completion_tokens"], 6)
        self.assertEqual(state["usage"]["total_tokens"], 18)

    async def test_stream_error_frame_finishes_with_error(self):
        adapter = await self.make_adapter(
            dashscope_sse(
                {"output": {"text": "部分", "finish_reason": None}},
                {"code": "InvalidParameter", "message": "boom", "request_id": "r2"},
            )
        )
        raw = await collect(adapter)
        state = accumulate(raw)
        self.assertEqual(state["content"], "部分")
        self.assertEqual(state["finish_reason"], "error")
        self.assertIn(b'"message": "boom"', raw)

    async def test_stream_without_finish_gets_synthetic_stop(self):
        adapter = await self.make_adapter(
            dashscope_sse({"output": {"text": "半截", "finish_reason": None}})
        )
        raw = await collect(adapter)
        state = accumulate(raw)
        self.assertEqual(state["content"], "半截")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertTrue(raw.endswith(b"data: [DONE]\n\n"))

    async def test_null_string_finish_reason_is_not_terminal(self):
        # 百炼非收尾帧的 finish_reason 是字符串 "null"，不能当作结束。
        adapter = await self.make_adapter(
            dashscope_sse(
                {"output": {"text": "你", "session_id": "s1", "finish_reason": "null"}},
                {"output": {"text": "好", "session_id": "s1", "finish_reason": "null"}},
                {
                    "output": {"text": "", "finish_reason": "stop"},
                    "usage": {"models": [{"input_tokens": 1, "output_tokens": 2}]},
                },
            )
        )
        state = accumulate(await collect(adapter))
        self.assertEqual(state["content"], "你好")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertEqual(state["usage"]["total_tokens"], 3)

    async def test_fallback_finish_reuses_cached_usage(self):
        adapter = await self.make_adapter(
            dashscope_sse(
                {"output": {"text": "ok", "finish_reason": "null"}},
                {
                    "output": {"text": "", "finish_reason": "null"},
                    "usage": {"models": [{"input_tokens": 4, "output_tokens": 6}]},
                },
            )
        )
        state = accumulate(await collect(adapter))
        self.assertEqual(state["content"], "ok")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertEqual(state["usage"]["total_tokens"], 10)

    async def test_session_callback_only_on_change(self):
        captured: list[str] = []
        adapter = await self.make_adapter(
            dashscope_sse(
                {"output": {"text": "a", "session_id": "s1"}},
                {"output": {"text": "b", "session_id": "s1"}},
                {"output": {"text": "c", "session_id": "s1", "finish_reason": "stop"}},
            ),
            captured,
        )
        await collect(adapter)
        self.assertEqual(captured, ["s1"])


class BailianRequestMappingTest(unittest.TestCase):
    def test_build_lists_splits_images_and_files(self):
        images, files = build_lists(
            [
                {"url": "https://x.test/a.png", "name": "a.png"},
                {"url": "https://x.test/b.pdf", "name": "b.pdf"},
                {"url": "https://x.test/c.JPG?sign=1"},
            ]
        )
        self.assertEqual(images, ["https://x.test/a.png", "https://x.test/c.JPG?sign=1"])
        self.assertEqual(files, ["https://x.test/b.pdf"])

    def test_build_lists_rejects_invalid_url(self):
        with self.assertRaises(BailianAgentError):
            build_lists([{"url": "file:///etc/passwd"}])

    def test_extract_prompt_uses_last_user_message(self):
        prompt = extract_prompt(
            [
                {"role": "user", "content": "第一问"},
                {"role": "assistant", "content": "回答"},
                {"role": "user", "content": "第二问"},
            ]
        )
        self.assertEqual(prompt, "第二问")

    def test_extract_prompt_requires_user_message(self):
        with self.assertRaises(BailianAgentError):
            extract_prompt([{"role": "assistant", "content": "hi"}])

    def test_session_expired_detection(self):
        self.assertTrue(_is_session_expired(404, None, "not found"))
        self.assertTrue(
            _is_session_expired(400, "InvalidParameter", "session not found")
        )
        self.assertFalse(_is_session_expired(400, "InvalidParameter", "prompt 太长"))
        self.assertFalse(_is_session_expired(200, None, "ok"))


if __name__ == "__main__":
    unittest.main()

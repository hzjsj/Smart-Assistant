"""LangChain Agent 适配器单元测试（不触网、不落库）。

覆盖：直答流（内容/usage/收尾）、工具调用循环（progress 事件 + ToolMessage
回灌）、reasoning_content 透传、多轮 usage 合计、轮数耗尽错误收尾、
aclose 取消标志，以及 calculator/fetch_url 工具本身（含 SSRF 拒绝路径）。
"""

import asyncio
import json
import unittest
from unittest.mock import patch

from langchain_core.messages import AIMessageChunk, ToolMessage

from conversations.service import _accumulate, _parse_sse_events
from langchain_agent.service import (
    LangChainSettings,
    LangChainStreamAdapter,
    _DONE,
)
from langchain_agent.tools import calculator, fetch_url


class MockChatModel:
    """脚本化模型：bind_tools 返回自身，astream 逐轮吐出预设 chunk 组。"""

    def __init__(self, rounds: list[list[AIMessageChunk]]) -> None:
        self.rounds = list(rounds)
        self.calls: list[list] = []

    def bind_tools(self, tools):
        self.bound_tools = tools
        return self

    async def astream(self, messages):
        self.calls.append(list(messages))
        chunks = self.rounds.pop(0) if self.rounds else []
        for chunk in chunks:
            yield chunk


def text_chunk(text: str) -> AIMessageChunk:
    return AIMessageChunk(content=text)


def reasoning_chunk(text: str) -> AIMessageChunk:
    return AIMessageChunk(content="", additional_kwargs={"reasoning_content": text})


def tool_call_chunk(call_id: str, expression: str) -> AIMessageChunk:
    return AIMessageChunk(
        content="",
        tool_calls=[
            {
                "name": "calculator",
                "args": {"expression": expression},
                "id": call_id,
                "type": "tool_call",
            }
        ],
    )


def usage_chunk(input_tokens: int, output_tokens: int) -> AIMessageChunk:
    return AIMessageChunk(
        content="",
        usage_metadata={
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
    )


async def collect(adapter: LangChainStreamAdapter) -> bytes:
    return b"".join([chunk async for chunk in adapter.aiter_bytes()])


def parse_named_events(raw: bytes, name: str) -> list[dict]:
    events = []
    for block in raw.split(b"\n\n"):
        text = block.decode("utf-8", errors="replace").strip()
        if f"event: {name}" not in text:
            continue
        for line in text.splitlines():
            if line.startswith("data:"):
                events.append(json.loads(line[5:].strip()))
    return events


def accumulate(raw: bytes) -> dict:
    state = {"content": [], "reasoning": [], "finish_reason": None, "usage": None}
    events, leftover = _parse_sse_events(raw)
    assert not leftover
    _accumulate(events, state)
    state["content"] = "".join(state["content"])
    state["reasoning"] = "".join(state["reasoning"])
    return state


def make_payload():
    from langchain_agent.schemas import LangChainChatMessage, LangChainChatRequest

    return LangChainChatRequest(
        messages=[LangChainChatMessage(role="user", content="帮我算 1+2")],
        conversation_id=None,
    )


SETTINGS = LangChainSettings(agent_model="deepseek-v4-flash", max_rounds=8)


class LangChainStreamAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def _run(self, rounds, settings=SETTINGS):
        payload = make_payload()
        model = MockChatModel(rounds)
        with patch("langchain_agent.service.get_chat_model", return_value=model):
            adapter = LangChainStreamAdapter(payload, settings)
            raw = await collect(adapter)
        return raw, model

    async def test_direct_answer_stream_and_usage(self):
        raw, model = await self._run(
            [[text_chunk("你"), text_chunk("好"), usage_chunk(10, 5)]]
        )
        state = accumulate(raw)
        self.assertEqual(state["content"], "你好")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertEqual(state["usage"]["total_tokens"], 15)
        self.assertIn(b"data: [DONE]", raw)
        # 未发生工具调用：只进行了一轮
        self.assertEqual(len(model.calls), 1)
        self.assertNotIn(b"hermes.tool.progress", raw)

    async def test_tool_call_loop_with_progress_events(self):
        raw, model = await self._run(
            [
                [tool_call_chunk("call_1", "1+2")],
                [text_chunk("结果是 3"), usage_chunk(20, 10)],
            ]
        )
        state = accumulate(raw)
        self.assertEqual(state["content"], "结果是 3")
        self.assertEqual(state["finish_reason"], "stop")
        progress = parse_named_events(raw, "hermes.tool.progress")
        statuses = [(event["status"], event["toolCallId"]) for event in progress]
        self.assertEqual(statuses, [("running", "lc:0:0"), ("completed", "lc:0:0")])
        self.assertIn("计算结果：1+2 = 3", progress[1]["message"])
        # 第二轮消息里回灌了 ToolMessage（结果给模型参考）
        tool_messages = [m for m in model.calls[1] if isinstance(m, ToolMessage)]
        self.assertEqual(len(tool_messages), 1)
        self.assertIn("计算结果：1+2 = 3", tool_messages[0].content)
        self.assertEqual(tool_messages[0].tool_call_id, "call_1")
        # 两轮 usage 合计
        self.assertEqual(state["usage"]["total_tokens"], 30)

    async def test_reasoning_chunks_map_to_reasoning_content(self):
        raw, _ = await self._run([[reasoning_chunk("先想想"), text_chunk("答案")]])
        state = accumulate(raw)
        self.assertEqual(state["reasoning"], "先想想")
        self.assertEqual(state["content"], "答案")

    async def test_max_rounds_exhausted_yields_error_finish(self):
        raw, _ = await self._run(
            [[tool_call_chunk("call_1", "1")], [tool_call_chunk("call_2", "2")]],
            LangChainSettings(agent_model="deepseek-v4-flash", max_rounds=2),
        )
        state = accumulate(raw)
        self.assertEqual(state["finish_reason"], "error")
        self.assertIn("已连续执行 2 轮工具仍未收敛", raw.decode("utf-8"))
        self.assertIn(b"data: [DONE]", raw)

    async def test_aclose_sets_cancelled_flag(self):
        adapter = LangChainStreamAdapter(make_payload(), SETTINGS)
        self.assertFalse(adapter._cancelled.is_set())
        await adapter.aclose()
        self.assertTrue(adapter._cancelled.is_set())

    async def test_empty_model_output_gets_synthetic_stop(self):
        raw, _ = await self._run([[]])
        state = accumulate(raw)
        self.assertEqual(state["finish_reason"], "stop")
        self.assertIn(b"data: [DONE]", raw)


class CalculatorToolTest(unittest.IsolatedAsyncioTestCase):
    async def test_basic_arithmetic(self):
        result = await calculator.ainvoke({"expression": "(1+2)*3"})
        self.assertEqual(result, "计算结果：(1+2)*3 = 9")

    async def test_division_and_float_normalization(self):
        result = await calculator.ainvoke({"expression": "10/4"})
        self.assertEqual(result, "计算结果：10/4 = 2.5")
        result = await calculator.ainvoke({"expression": "10/2"})
        self.assertEqual(result, "计算结果：10/2 = 5")

    async def test_rejects_non_arithmetic_input(self):
        result = await calculator.ainvoke({"expression": "__import__('os').system('ls')"})
        self.assertTrue(result.startswith("计算失败"))
        result = await calculator.ainvoke({"expression": "os.getcwd()"})
        self.assertTrue(result.startswith("计算失败"))

    async def test_rejects_huge_power(self):
        result = await calculator.ainvoke({"expression": "9**99"})
        self.assertTrue(result.startswith("计算失败"))


class FetchUrlGuardTest(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_private_ip(self):
        result = await fetch_url.ainvoke({"url": "http://192.168.1.1/admin"})
        self.assertIn("拒绝直接以 IP 访问", result)

    async def test_rejects_localhost(self):
        result = await fetch_url.ainvoke({"url": "http://localhost:5000/docs"})
        self.assertIn("拒绝访问内网/本机地址", result)

    async def test_rejects_non_http_scheme(self):
        result = await fetch_url.ainvoke({"url": "ftp://example.com/file"})
        self.assertIn("仅支持 http/https", result)


if __name__ == "__main__":
    unittest.main()

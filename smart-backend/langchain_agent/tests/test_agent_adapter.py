"""LangChain Agent 适配器单元测试（不触网、不落库）。

覆盖：直答流（内容/usage/收尾）、工具调用循环（progress 事件 + ToolMessage
回灌）、reasoning_content 透传、多轮 usage 合计、轮数耗尽错误收尾、
aclose 取消标志，以及 calculator/fetch_url 工具本身（含 SSRF 拒绝路径）。
"""

import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from langchain_core.messages import AIMessageChunk, ToolMessage

from conversations.service import _accumulate, _parse_sse_events
from langchain_agent.service import (
    LangChainSettings,
    LangChainStreamAdapter,
    _DONE,
)
from langchain_agent.tools import (
    calculator,
    fetch_page,
    fetch_url,
    get_tools,
    web_search,
)


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


SETTINGS = LangChainSettings(
    agent_model="deepseek-v4-flash",
    max_rounds=8,
    enable_web_tools=False,
    enable_mcp_tools=False,
)


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
            LangChainSettings(
                agent_model="deepseek-v4-flash",
                max_rounds=2,
                enable_web_tools=False,
                enable_mcp_tools=False,
            ),
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


def _http_error(status: int) -> httpx.HTTPStatusError:
    """构造带状态码的 httpx.HTTPStatusError（模拟 DeepSeek 错误响应）。"""
    request = httpx.Request("POST", "https://api.deepseek.com/v1/tools/search")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError(f"HTTP {status}", request=request, response=response)


class DeepSeekWebToolsTest(unittest.IsolatedAsyncioTestCase):
    """web_search / fetch_page：mock _deepseek_post 验证请求与结果格式化。"""

    async def test_web_search_success_formats_results(self):
        captured: dict = {}

        async def fake_post(path, payload):
            captured["path"] = path
            captured["payload"] = payload
            return {
                "results": [
                    {
                        "title": "DeepSeek V4 模型发布",
                        "url": "https://example.com/deepseek-v4",
                        "date": "2026-06-01T00:00:00+00:00",
                        "summary": "DeepSeek 发布了 V4 模型，改进工具调用。",
                    },
                    {"title": "第二条", "url": "https://example.com/2", "summary": ""},
                ]
            }

        with patch("langchain_agent.tools._deepseek_post", side_effect=fake_post):
            result = await web_search.ainvoke({"query": "DeepSeek V4 发布"})
        self.assertEqual(captured["path"], "/v1/tools/search")
        self.assertEqual(captured["payload"]["need_content"], False)
        self.assertEqual(captured["payload"]["count"], 5)
        self.assertIn("[DeepSeek V4 模型发布](https://example.com/deepseek-v4)", result)
        self.assertIn("（发布：2026-06-01）", result)
        self.assertIn("摘要：DeepSeek 发布了 V4 模型", result)
        self.assertIn("共 2 条结果", result)

    async def test_web_search_count_clamped(self):
        captured: dict = {}

        async def fake_post(path, payload):
            captured["payload"] = payload
            return {"results": []}

        with patch("langchain_agent.tools._deepseek_post", side_effect=fake_post):
            result = await web_search.ainvoke({"query": "test", "count": 50})
        self.assertEqual(captured["payload"]["count"], 10)
        self.assertIn("没有找到相关结果", result)

    async def test_web_search_error_codes_become_text(self):
        cases = {
            402: "余额不足",
            429: "限速",
            403: "安全策略",
            404: "目标不可用",
            401: "DEEPSEEK_API_KEY 无效",
        }
        for status, keyword in cases.items():
            async def fake_post(path, payload, _status=status):
                raise _http_error(_status)

            with patch("langchain_agent.tools._deepseek_post", side_effect=fake_post):
                result = await web_search.ainvoke({"query": "test"})
            self.assertIn(keyword, result, f"HTTP {status} 应转成含「{keyword}」的提示")

    async def test_web_search_empty_query(self):
        result = await web_search.ainvoke({"query": "   "})
        self.assertIn("query 不能为空", result)

    async def test_fetch_page_success_with_truncation(self):
        async def fake_post(path, payload):
            self.assertEqual(path, "/v1/tools/fetch")
            self.assertEqual(payload["url"], "https://example.com/article")
            return {"title": "示例文章", "content": "# 示例文章\n\n正文内容。"}

        with patch("langchain_agent.tools._deepseek_post", side_effect=fake_post):
            result = await fetch_page.ainvoke({"url": "https://example.com/article"})
        self.assertIn("# 示例文章", result)
        self.assertIn("正文内容。", result)

    async def test_fetch_page_truncates_long_content(self):
        async def fake_post(path, payload):
            return {"title": "长文", "content": "长" * (64 * 1024)}

        with patch("langchain_agent.tools._deepseek_post", side_effect=fake_post):
            result = await fetch_page.ainvoke({"url": "https://example.com/long"})
        self.assertIn("（内容超长已截断）", result)
        self.assertLessEqual(len(result.encode("utf-8")), 32 * 1024 + 200)

    async def test_fetch_page_rejects_credentials_in_url(self):
        result = await fetch_page.ainvoke({"url": "https://user:pass@example.com/a"})
        self.assertIn("不能携带用户名或密码", result)


class GetToolsRegistryTest(unittest.TestCase):
    def test_base_tools_without_web(self):
        tools = get_tools(False)
        names = {t.name for t in tools}
        self.assertEqual(names, {"current_time", "calculator", "fetch_url"})

    def test_web_tools_enabled(self):
        tools = get_tools(True)
        names = {t.name for t in tools}
        self.assertEqual(
            names, {"current_time", "calculator", "fetch_url", "web_search", "fetch_page"}
        )

    def test_resolve_env_explicit_overrides_key_presence(self):
        from langchain_agent.service import _resolve_web_tools_env

        with patch.dict(
            "os.environ",
            {"LANGCHAIN_ENABLE_WEB_TOOLS": "false", "DEEPSEEK_API_KEY": "sk-x"},
            clear=False,
        ):
            self.assertFalse(_resolve_web_tools_env())
        with patch.dict(
            "os.environ",
            {"LANGCHAIN_ENABLE_WEB_TOOLS": "true", "DEEPSEEK_API_KEY": ""},
            clear=False,
        ):
            self.assertTrue(_resolve_web_tools_env())
        with patch.dict(
            "os.environ",
            {"LANGCHAIN_ENABLE_WEB_TOOLS": "", "DEEPSEEK_API_KEY": ""},
            clear=False,
        ):
            self.assertFalse(_resolve_web_tools_env())  # 无 key 默认关闭


class McpToolsTest(unittest.IsolatedAsyncioTestCase):
    """MinerU MCP 工具加载：开关/缓存/失败回退。"""

    def _reset_cache(self):
        import langchain_agent.mcp_tools as mcp_tools_module

        mcp_tools_module._cached_tools = None
        return mcp_tools_module

    async def test_disabled_when_token_missing(self):
        module = self._reset_cache()
        with patch.dict("os.environ", {"MINERU_MCP_TOKEN": ""}, clear=False):
            self.assertFalse(module.mcp_enabled())
            tools = await module.load_mcp_tools()
        self.assertEqual(tools, [])

    async def test_load_success_merges_parse_documents(self):
        module = self._reset_cache()

        class FakeMcpTool:
            name = "parse_documents"

        class FakeClient:
            def __init__(self, config):
                FakeClient.config = config

            async def get_tools(self):
                return [FakeMcpTool()]

        with (
            patch.dict(
                "os.environ",
                {
                    "MINERU_MCP_TOKEN": "sk-test",
                    "MINERU_MCP_URL": "https://mcp.mineru.net/mcp",
                    "MINERU_MCP_TRANSPORT": "streamable_http",
                },
                clear=False,
            ),
            patch(
                "langchain_mcp_adapters.client.MultiServerMCPClient", FakeClient
            ),
        ):
            self.assertTrue(module.mcp_enabled())
            tools = await module.load_mcp_tools()
        self.assertEqual([t.name for t in tools], ["parse_documents"])
        # 鉴权头与端点配置正确（托管端点用同名自定义头，非 Bearer）
        connection = FakeClient.config["mineru"]
        self.assertEqual(connection["transport"], "streamable_http")
        self.assertEqual(
            connection["headers"]["MINERU_API_TOKEN"], "sk-test"
        )
        # 二次调用走缓存，不再新建客户端
        tools_again = await module.load_mcp_tools()
        self.assertEqual(tools_again, tools)

    async def test_stdio_transport_builds_local_command(self):
        module = self._reset_cache()

        class FakeMcpTool:
            name = "parse_documents"

        class FakeClient:
            def __init__(self, config):
                FakeClient.config = config

            async def get_tools(self):
                return [FakeMcpTool()]

        with (
            patch.dict(
                "os.environ",
                {
                    "MINERU_MCP_TOKEN": "sk-test",
                    "MINERU_MCP_TRANSPORT": "stdio",
                    "MINERU_MCP_COMMAND": "/usr/local/bin/uvx",
                },
                clear=False,
            ),
            patch(
                "langchain_mcp_adapters.client.MultiServerMCPClient", FakeClient
            ),
        ):
            tools = await module.load_mcp_tools()
        self.assertEqual([t.name for t in tools], ["parse_documents"])
        connection = FakeClient.config["mineru"]
        self.assertEqual(connection["transport"], "stdio")
        self.assertEqual(connection["command"], "/usr/local/bin/uvx")
        self.assertEqual(connection["args"], ["mineru-open-mcp"])
        self.assertEqual(connection["env"]["MINERU_API_TOKEN"], "sk-test")

    def test_attachment_hint_routes_documents_to_mcp_parse(self):
        from langchain_agent.schemas import (
            LangChainChatAttachment,
            LangChainChatMessage,
            LangChainChatRequest,
        )
        from langchain_agent.service import _build_lc_messages, _build_system_prompt

        def make_request(url: str) -> LangChainChatRequest:
            return LangChainChatRequest(
                messages=[LangChainChatMessage(role="user", content="解析附件")],
                attachments=[LangChainChatAttachment(url=url, name="课件.pptx")],
            )

        # 文档附件 + MCP 启用 → 引导 parse_documents，并禁止降级抓取
        messages = _build_lc_messages(make_request("https://oss.example.com/a.pptx"), True, ["parse_documents"])
        system_text = messages[0].content
        last_user = messages[-1].content
        self.assertIn("parse_documents", last_user)
        self.assertIn("课件.pptx", last_user)
        self.assertIn("请勿改用 fetch_url/fetch_page", last_user)
        self.assertIn("只使用 parse_documents", system_text)
        self.assertIn("严禁改用 fetch_url/fetch_page", system_text)

        # 文档附件但 MCP 未启用 → 如实告知不支持，不引导任何抓取工具
        messages = _build_lc_messages(make_request("https://oss.example.com/a.pptx"), True, None)
        self.assertIn("未启用", messages[-1].content)
        self.assertIn("暂不支持解析", messages[-1].content)
        self.assertIn("文档解析服务（MinerU）未启用", _build_system_prompt(True, None))

        # 非文档附件（txt）仍走 fetch_url
        messages = _build_lc_messages(
            LangChainChatRequest(
                messages=[LangChainChatMessage(role="user", content="看下附件")],
                attachments=[LangChainChatAttachment(url="https://oss.example.com/notes.txt", name="notes.txt")],
            ),
            True,
            ["parse_documents"],
        )
        self.assertIn("fetch_url", messages[-1].content)

    def test_build_connection_defaults(self):
        module = self._reset_cache()
        with patch.dict(
            "os.environ",
            {
                "MINERU_MCP_TOKEN": "sk-x",
                "MINERU_MCP_URL": "https://mcp.mineru.net/mcp",
                "MINERU_MCP_TRANSPORT": "",
            },
            clear=False,
        ):
            connection = module._build_connection()["mineru"]
        self.assertEqual(connection["transport"], "streamable_http")
        self.assertEqual(connection["url"], "https://mcp.mineru.net/mcp")

    async def test_load_failure_falls_back_to_empty(self):
        module = self._reset_cache()

        async def broken_get_tools():
            raise RuntimeError("MCP 不可用")

        class BrokenClient:
            def __init__(self, config):
                pass

            async def get_tools(self):
                return await broken_get_tools()

        with (
            patch.dict("os.environ", {"MINERU_MCP_TOKEN": "sk-test"}, clear=False),
            patch(
                "langchain_mcp_adapters.client.MultiServerMCPClient", BrokenClient
            ),
        ):
            tools = await module.load_mcp_tools()
        self.assertEqual(tools, [])  # 失败回退空列表，不抛异常


if __name__ == "__main__":
    unittest.main()

"""OpenClaw 代理单元测试（不触网、不落库）。

覆盖：上游 payload 构造（带会话只发末条用户消息 + user 会话键；
无会话无状态转发）、附件文本提示注入、鉴权头、错误映射。
"""

import json
import unittest
from unittest.mock import patch

import httpx

from openclaw.service import (
    OpenClawError,
    build_upstream_payload,
    get_headers,
    upstream_error_detail,
    upstream_status_code,
)


class BuildUpstreamPayloadTest(unittest.TestCase):
    MESSAGES = [
        {"role": "user", "content": "第一问：Hermes 是什么？"},
        {"role": "assistant", "content": "Hermes 是一个智能体框架。"},
        {"role": "user", "content": "第二问：它有哪些特点？"},
    ]

    def test_with_conversation_sends_only_last_user_and_session_key(self):
        body = build_upstream_payload(self.MESSAGES, "conv-uuid-1", [], "openclaw/default")
        self.assertEqual(body["user"], "conv-uuid-1")
        self.assertEqual(
            body["messages"],
            [{"role": "user", "content": "第二问：它有哪些特点？"}],
        )
        self.assertTrue(body["stream"])

    def test_without_conversation_sends_full_messages_stateless(self):
        body = build_upstream_payload(self.MESSAGES, None, [], "openclaw/default")
        self.assertNotIn("user", body)
        self.assertEqual(len(body["messages"]), 3)

    def test_attachments_injected_as_text_hint_into_last_user(self):
        body = build_upstream_payload(
            self.MESSAGES,
            "conv-uuid-1",
            [{"url": "https://oss.example.com/a.pptx", "name": "课件.pptx"}],
            "openclaw/default",
        )
        content = body["messages"][0]["content"]
        self.assertIn("第二问", content)
        self.assertIn("课件.pptx: https://oss.example.com/a.pptx", content)
        self.assertIn("可按 URL 获取附件内容", content)

    def test_reserved_namespace_guard_is_client_side(self):
        # 会话键由后端从 conversations 表 UUID 生成（无冒号前缀风险）；
        # 保留命名空间（subagent:/cron:/acp:）不会出现在 user 字段中。
        body = build_upstream_payload(self.MESSAGES, "0f0e9d8c-1111-2222-3333-444455556666", [], "m")
        self.assertFalse(body["user"].startswith(("subagent:", "cron:", "acp:")))


class HeadersAndErrorsTest(unittest.TestCase):
    def test_headers_use_bearer(self):
        from openclaw.service import OpenClawSettings

        settings = OpenClawSettings(
            base_url="https://gw.example/v1",
            api_key="sk-test",
            model="openclaw/default",
            timeout=httpx.Timeout(10),
        )
        headers = get_headers(settings)
        self.assertEqual(headers["Authorization"], "Bearer sk-test")
        self.assertEqual(headers["Accept"], "text/event-stream")

    def test_upstream_error_detail_extracts_message(self):
        body = json.dumps(
            {"error": {"message": "agent 主循环超时", "type": "server_error"}}
        ).encode()
        detail = upstream_error_detail(body)
        self.assertIn("OpenClaw 上游错误", detail)
        self.assertIn("agent 主循环超时", detail)

    def test_upstream_error_detail_safe_on_garbage(self):
        self.assertEqual(upstream_error_detail(b"<html>"), "OpenClaw 上游请求失败")

    def test_status_mapping(self):
        self.assertEqual(upstream_status_code(429), 429)
        self.assertEqual(upstream_status_code(408), 504)
        self.assertEqual(upstream_status_code(500), 502)
        self.assertEqual(upstream_status_code(404), 502)

    def test_missing_key_raises_at_settings(self):
        from openclaw.service import get_settings

        with patch.dict("os.environ", {"OPENCLAW_API_KEY": ""}, clear=False):
            with self.assertRaises(OpenClawError) as ctx:
                get_settings()
        self.assertEqual(ctx.exception.status_code, 500)


if __name__ == "__main__":
    unittest.main()

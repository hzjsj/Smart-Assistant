"""Request-scoped paper prompts, normal chat, and actual proxy forwarding."""

import copy
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
from pydantic import ValidationError

from auth import get_current_user
from hermes.router import router
from hermes.schemas import ChatCompletionRequest
from hermes.workspace_prompt import WORKSPACE_INSTRUCTIONS, build_upstream_payload


CONFIG = {
    "subject": "数学", "grade": "初中一年级",
    "knowledge_points": ["数与式", "方程与不等式", "函数"],
    "question_types": ["选择题", "填空题", "计算题"],
    "quantity": 9, "difficulty": 5, "exam_type": "期末考试", "remarks": "完整解析",
}
SSE = b'event: hermes.tool.progress\ndata: {"tool":"test","status":"completed"}\n\ndata: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'


def paper_request():
    return {"task": "question_bank", "paper_config": copy.deepcopy(CONFIG), "messages": [{"role": "user", "content": "用户看到的表单摘要"}], "stream": True}


class ChatRequestTests(unittest.TestCase):
    def test_form_parameters_build_canonical_requirements_and_only_one_policy(self):
        payload = paper_request()
        payload["messages"] = [{"role": "system", "content": "客户端的系统文本"}, *payload["messages"]]
        request = ChatCompletionRequest.model_validate(payload)
        body = build_upstream_payload(request, "server-model")
        self.assertEqual(body["model"], "server-model")
        self.assertNotIn("task", body)
        self.assertNotIn("paper_config", body)
        self.assertEqual(body["messages"][0], {"role": "system", "content": WORKSPACE_INSTRUCTIONS})
        self.assertEqual(len(body["messages"]), 2)
        content = body["messages"][-1]["content"]
        for expected in ("总题数严格为 9 题", "选择题3题、填空题3题、计算题3题", "数与式、方程与不等式、函数", "完整解析", "5/10"):
            self.assertIn(expected, content)
        self.assertEqual(request.messages[-1].content, "用户看到的表单摘要")

    def test_followup_preserves_history_without_reapplying_generation_policy(self):
        messages = [
            {"role": "user", "content": "表单摘要，9题"},
            {"role": "assistant", "content": '```question-bank\n{"id":"saved-bank"}\n```'},
            {"role": "user", "content": "请解释第2题"},
        ]
        request = ChatCompletionRequest.model_validate({"messages": messages})
        body = build_upstream_payload(request, "server-model")
        self.assertEqual(body["messages"], messages)
        self.assertNotIn("system", [message["role"] for message in body["messages"]])
        self.assertNotIn("task", body)

    def test_new_chat_has_no_generation_settings(self):
        build_upstream_payload(ChatCompletionRequest.model_validate(paper_request()), "server-model")
        body = build_upstream_payload(ChatCompletionRequest.model_validate({"messages": [{"role": "user", "content": "你好"}]}), "server-model")
        self.assertEqual(body["messages"], [{"role": "user", "content": "你好"}])

    def test_invalid_and_mixed_request_parameters_are_rejected(self):
        invalid = [
            {"task": "question_bank", "messages": [{"role": "user", "content": "组卷"}]},
            {**paper_request(), "task": "chat"},
            {**paper_request(), "task": "unknown"},
            {**paper_request(), "messages": [{"role": "assistant", "content": "组卷"}]},
            {**paper_request(), "unexpected": True},
        ]
        for field, value in (("quantity", 0), ("quantity", 51), ("quantity", True), ("difficulty", 11), ("grade", " "), ("remarks", "长" * 4001), ("quantity", 2)):
            payload = paper_request()
            payload["paper_config"][field] = value
            invalid.append(payload)
        for payload in invalid:
            with self.subTest(payload=payload.get("task")), self.assertRaises(ValidationError):
                ChatCompletionRequest.model_validate(payload)

    def test_config_normalization_and_empty_optional_choices(self):
        payload = paper_request()
        payload["paper_config"].update(knowledge_points=[" 数与式 ", "数与式"], question_types=[], remarks=" ")
        request = ChatCompletionRequest.model_validate(payload)
        self.assertEqual(request.paper_config.knowledge_points, ["数与式"])
        content = build_upstream_payload(request, "server-model")["messages"][-1]["content"]
        self.assertIn("题型：根据科目和年级合理安排", content)
        self.assertNotIn("【用户备注】", content)

    def test_http_proxy_keeps_sse_and_consumes_custom_fields_before_upstream(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        forwarded = []
        def upstream(request):
            self.assertEqual(str(request.url), "https://agent.example/v1/chat/completions")
            forwarded.append(json.loads(request.content))
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=httpx.ByteStream(SSE))
        original_client = httpx.AsyncClient
        def make_client(**kwargs):
            return original_client(transport=httpx.MockTransport(upstream), **kwargs)
        with patch.dict(os.environ, {"HERMES_AGENT_API_KEY": "test-key", "HERMES_AGENT_BASE_URL": "https://agent.example/v1"}), patch("hermes.service.httpx.AsyncClient", side_effect=make_client), TestClient(app) as client:
            for payload in (paper_request(), {"messages": [{"role": "user", "content": "后续提问"}]}, {"messages": [{"role": "user", "content": "新对话"}]}):
                response = client.post("/api/hermes/v1/chat/completions", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.content, SSE)
                self.assertEqual(response.headers["x-accel-buffering"], "no")
            before = len(forwarded)
            self.assertEqual(client.post("/api/hermes/v1/chat/completions", json={**paper_request(), "task": "chat"}).status_code, 422)
            self.assertEqual(len(forwarded), before)
        self.assertEqual(forwarded[0]["messages"][0]["content"], WORKSPACE_INSTRUCTIONS)
        self.assertEqual(forwarded[1]["messages"], [{"role": "user", "content": "后续提问"}])
        self.assertEqual(forwarded[2]["messages"], [{"role": "user", "content": "新对话"}])
        for body in forwarded:
            self.assertNotIn("task", body)
            self.assertNotIn("paper_config", body)


if __name__ == "__main__":
    unittest.main()

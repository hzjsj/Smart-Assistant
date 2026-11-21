"""conversations 领域模块：跨模型（hermes/deepseek）的会话与消息持久化。

核心设计：后端为流式对话的权威——前端页面刷新 / 断线 / 超时只影响响应
通道，独立采集任务继续读完上游 SSE 并落库；仅用户手动 abort 才终止。

对外稳定 API（Phase D 收口，todo 第 29 条）：所有聊天适配器只允许依赖
以下导出，不得触碰模块内部实现。
"""
from conversations.crud import record_user_message  # noqa: F401
from conversations.service import (  # noqa: F401
    abort_stream,
    accumulate_stream_events,
    parse_sse_events,
    stream_upstream_with_recording,
)

__all__ = [
    "abort_stream",
    "accumulate_stream_events",
    "parse_sse_events",
    "record_user_message",
    "stream_upstream_with_recording",
]

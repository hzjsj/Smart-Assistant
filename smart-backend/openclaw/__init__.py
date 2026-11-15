"""OpenClaw 网关对话代理模块（第六种对话后端）。

OpenClaw Gateway 提供标准 OpenAI 兼容接口（/v1/chat/completions + SSE），
采用 deepseek 同款直通透传模式。多轮上下文走上游会话：``user`` 字段
（= conversations 表 ID）相同即复用同一 agent 会话，故带会话 ID 时只发
最后一条用户消息，避免与上游 agent 自带记忆重复堆叠。
"""

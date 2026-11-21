"""模型注册表与 LangChain 工厂 —— 已迁至 chat_proxy.providers（ARCHITECTURE.md Phase D）。

本模块保留为兼容垫片：chat 模块与外部引用继续走原导入路径，
新代码请直接 `from chat_proxy.providers import ...`。
"""
from chat_proxy.providers import (  # noqa: F401
    DEFAULT_MODEL,
    MODELS,
    PROVIDERS,
    ReasoningChatOpenAI,
    extract_reasoning,
    get_chat_model,
    get_context_tokens,
    list_models,
)

__all__ = [
    "DEFAULT_MODEL",
    "MODELS",
    "PROVIDERS",
    "ReasoningChatOpenAI",
    "extract_reasoning",
    "get_chat_model",
    "get_context_tokens",
    "list_models",
]

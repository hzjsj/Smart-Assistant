"""模型注册表与 LangChain ChatOpenAI 工厂。

三个平台均为 OpenAI 兼容端点，统一用 langchain-openai 的 ChatOpenAI 接入；
深度思考参数各家不同，按 provider 映射：
- deepseek / bailian: extra_body={"enable_thinking": bool}
- ark:                extra_body={"thinking": {"type": "enabled"/"disabled"}}
"""
import os

from langchain_core.messages import AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk
from langchain_openai import ChatOpenAI

PROVIDERS = {
    "deepseek": {
        "api_key_env": "DEEPSEEK_API_KEY",
        "base_url_env": "DEEPSEEK_BASE_URL",
        "base_url": "https://api.deepseek.com",
        "label": "DeepSeek",
    },
    "bailian": {
        "api_key_env": "BAILIAN_API_KEY",
        "base_url_env": "BAILIAN_BASE_URL",
        "base_url": "https://llm-5tl2i6iigxxczoc1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        "label": "百炼",
    },
    "ark": {
        "api_key_env": "ARK_API_KEY",
        "base_url_env": "ARK_BASE_URL",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "label": "豆包",
    },
}


def _context_env_key(model: str) -> str:
    return "MODEL_CONTEXT_" + model.upper().replace("-", "_").replace(".", "_")


def get_context_tokens(model: str) -> int:
    """模型上下文窗口（tokens），支持 .env 按模型覆盖（如 MODEL_CONTEXT_QWEN3_8_MAX=262144）。"""
    meta = MODELS[model]
    return int(os.getenv(_context_env_key(model), str(meta["context_tokens"])))


MODELS: dict[str, dict] = {
    # ── DeepSeek ────────────────────────────────────────────────
    "deepseek-v4-flash": {
        "provider": "deepseek", "context_tokens": 131072, "supports_thinking": True,
    },
    "deepseek-v4-pro": {
        "provider": "deepseek", "context_tokens": 131072, "supports_thinking": True,
    },
    "deepseek-v4-flash-vision-exp": {
        "provider": "deepseek", "context_tokens": 131072, "supports_thinking": True,
    },
    # ── 阿里云百炼 ───────────────────────────────────────────────
    "qwen3.7-plus": {
        "provider": "bailian", "context_tokens": 131072, "supports_thinking": True,
    },
    "qwen3.8-flash": {
        "provider": "bailian", "context_tokens": 131072, "supports_thinking": True,
    },
    "qwen3.8-max": {
        "provider": "bailian", "context_tokens": 131072, "supports_thinking": True,
    },
    # ── 火山方舟（豆包）──────────────────────────────────────────
    "doubao-seed-2-1-pro-260628": {
        "provider": "ark", "context_tokens": 262144, "supports_thinking": True,
    },
    "doubao-seed-2-1-turbo-260628": {
        "provider": "ark", "context_tokens": 262144, "supports_thinking": True,
    },
    "doubao-seed-evolving": {
        "provider": "ark", "context_tokens": 262144, "supports_thinking": True,
    },
}

DEFAULT_MODEL = "deepseek-v4-flash"


def list_models() -> list[dict]:
    """前端模型选择器数据源（按 provider 分组字段 + label）。"""
    items = []
    for name, meta in MODELS.items():
        provider = PROVIDERS[meta["provider"]]
        items.append(
            {
                "name": name,
                "provider": meta["provider"],
                "providerLabel": provider["label"],
                "contextTokens": get_context_tokens(name),
                "supportsThinking": meta["supports_thinking"],
            }
        )
    return items


def get_chat_model(model: str, enable_thinking: bool = False) -> ChatOpenAI:
    """按模型名构造 LangChain ChatOpenAI（流式）。模型不存在抛 ValueError。"""
    meta = MODELS.get(model)
    if not meta:
        raise ValueError(f"未知模型：{model}")
    provider = PROVIDERS[meta["provider"]]
    api_key = os.getenv(provider["api_key_env"], "")
    base_url = os.getenv(provider["base_url_env"], provider["base_url"])

    extra_body: dict = {}
    if meta["supports_thinking"]:
        if meta["provider"] == "ark":
            extra_body["thinking"] = {
                "type": "enabled" if enable_thinking else "disabled"
            }
        else:
            extra_body["enable_thinking"] = enable_thinking

    return ReasoningChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        streaming=True,
        timeout=300,
        extra_body=extra_body or None,
    )


class ReasoningChatOpenAI(ChatOpenAI):
    """ChatOpenAI 修复子类：流式保留 delta.reasoning_content。

    langchain-openai 流式时不提取第三方平台的 reasoning_content（langchain#29513），
    覆写 chunk 转换，把思考增量放进 additional_kwargs["reasoning_content"]。
    """

    def _convert_chunk_to_generation_chunk(
        self, chunk: dict, default_chunk_class: type, base_generation_info: dict | None
    ):
        generation_chunk = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info
        )
        choices = chunk.get("choices") or []
        delta = (choices[0] or {}).get("delta") if choices else None
        reasoning = (delta or {}).get("reasoning_content")
        if not reasoning:
            return generation_chunk
        if generation_chunk is None or generation_chunk.message is None:
            message_chunk = AIMessageChunk(
                content="", additional_kwargs={"reasoning_content": reasoning}
            )
        else:
            merged = dict(generation_chunk.message.additional_kwargs or {})
            merged["reasoning_content"] = reasoning
            generation_chunk.message.additional_kwargs = merged
            return generation_chunk
        return ChatGenerationChunk(
            message=message_chunk,
            generation_info=generation_chunk.generation_info if generation_chunk else None,
        )


def extract_reasoning(chunk) -> str:
    """从流式 chunk 提取深度思考内容。

    新版 langchain-openai 会把 delta.reasoning_content 放进 additional_kwargs；
    旧版有丢失 bug（langchain#29513），这里再防御性地从原始字段兜底。
    """
    reasoning = (chunk.additional_kwargs or {}).get("reasoning_content")
    if reasoning:
        return reasoning
    # 兜底：langchain v1 的 AIMessageChunk 把额外字段放在 kwargs 的 responses 原始结构里
    raw = (chunk.additional_kwargs or {}).get("raw")
    if isinstance(raw, dict):
        delta = ((raw.get("choices") or [{}])[0]).get("delta") or {}
        return delta.get("reasoning_content") or ""
    return ""

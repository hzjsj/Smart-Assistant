"""聊天适配器公共层（ARCHITECTURE.md Phase D / todo 第 29 条）。

合并 deepseek / hermes / openclaw / dify / bailian 五份复制代理骨架：
- http.py       上游设置加载、鉴权头、错误清洗、状态码映射、流式打开
- providers.py  多平台模型注册表与 LangChain ChatOpenAI 工厂（原 chat/llm.py）

约定：各适配器（deepseek/ 等）保留自己的 Error 子类与 payload 构造，
骨架一律从这里引用；禁止适配器之间互相 import。
"""
from chat_proxy.http import (
    UpstreamError,
    UpstreamSettings,
    bearer_headers,
    load_settings,
    open_upstream_stream,
    upstream_error_detail,
    upstream_status_code,
)

__all__ = [
    "UpstreamError",
    "UpstreamSettings",
    "bearer_headers",
    "load_settings",
    "open_upstream_stream",
    "upstream_error_detail",
    "upstream_status_code",
]

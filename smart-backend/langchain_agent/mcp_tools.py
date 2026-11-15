"""MinerU MCP 工具接入（langchain-mcp-adapters，双模式可选）。

两种 transport，由 ``MINERU_MCP_TRANSPORT`` 选择：

- ``streamable_http``（默认）：官方托管端点 ``https://mcp.mineru.net/mcp``，
  鉴权走同名自定义请求头 ``MINERU_API_TOKEN``（实测 Bearer 会被网关以
  token scope 拦截）；
- ``stdio``：本地启动 ``uvx mineru-open-mcp``（token 进进程 env），
  调用 MinerU 官方生产 API v4——托管端点故障时的可用路径。

注意两版 parse_documents 的 language 参数语义不同（托管=语言全名
"Chinese"；本地=OCR 语言代码 "ch"/"en"），工具 schema 各自描述，模型
按 schema 填参即可。加载失败只告警并回退空列表——agent 主流程永不因
MCP 不可用而中断。
"""

import logging
import os

from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)

_MCP_URL_ENV = "MINERU_MCP_URL"
_MCP_TOKEN_ENV = "MINERU_MCP_TOKEN"
_MCP_TRANSPORT_ENV = "MINERU_MCP_TRANSPORT"
_DEFAULT_MCP_URL = "https://mcp.mineru.net/mcp"
_DEFAULT_MCP_COMMAND = "uvx"  # 依赖 PATH；未装 uv 时写绝对路径
# 文档解析（Precision 模式异步轮询）可能分钟级，连接与读超时放宽。
_MCP_TIMEOUT = 300.0
_MCP_SSE_READ_TIMEOUT = 300.0

# 成功加载结果缓存（进程级）；失败不缓存——下次请求自动重试。
_cached_tools: list[BaseTool] | None = None


def mcp_enabled() -> bool:
    """是否配置了 MinerU MCP token（未配置即不启用 MCP 工具）。"""
    return bool(os.getenv(_MCP_TOKEN_ENV, "").strip())


def _build_connection() -> dict:
    """按 MINERU_MCP_TRANSPORT 构造 MultiServerMCPClient 连接配置。"""
    token = os.getenv(_MCP_TOKEN_ENV, "").strip()
    transport = os.getenv(_MCP_TRANSPORT_ENV, "streamable_http").strip().lower()
    if transport in ("stdio", "local"):
        return {
            "mineru": {
                "transport": "stdio",
                "command": os.getenv("MINERU_MCP_COMMAND", _DEFAULT_MCP_COMMAND),
                "args": ["mineru-open-mcp"],
                "env": {"MINERU_API_TOKEN": token},
            }
        }
    return {
        "mineru": {
            "transport": "streamable_http",
            "url": os.getenv(_MCP_URL_ENV, _DEFAULT_MCP_URL),
            "headers": {"MINERU_API_TOKEN": token},
            "timeout": _MCP_TIMEOUT,
            "sse_read_timeout": _MCP_SSE_READ_TIMEOUT,
        }
    }


async def load_mcp_tools() -> list[BaseTool]:
    """加载 MinerU MCP 工具并缓存；任何失败回退空列表（带告警日志）。"""
    global _cached_tools
    if _cached_tools is not None:
        return _cached_tools
    if not mcp_enabled():
        _cached_tools = []
        return _cached_tools
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        client = MultiServerMCPClient(_build_connection())
        tools = await client.get_tools()
        logger.info("MinerU MCP 工具加载成功：%s", [t.name for t in tools])
        _cached_tools = list(tools or [])
    except Exception as exc:  # noqa: BLE001 MCP 不可用只降级，不阻断对话
        logger.warning("MinerU MCP 工具加载失败，本次回退为基础工具：%s", exc)
    return _cached_tools if _cached_tools is not None else []

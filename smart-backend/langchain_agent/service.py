"""LangChain Agent 服务：手动 tool-calling 循环 → OpenAI 兼容 SSE。

与 dify/bailian 适配器同构：产出 OpenAI chunk 流（delta.content /
delta.reasoning_content / finish_reason / usage），并额外把每次工具调用
翻译成 ``hermes.tool.progress`` 命名事件——前端「执行过程」面板零改动复用。
多轮上下文直接使用前端随请求携带的完整 messages（与 deepseek 同构）。
"""

import asyncio
import json
import os
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from pydantic import BaseModel

from chat.llm import PROVIDERS, MODELS, extract_reasoning, get_chat_model, get_context_tokens

from .mcp_tools import load_mcp_tools, mcp_enabled
from .schemas import LangChainChatMessage, LangChainChatRequest
from .tools import get_tools, tool_result_snippet

# 单次提问允许的最大「模型响应→工具执行」循环轮数（防工具循环失控）。
DEFAULT_MAX_ROUNDS = 8


class LangChainAgentError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class LangChainSettings(BaseModel):
    agent_model: str
    max_rounds: int
    enable_web_tools: bool
    enable_mcp_tools: bool


def _resolve_web_tools_env() -> bool:
    """联网工具开关：显式设置 LANGCHAIN_ENABLE_WEB_TOOLS 优先；
    未设置时跟随 DEEPSEEK_API_KEY 是否配置（避免无 key 环境误注册付费工具）。"""
    raw = os.getenv("LANGCHAIN_ENABLE_WEB_TOOLS", "").strip().lower()
    if raw in ("1", "true", "yes", "y", "on"):
        return True
    if raw in ("0", "false", "no", "n", "off"):
        return False
    return bool(os.getenv("DEEPSEEK_API_KEY", ""))


def get_settings() -> LangChainSettings:
    return LangChainSettings(
        agent_model=os.getenv("LANGCHAIN_AGENT_MODEL", "deepseek-v4-flash"),
        max_rounds=max(1, int(os.getenv("LANGCHAIN_AGENT_MAX_ROUNDS", str(DEFAULT_MAX_ROUNDS)))),
        enable_web_tools=_resolve_web_tools_env(),
        enable_mcp_tools=mcp_enabled(),
    )


def _ensure_api_key(settings: LangChainSettings) -> None:
    """启动流之前校验底层模型的 provider key 已配置（对齐 deepseek 模块做法）。"""
    meta = MODELS.get(settings.agent_model)
    if not meta:
        raise LangChainAgentError(500, f"LANGCHAIN_AGENT_MODEL 配置了未知模型：{settings.agent_model}")
    env_name = PROVIDERS[meta["provider"]]["api_key_env"]
    if not os.getenv(env_name, ""):
        raise LangChainAgentError(500, f"未配置 {env_name}，无法调用 LangChain Agent 底层模型")


def _build_system_prompt(
    enable_web_tools: bool, mcp_tool_names: list[str] | None = None
) -> str:
    """系统提示词按实际注册的工具集动态生成（开关与 MCP 加载结果联动）。

    工具路由规则（用户约定）：文档（PDF/Office/图片）解析只使用 MinerU
    parse_documents，失败即如实告知、不得改用 fetch_url/fetch_page 抓文档
    二进制；联网搜索仅在用户要求搜索或需要实时信息时使用。
    """
    lines = [
        "你是智能助手中的 LangChain Agent，由 LangChain 手动工具循环驱动。",
        "你可以使用以下工具：",
        "- current_time：获取当前日期时间（回答时间类问题必须先调用，不要凭记忆猜）",
        "- calculator：精确算术计算（涉及数字计算时优先使用）",
        "- fetch_url：免费抓取公网网页文本（仅限 HTML 网页；"
        "PDF/Office 等文档文件不属于它的用途）",
    ]
    if enable_web_tools:
        lines += [
            "- web_search：联网搜索实时信息（DeepSeek 官方搜索引擎，按次计费；"
            "仅在用户要求搜索或问题需要实时信息时使用，返回标题/链接/摘要，"
            "需要网页正文再调 fetch_page）",
            "- fetch_page：抓取网页完整 Markdown 正文（官方服务，按次计费，"
            "仅限 HTML 网页；时效性问题先 web_search 再 fetch_page）",
        ]
    if mcp_tool_names:
        lines += [
            "- 文档解析（MCP）："
            + "、".join(mcp_tool_names)
            + "（输入为可公网访问的文件 URL，输出 Markdown）",
            "",
            "工具路由硬性规则：",
            "1. 文档（PDF/Office/图片）解析只使用 parse_documents（MinerU），"
            "这是唯一正确途径。",
            "2. parse_documents 失败时，如实告知用户 MinerU 服务暂不可用、"
            "建议稍后重试；严禁改用 fetch_url/fetch_page 去抓文档文件"
            "（只能得到二进制乱码）。",
            "3. fetch_url/fetch_page 仅用于 HTML 网页，不用于任何文档文件。",
        ]
    else:
        lines.append(
            "注意：文档解析服务（MinerU）未启用，无法提取 PDF/Office 文档"
            "内容；用户要求解析文档时请如实说明暂不支持，不要尝试用其他"
            "工具抓取文档文件。"
        )
    lines.append(
        "规则：需要工具就调用，拿到结果后用中文给出最终回答；"
        "无需工具时直接回答。回答保持简洁准确。"
    )
    return "\n".join(lines)

# 历史字符预算 ≈ 上下文 token 数 × 3（中文约 1.5~2 字符/token，留余量）。
_CONTEXT_CHARS_FACTOR = 3


def _content_to_text(content: str | list[dict[str, Any]]) -> str:
    """兼容纯文本与 OpenAI 内容块数组（前端历史即该形状），只取文本段。"""
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "".join(parts)


def _to_lc_messages(messages: list[LangChainChatMessage]) -> list[BaseMessage]:
    converted: list[BaseMessage] = []
    for message in messages:
        text = _content_to_text(message.content)
        if not text:
            continue
        if message.role == "system":
            converted.append(SystemMessage(content=text))
        elif message.role == "assistant":
            converted.append(AIMessage(content=text))
        else:
            converted.append(HumanMessage(content=text))
    return converted


def _truncate_messages(messages: list[BaseMessage], model: str) -> list[BaseMessage]:
    """按字符预算从新到旧保留历史（超预算的旧消息丢弃，至少保留最后一条）。"""
    budget = max(1, get_context_tokens(model)) * _CONTEXT_CHARS_FACTOR
    kept: list[BaseMessage] = []
    used = 0
    for message in reversed(messages):
        used += len(message.content) if isinstance(message.content, str) else 100
        if used > budget and kept:
            break
        kept.append(message)
    kept.reverse()
    return kept


# 可由 MinerU parse_documents 解析的附件扩展名（文档/图片）。
_PARSEABLE_EXTS = (".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg")


def _attachment_is_parseable(attachments: list) -> bool:
    """判断任一附件是文档/图片类型（凭 URL 路径后缀，OSS 链接无查询参数干扰）。"""
    for attachment in attachments:
        path = (attachment.url or "").split("?", 1)[0].lower()
        if path.endswith(_PARSEABLE_EXTS):
            return True
    return False


def _build_lc_messages(
    payload: LangChainChatRequest,
    enable_web_tools: bool,
    mcp_tool_names: list[str] | None = None,
) -> list[BaseMessage]:
    messages = _to_lc_messages(payload.messages)
    if payload.attachments:
        # 附件注入与 mineru 同思路：把 URL 清单追加进最后一条 user 消息，
        # 由 agent 按需读取（DB content 保存注入前文本）。工具引导按附件
        # 类型分流：文档/图片优先 parse_documents（MCP 解析，需已启用）；
        # 网页或 MCP 未启用时退回 fetch_url 免费直抓。
        if _attachment_is_parseable(payload.attachments) and mcp_tool_names:
            tool_hint = (
                "请用 parse_documents 工具解析附件内容（PDF/Office/图片 → "
                "Markdown，输入下方 URL，language 按文档语言传）。"
                "若解析失败请如实告知用户 MinerU 服务暂不可用，"
                "请勿改用 fetch_url/fetch_page 抓取文档文件"
            )
        elif _attachment_is_parseable(payload.attachments):
            tool_hint = (
                "附件为文档类型，但文档解析服务（MinerU）未启用，"
                "无法提取其文字内容，请如实告知用户暂不支持解析"
            )
        else:
            tool_hint = "可用 fetch_url 工具按 URL 获取附件内容"
        lines = ["[用户上传的参考资料]", f"请结合以下附件回答；{tool_hint}："]
        for index, attachment in enumerate(payload.attachments, start=1):
            name = attachment.name or "附件"
            lines.append(f"{index}. {name}: {attachment.url}")
        for message in reversed(messages):
            if isinstance(message, HumanMessage):
                message.content = f"{message.content}\n\n" + "\n".join(lines)
                break
    messages.insert(
        0,
        SystemMessage(
            content=_build_system_prompt(enable_web_tools, mcp_tool_names)
        ),
    )
    return messages


# ─── SSE 帧构造（与 dify/service.py 相同的 OpenAI 兼容帧） ───────────


def _sse_frame(payload: dict[str, Any], event: str | None = None) -> bytes:
    body = json.dumps(payload, ensure_ascii=False)
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {body}\n\n".encode("utf-8")


def _done_frame() -> bytes:
    return b"data: [DONE]\n\n"


_DONE = _done_frame()


def _finish_frame(
    finish_reason: str,
    usage: dict[str, Any] | None = None,
    error: str | None = None,
) -> bytes:
    payload: dict[str, Any] = {
        "choices": [{"delta": {}, "finish_reason": finish_reason}]
    }
    if usage:
        payload["usage"] = usage
    if error:
        payload["error"] = {"message": error}
    return _sse_frame(payload)


def _content_frames(content: Any) -> Iterator[bytes] | None:
    """从 chunk.content 产出内容帧；空/非文本返回 None。"""
    if isinstance(content, str) and content:
        return iter([_sse_frame({"choices": [{"delta": {"content": content}}]})])
    if isinstance(content, list):
        texts = [
            block["text"]
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str) and block["text"]
        ]
        if texts:
            return iter(
                [
                    _sse_frame({"choices": [{"delta": {"content": text}}]})
                    for text in texts
                ]
            )
    return None


# ─── 工具执行 ────────────────────────────────────────────────────────


async def _execute_tool(call: dict[str, Any], tools: list) -> str:
    tool = next((t for t in tools if t.name == call.get("name")), None)
    if tool is None:
        return f"未知工具：{call.get('name')}"
    try:
        return str(await tool.ainvoke(call.get("args") or {}))
    except Exception as exc:  # noqa: BLE001 工具异常以文本回灌模型，让它自行调整
        return f"工具执行异常：{type(exc).__name__}: {exc}"


# ─── Agent 循环 ──────────────────────────────────────────────────────


async def _run_agent_frames(
    payload: LangChainChatRequest,
    settings: LangChainSettings,
    cancelled: asyncio.Event,
) -> AsyncIterator[bytes]:
    """核心循环：模型流式响应 → 工具调用 → 结果回灌，产出 OpenAI SSE 帧。

    所有正常/错误路径都以 finish 帧 + [DONE] 收尾；仅被中止（cancelled）
    时提前返回，由采集任务负责落库终态。
    """
    tools = get_tools(settings.enable_web_tools)
    mcp_tool_names: list[str] = []
    if settings.enable_mcp_tools:
        mcp_tools = await load_mcp_tools()
        if mcp_tools:
            # 名称去重保护：MCP 工具不覆盖同名内置工具。
            existing = {t.name for t in tools}
            tools = tools + [t for t in mcp_tools if t.name not in existing]
            mcp_tool_names = [t.name for t in mcp_tools if t.name not in existing]

    lc_messages = _truncate_messages(
        _build_lc_messages(payload, settings.enable_web_tools, mcp_tool_names),
        settings.agent_model,
    )
    bound = get_chat_model(settings.agent_model).bind_tools(tools)
    usage_total = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    # 收尾原因：轮数耗尽=error；模型空输出=stop（避免前端挂住且不误报错误）。
    finish_reason = "error"
    error_text = f"已连续执行 {settings.max_rounds} 轮工具仍未收敛，请简化问题后重试"

    for _round in range(settings.max_rounds):
        final: AIMessageChunk | None = None
        async for chunk in bound.astream(lc_messages):
            if cancelled.is_set():
                return
            reasoning = extract_reasoning(chunk)
            if reasoning:
                yield _sse_frame({"choices": [{"delta": {"reasoning_content": reasoning}}]})
            frames = _content_frames(chunk.content)
            if frames:
                for frame in frames:
                    yield frame
            final = chunk if final is None else final + chunk
        if final is None:
            # 模型整轮无输出：按正常收尾处理，避免前端挂住。
            finish_reason = "stop"
            break

        um = final.usage_metadata or {}
        # 多轮循环时各轮 usage 直接累加（中间轮计入重复上下文，仅作参考值）。
        usage_total["prompt_tokens"] += um.get("input_tokens") or 0
        usage_total["completion_tokens"] += um.get("output_tokens") or 0
        usage_total["total_tokens"] += um.get("total_tokens") or 0

        tool_calls = final.tool_calls or []
        if not tool_calls:
            yield _finish_frame(
                "stop", usage=usage_total if usage_total["total_tokens"] else None
            )
            yield _DONE
            return

        # 回灌带 tool_calls 的 assistant 消息，再逐个执行并回灌 ToolMessage。
        text_so_far = final.content if isinstance(final.content, str) else ""
        lc_messages.append(
            AIMessage(content=text_so_far, tool_calls=final.tool_calls)
        )
        for index, call in enumerate(tool_calls):
            tool_call_id = f"lc:{_round}:{index}"
            args_text = json.dumps(call.get("args") or {}, ensure_ascii=False)
            yield _sse_frame(
                {
                    "tool": call.get("name"),
                    "toolCallId": tool_call_id,
                    "label": call.get("name"),
                    "status": "running",
                    "message": f"参数：{args_text[:160]}",
                },
                event="hermes.tool.progress",
            )
            result = await _execute_tool(call, tools)
            yield _sse_frame(
                {
                    "tool": call.get("name"),
                    "toolCallId": tool_call_id,
                    "label": call.get("name"),
                    "status": "error" if result.startswith("工具执行异常") or result.startswith("未知工具") else "completed",
                    "message": tool_result_snippet(result),
                },
                event="hermes.tool.progress",
            )
            lc_messages.append(
                ToolMessage(content=result, tool_call_id=call.get("id") or tool_call_id)
            )

    # 轮数耗尽（finish_reason 仍为 error）或模型空输出（stop）：统一收尾。
    yield _finish_frame(
        finish_reason, usage=usage_total if finish_reason == "stop" and usage_total["total_tokens"] else None, error=error_text if finish_reason == "error" else None
    )
    yield _DONE


# ─── 采集器适配器 ────────────────────────────────────────────────────


class LangChainStreamAdapter:
    """把本地 agent 循环包装成 conversations 采集器所需的流对象。

    采集器只调用 ``aiter_bytes`` 与 ``aclose``，因此可替代 httpx.Response：
    落库、节流刷新（续播）、abort 终态全部沿用现有机制。
    """

    def __init__(
        self,
        payload: LangChainChatRequest,
        settings: LangChainSettings | None = None,
    ) -> None:
        self._payload = payload
        self._settings = settings or get_settings()
        self._cancelled = asyncio.Event()

    async def aiter_bytes(self) -> AsyncIterator[bytes]:
        last_was_done = False
        try:
            async for frame in _run_agent_frames(
                self._payload, self._settings, self._cancelled
            ):
                last_was_done = frame == _DONE
                yield frame
        except (asyncio.CancelledError, GeneratorExit):
            # 用户手动 abort / 客户端断开：交由采集任务收尾落库。
            raise
        if not last_was_done:
            # 防御收尾：循环因取消以外原因提前退出时补齐终止帧。
            yield _finish_frame("stop")
            yield _DONE

    async def aclose(self) -> None:
        self._cancelled.set()

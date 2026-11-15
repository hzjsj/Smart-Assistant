"""LangChain Agent 第一版工具集：当前时间 / 安全计算器 / URL 抓取。

全部零外部依赖、开箱可用；以 TOOLS 注册表对外暴露，后续加工具
（如二期知识库检索）只需新增函数并注册一行。
"""

import ast
import asyncio
import ipaddress
import os
import re
import socket
from datetime import datetime
from typing import Any

import httpx
from langchain_core.tools import BaseTool, tool

# ─── current_time ───────────────────────────────────────────────────


@tool
def current_time() -> str:
    """获取当前的日期与时间（含星期）。回答"今天几号/现在几点"类问题必须先用本工具。"""
    now = datetime.now()
    weekdays = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")
    return now.strftime(f"%Y-%m-%d %H:%M:%S {weekdays[now.weekday()]}")


# ─── calculator ─────────────────────────────────────────────────────

# ast 白名单节点：数字、四则、幂、取余、括号、正负号。
_ALLOWED_NODES = (
    ast.Constant,
    ast.BinOp,
    ast.UnaryOp,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Mod,
    ast.Pow,
    ast.FloorDiv,
    ast.USub,
    ast.UAdd,
)


def _safe_eval(node: ast.AST) -> float | int:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, _ALLOWED_NODES):
        left, right = _safe_eval(node.left), _safe_eval(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Mod):
            return left % right
        if isinstance(node.op, ast.FloorDiv):
            return left // right
        if isinstance(node.op, ast.Pow):
            # 限制幂运算规模，防止 9**9**9 之类的资源放大。
            if abs(right) > 64 or abs(left) > 1e9:
                raise ValueError("幂运算数值过大")
            return left**right
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, _ALLOWED_NODES):
        value = _safe_eval(node.operand)
        if isinstance(node.op, ast.USub):
            return -value
        if isinstance(node.op, ast.UAdd):
            return +value
    raise ValueError(f"不支持的表达式元素：{type(node).__name__}")


@tool
def calculator(expression: str) -> str:
    """计算一个纯算术表达式并返回结果。仅支持数字与 + - * / % // ** 及括号，
    不支持任何函数、变量或未知符号。输入示例："(123 * 456) / 7"。"""
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        if not isinstance(tree, ast.Expression):
            raise ValueError("不是表达式")
        result = _safe_eval(tree.body)
    except (ValueError, SyntaxError, ZeroDivisionError) as exc:
        return f"计算失败：{exc}"
    except Exception as exc:  # noqa: BLE001 白名单外的节点一律拒绝
        return f"计算失败：不支持的表达式（{exc}）"
    if isinstance(result, float) and result.is_integer():
        result = int(result)
    return f"计算结果：{expression.strip()} = {result}"


# ─── fetch_url ──────────────────────────────────────────────────────

_MAX_BYTES = 64 * 1024  # 正文上限 64KB
_FETCH_TIMEOUT = 10.0
# 危险私网网段：拒绝 localhost / 内网 / 链路本地 / 保留段（防 SSRF 探测内网）。
_PRIVATE_HOSTNAME = re.compile(
    r"^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|.*\.local)$",
    re.IGNORECASE,
)


def _assert_public_host(hostname: str) -> None:
    """校验主机名不是私网地址；解析出的所有 IP 也必须全部为公网。"""
    if _PRIVATE_HOSTNAME.match(hostname):
        raise ValueError(f"拒绝访问内网/本机地址：{hostname}")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError(f"拒绝直接以 IP 访问（需为公网域名）：{hostname}")
    infos = socket.getaddrinfo(hostname, None)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise ValueError(f"域名解析到非公网地址（{hostname} → {ip}），已拒绝")


def _strip_html(html: str) -> str:
    """极简正文提取：去 script/style 与全部标签，压缩空白。"""
    html = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL
    )
    html = re.sub(r"<[^>]+>", " ", html)
    html = html.replace("&nbsp;", " ").replace("&amp;", "&")
    html = html.replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\s+", " ", html).strip()


@tool
async def fetch_url(url: str) -> str:
    """抓取一个公网网页/文件的文本内容（自动去除 HTML 标签，最长 64KB）。
    仅支持 http/https 公网地址；不可用于内网地址。"""
    if not (url.startswith("http://") or url.startswith("https://")):
        return "抓取失败：仅支持 http/https URL"
    try:
        hostname = re.sub(r"^[a-z]+://", "", url).split("/", 1)[0].split(":", 1)[0]
        await asyncio.to_thread(_assert_public_host, hostname)
    except ValueError as exc:
        return f"抓取失败：{exc}"
    except (socket.gaierror, OSError) as exc:
        return f"抓取失败：域名解析异常（{exc}）"
    try:
        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT, follow_redirects=True, max_redirects=3
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "html" in content_type or "xml" in content_type or not content_type:
                text = _strip_html(response.text)
            else:
                text = response.text
            truncated = len(text.encode("utf-8")) > _MAX_BYTES
            if truncated:
                text = text.encode("utf-8")[:_MAX_BYTES].decode("utf-8", errors="ignore")
            suffix = "（内容超长已截断）" if truncated else ""
            return f"抓取成功（{response.status_code}）{suffix}：\n{text or '（空内容）'}"
    except httpx.HTTPStatusError as exc:
        return f"抓取失败：HTTP {exc.response.status_code}"
    except httpx.HTTPError as exc:
        return f"抓取失败：网络异常（{type(exc).__name__}）"


# ─── DeepSeek 联网工具（官方 Search/Fetch API）──────────────────────
# 文档：https://api-docs.deepseek.com/zh-cn/guides/web_tools；按成功请求
# 计费（0.005 元/次），失败/无结果不计费。抓取发生在 DeepSeek 服务端，
# 因此 fetch_page 无需 SSRF 防护（URL 只是转传字符串）。

_DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
_WEB_TIMEOUT = 15.0
_FETCH_PAGE_MAX_BYTES = 32 * 1024  # 返回给模型的正文上限


async def _deepseek_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """调用 DeepSeek Tools API（Search/Fetch），返回 JSON；HTTP 错误抛
    ``httpx.HTTPStatusError``（status_code 供上层转成模型可读文本）。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    async with httpx.AsyncClient(timeout=_WEB_TIMEOUT) as client:
        response = await client.post(
            f"{_DEEPSEEK_BASE_URL}{path}",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        return response.json()


def _web_error_text(exc: httpx.HTTPStatusError, action: str) -> str:
    """把官方错误码转成模型可读的提示文本（不抛异常，回灌模型自行调整）。"""
    status = exc.response.status_code
    if status == 402:
        return f"{action}失败：DeepSeek 账户余额不足，无法使用联网工具"
    if status == 429:
        return f"{action}失败：触发限速，请稍后重试"
    if status == 403:
        return f"{action}失败：请求被 DeepSeek 安全策略拒绝"
    if status == 404:
        return f"{action}失败：目标不可用或没有可提取的内容"
    if status == 401:
        return f"{action}失败：DEEPSEEK_API_KEY 无效"
    message = ""
    try:
        message = exc.response.json().get("error", {}).get("message", "")
    except Exception:  # noqa: BLE001 错误体解析失败时保留状态码即可
        pass
    return f"{action}失败：HTTP {status}" + (f"（{message}）" if message else "")


def _format_search_results(results: list[dict[str, Any]]) -> str:
    """把搜索结果压成模型可读的编号列表（title/url/date/summary）。"""
    lines: list[str] = []
    for index, item in enumerate(results, start=1):
        title = item.get("title") or "（无标题）"
        url = item.get("url") or ""
        date = (item.get("date") or "")[:10]
        summary = item.get("summary") or item.get("snippet") or ""
        line = f"{index}. [{title}]({url})"
        if date:
            line += f"（发布：{date}）"
        if summary:
            line += f"\n   摘要：{' '.join(str(summary).split())}"
        lines.append(line)
    return "\n".join(lines)


@tool
async def web_search(
    query: str,
    count: int = 5,
    ori_question: str | None = None,
) -> str:
    """联网搜索网页并返回结构化结果（DeepSeek 官方搜索引擎，按次计费）。
    适用于需要实时信息、新闻、最新发布、文档站点内容的问题。
    query 支持 site:/lang:/after:/before:/"精确短语" 等搜索语法。
    默认只返回摘要，需要网页完整正文时再调用 fetch_page 抓对应 URL。"""
    query = (query or "").strip()
    if not query:
        return "搜索失败：query 不能为空"
    if len(query) > 128:
        query = query[:128]
    count = max(1, min(int(count or 5), 10))  # 文档允许 50，给模型的量 10 足够且省费
    payload: dict[str, Any] = {"query": query, "count": count, "need_content": False}
    if ori_question:
        payload["ori_question"] = ori_question[:128]
    try:
        data = await _deepseek_post("/v1/tools/search", payload)
    except httpx.HTTPStatusError as exc:
        return _web_error_text(exc, "搜索")
    except httpx.HTTPError as exc:
        return f"搜索失败：网络异常（{type(exc).__name__}）"
    results = data.get("results") or []
    if not results:
        return "搜索完成：没有找到相关结果。可尝试更换关键词或放宽搜索语法。"
    return f"搜索完成，共 {len(results)} 条结果：\n" + _format_search_results(results)


@tool
async def fetch_page(url: str) -> str:
    """抓取单个网页并以 Markdown 返回正文（DeepSeek 官方服务，按次计费，
    质量优于免费的 fetch_url）。适用于需要阅读网页完整内容的场景；
    仅支持含 host 的 http/https URL，不能携带用户名密码。"""
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        return "抓取失败：仅支持 http/https URL"
    if len(url) > 8192:
        return "抓取失败：URL 过长"
    if any(marker in url for marker in ("@",)):
        return "抓取失败：URL 不能携带用户名或密码"
    try:
        data = await _deepseek_post("/v1/tools/fetch", {"url": url})
    except httpx.HTTPStatusError as exc:
        return _web_error_text(exc, "抓取")
    except httpx.HTTPError as exc:
        return f"抓取失败：网络异常（{type(exc).__name__}）"
    title = data.get("title") or ""
    content = data.get("content") or ""
    if not content:
        return "抓取完成：页面没有可提取的正文。"
    truncated = len(content.encode("utf-8")) > _FETCH_PAGE_MAX_BYTES
    if truncated:
        content = content.encode("utf-8")[:_FETCH_PAGE_MAX_BYTES].decode("utf-8", errors="ignore")
    header = f"# {title}\n\n" if title else ""
    suffix = "\n\n（内容超长已截断）" if truncated else ""
    return f"{header}{content}{suffix}"


# ─── 注册表 ─────────────────────────────────────────────────────────

# 基础工具：零外部依赖，始终注册。
BASE_TOOLS: list[BaseTool] = [current_time, calculator, fetch_url]
# 联网工具：调用 DeepSeek 官方 Search/Fetch API，按成功请求计费；
# 由 enable_web_tools 开关决定是否注册（默认跟随 DEEPSEEK_API_KEY 是否配置）。
WEB_TOOLS: list[BaseTool] = [web_search, fetch_page]


def get_tools(enable_web_tools: bool) -> list[BaseTool]:
    """按开关返回本轮 agent 可用的工具列表（bind_tools 与执行查找共用）。"""
    return BASE_TOOLS + WEB_TOOLS if enable_web_tools else list(BASE_TOOLS)


def tool_result_snippet(result: Any, limit: int = 400) -> str:
    """把工具执行结果压成进度事件里的短摘要（前端气泡只展示摘要）。"""
    text = result if isinstance(result, str) else str(result)
    text = " ".join(text.split())
    return text[:limit] + ("…" if len(text) > limit else "")

# -*- coding: utf-8 -*-
"""AST（P2）：把 Token 流搭成嵌套树，供结构视图 / 树视图 / JSON 导出 / 后续估算使用。

要点：
  · 按注解的开闭形态配对成树（成对跨越的闭合会被标记 crossed 并记录告警）；
  · 自定义注解**定义块**单列为 def 节点（不混入正文流）；
  · 带参宏调用 〖=SB(…〗…〖=〗 也建为一个节点，参数作为其子节点。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .macros import collect_defs, expand, MacroStats


@dataclass
class Node:
    kind: str                      # root | text | annot | ctrl | def | args | newline
    token: object | None = None
    children: list["Node"] = field(default_factory=list)
    crossed: bool = False          # 闭合时跨越了未闭合的兄弟注解

    # ---- 便捷访问 ----
    def _g(self, attr: str, default=""):
        return getattr(self.token, attr, default) if self.token is not None else default

    @property
    def name(self) -> str:
        return self._g("name")

    @property
    def params(self) -> str:
        return self._g("params")

    @property
    def op(self) -> str:
        return self._g("op")

    @property
    def cat(self) -> str:
        return self._g("cat")

    @property
    def desc(self) -> str:
        return self._g("desc")

    @property
    def confidence(self) -> str:
        return self._g("confidence")

    @property
    def raw(self) -> str:
        return self._g("raw")

    @property
    def line(self) -> int:
        return self._g("line", 0)

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


@dataclass
class BuildResult:
    root: Node
    defs: dict[str, list]
    warnings: list[str] = field(default_factory=list)   # 真问题（多余闭合/未闭合/跨越）
    notes: list[str] = field(default_factory=list)      # 预期情况（如彩色复位、定义块内的半边注解）


def build(tokens, annots=None) -> BuildResult:
    """把 token 流搭成树。返回 (root, 定义表, 告警, 说明)。"""
    root = Node("root")
    stack: list[Node] = [root]
    defs = collect_defs(tokens)
    warnings: list[str] = []
    notes: list[str] = []
    open_by_name: dict[str, list[Node]] = {}

    def severity(name: str) -> bool:
        """该注解的开闭是否应当严格配对（CS/CSD/CSX 裸形式兼作彩色复位，不严格）。"""
        entry = (annots.entries.get(name, {}) if annots is not None else {})
        return entry.get("balanced", True)

    def add(node: Node):
        stack[-1].children.append(node)

    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.kind == "newline":
            add(Node("newline", t))
            i += 1
            continue
        if t.kind in ("text", "ctrl"):
            add(Node(t.kind, t))
            i += 1
            continue
        # ---- 注解 ----
        if t.name == "ZD":
            if t.op == "open":
                node = Node("def", t)
                root.children.append(node)          # 定义挂到根，不进入正文流
                stack.append(node)
                open_by_name.setdefault("ZD", []).append(node)
            elif t.op == "close":
                _pop_matching(stack, open_by_name, "ZD", warnings, notes, t, severity_fn=severity)
            i += 1
            continue
        if t.op == "open" or (t.name == "=" and t.params.endswith(("(", "（"))):
            node = Node("annot", t)
            add(node)
            stack.append(node)
            open_by_name.setdefault(t.name, []).append(node)
            i += 1
            continue
        if t.op == "close" or (t.name == "=" and t.params == ""):
            nd = _pop_matching(stack, open_by_name, t.name, warnings, notes, t,
                               strict=severity(t.name), severity_fn=severity)
            if nd is not None:
                nd.children.append(Node("annot", t))    # 闭合标记留作子节点
            i += 1
            continue
        add(Node("annot", t))
        i += 1

    for nd in stack[1:]:
        msg = f"第 {nd.line} 行的 〖{nd.name}〗 未闭合"
        (warnings if not (nd.token and nd.token.in_def) else notes).append(msg)
    return BuildResult(root=root, defs=defs, warnings=warnings, notes=notes)


def _pop_matching(stack: list[Node], open_by_name: dict, name: str,
                  warnings: list[str], notes: list[str], tok,
                  strict: bool = True, severity_fn=None) -> Node | None:
    def _strict(n: str) -> bool:
        return severity_fn(n) if severity_fn else True

    cands = open_by_name.get(name) or []
    if not cands:
        msg = f"第 {tok.line} 行出现多余的闭合 〖{tok.name}〗"
        (warnings if (strict and not getattr(tok, "in_def", False)) else notes).append(msg)
        return None
    node = cands.pop()
    if node in stack:
        idx = stack.index(node)
        for crossed in stack[idx + 1:]:
            crossed.crossed = True
            in_def = bool((node.token and node.token.in_def) or (crossed.token and crossed.token.in_def))
            # 彩色状态类（CS/CSD/CSX）与定义块内的“半边”注解不构成真问题
            nonstrict = (not strict) or (not _strict(crossed.name))
            msg = (f"第 {tok.line} 行的 〖{name}〗 跨越了未闭合的 〖{crossed.name}〗"
                   f"（第 {crossed.line} 行）")
            (notes if (in_def or nonstrict) else warnings).append(msg)
        del stack[idx:]          # 连同被闭合的节点一起出栈
    return node


# ----------------------------------------------------------------------
def to_dict(node: Node, depth: int = 0, max_depth: int = 200) -> dict:
    d: dict = {"kind": node.kind}
    if node.token is not None:
        t = node.token
        d["line"] = t.line
        if node.kind in ("annot", "def"):
            d.update(name=t.name, params=t.params, op=t.op, cat=t.cat)
        elif node.kind == "ctrl":
            d["code"] = t.raw
        elif node.kind == "text":
            raw = t.raw
            d["text"] = raw if len(raw) <= 120 else raw[:120] + "…"
    if node.crossed:
        d["crossed"] = True
    if depth < max_depth and node.children:
        d["children"] = [to_dict(c, depth + 1, max_depth) for c in node.children]
    elif node.children:
        d["children_count"] = len(node.children)
    return d


def tree_text(node: Node, max_text: int = 60, max_lines: int = 0) -> str:
    """缩进树文本（供 CLI --mode tree）。"""
    out: list[str] = []

    def rec(nd: Node, depth: int, last: bool):
        if max_lines and len(out) >= max_lines:
            return
        ind = "  " * depth
        if nd.kind in ("annot", "def"):
            tag = "定义" if nd.kind == "def" else (nd.op or "")
            mark = " ⚠跨越" if nd.crossed else ""
            out.append(f"{ind}{nd.line:>5} 〖{nd.name}{nd.params}〗 ({nd.cat}/{tag}){mark}")
        elif nd.kind == "ctrl":
            out.append(f"{ind}       ⟨{nd.raw}⟩")
        elif nd.kind == "text":
            s = nd.raw.replace("\n", "⏎")
            if s.strip():
                out.append(f"{ind}       {s[:max_text]}{'…' if len(s) > max_text else ''}")
        for i, c in enumerate(nd.children):
            rec(c, depth + 1, i == len(nd.children) - 1)

    rec(node, 0, True)
    return "\n".join(out)


def summarize(root: Node) -> dict:
    """统计树的结构信息。"""
    kinds: dict[str, int] = {}
    crossing = 0
    depth_max = 0

    def rec(nd: Node, d: int):
        nonlocal crossing, depth_max
        kinds[nd.kind] = kinds.get(nd.kind, 0) + 1
        if nd.crossed:
            crossing += 1
        depth_max = max(depth_max, d)
        for c in nd.children:
            rec(c, d + 1)

    rec(root, 0)
    return {"nodes": sum(kinds.values()), "kinds": kinds, "crossed": crossing, "max_depth": depth_max}

# -*- coding: utf-8 -*-
"""宏与自定义注解展开（P2）。

方正书版的自定义注解机制：
  · 定义：〖ZD<名>（〗…〖ZD）〗（名可为 A/B/1/2A/SB…），定义块本身**不产生输出**；
  · 调用：〖=<名>〗；带参数调用形如 〖=SB(〗…〖=〗，参数文本替换定义中的 A8 占位符。
本模块提供：收集定义、展开调用（含占位符替换与嵌套展开）、展开统计。
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace


@dataclass
class MacroStats:
    calls: int = 0            # 无参调用数
    calls_with_args: int = 0  # 带参调用数
    expanded: int = 0         # 成功展开次数
    undefined: list[str] = field(default_factory=list)   # 未找到定义的调用
    max_depth: int = 0
    defs: dict = field(default_factory=dict)             # 名 -> 定义内 token 数
    depth_limited: list[str] = field(default_factory=list)


def collect_defs(tokens) -> dict[str, list]:
    """收集 ZD 定义（名 -> 定义体内的 token 列表）。"""
    defs: dict[str, list] = {}
    cur_name, cur = None, []
    for t in tokens:
        if t.kind == "annot" and t.name == "ZD":
            if t.op == "open":
                cur_name = (t.sub or t.params.rstrip("（(")).strip()
                cur = []
            elif t.op == "close" and cur_name is not None:
                defs[cur_name] = cur
                cur_name, cur = None, []
            continue
        if cur_name is not None:
            cur.append(t)
    return defs


def _substitute(body: list, args: list) -> list:
    """把定义体中的 A8（宏参数占位符）替换为实参。"""
    out = []
    for t in body:
        if t.kind == "ctrl" and t.raw == "A8":
            out.extend(args)
        else:
            out.append(t)
    return out


def expand(tokens, defs: dict[str, list] | None = None, max_depth: int = 6,
           stats: MacroStats | None = None) -> list:
    """展开所有 〖=X〗 / 〖=SB(…〗…〖=〗，并剔除定义块（定义不产生输出）。"""
    if defs is None:
        defs = collect_defs(tokens)
    st = stats if stats is not None else MacroStats()
    if not st.defs:
        st.defs = {k: len(v) for k, v in defs.items()}
    out, i, depth = [], 0, 0

    def _walk(seq, d, origin=None):
        nonlocal out
        i2 = 0
        while i2 < len(seq):
            t = seq[i2]
            if d == 0 and t.in_def:
                i2 += 1
                continue
            if d and t.in_def:
                t = replace(t, in_def=False, definition_line=t.line, definition_offset=t.offset,
                            line=origin.line if origin else t.line,
                            offset=origin.offset if origin else t.offset,
                            end_offset=origin.end_offset if origin else t.end_offset)
            if t.kind == "annot" and t.name == "=":
                name = t.params
                if name.endswith(("(", "（")):                 # 带参数调用
                    key, args = name[:-1], []
                    i2 += 1
                    while i2 < len(seq) and not (
                            seq[i2].kind == "annot" and seq[i2].name == "=" and seq[i2].params == ""):
                        args.append(seq[i2]); i2 += 1
                    i2 += 1
                    st.calls_with_args += 1
                    st.max_depth = max(st.max_depth, d)
                    if d < max_depth and key in defs:
                        st.expanded += 1
                        _walk(_substitute(defs[key], args), d + 1, origin or t)
                    else:
                        if key not in defs:
                            st.undefined.append(key)
                        else:
                            st.depth_limited.append(key)
                        out.extend(args)
                    continue
                if name:
                    st.calls += 1
                    if d < max_depth and name in defs:
                        st.expanded += 1
                        st.max_depth = max(st.max_depth, d)
                        _walk(defs[name], d + 1, origin or t)
                    elif name not in defs:
                        st.undefined.append(name)
                    else:
                        st.depth_limited.append(name)
                i2 += 1
                continue
            out.append(t)
            i2 += 1

    _walk(tokens, depth)
    return out

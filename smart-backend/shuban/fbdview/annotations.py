# -*- coding: utf-8 -*-
"""注解字典：识别注解名、参数、开闭形态。

字典外置于 annot_dict.json，可热更新；未登记的名称按“最长前缀匹配 → 字母前缀
→ 未识别”逐级降级，并标记 confidence，交由 report 列出待补清单。
"""
from __future__ import annotations

import json
import os
import re

DICT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "annot_dict.json")

_OPEN = "(（"
_CLOSE = ")）"
_LETTERS = re.compile(r"[A-Za-z]+")


class AnnotDict:
    def __init__(self, path: str = DICT_PATH):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.version = data.get("version", "?")
        self.entries: dict[str, dict] = data.get("annotations", {})
        self.unknown_bytes: dict[str, str] = data.get("unknown_bytes", {})
        # 最长前缀优先：CSD/CSX 先于 CS，PS 先于 P，BH 先于 B
        self.prefixes = sorted(self.entries, key=len, reverse=True)

    # ------------------------------------------------------------------
    def match_name(self, raw: str) -> tuple[str, str, str]:
        """返回 (规范名, 参数, 置信度)。未识别时名为空串。"""
        if not raw:
            return "", "", "none"
        if raw.startswith("="):
            return "=", raw[1:], self.entries.get("=", {}).get("confidence", "none")
        for name in self.prefixes:
            if name and raw.startswith(name):
                return name, raw[len(name):], self.entries[name].get("confidence", "medium")
        m = _LETTERS.match(raw)                     # 退化：取字母前缀
        if m:
            return m.group(0).upper(), raw[m.end():], "unknown"
        return "", raw, "unknown"

    # ------------------------------------------------------------------
    def classify(self, raw: str) -> dict:
        """把注解原文（〖〗 之间的内容）分类为结构化信息。"""
        if raw == "":
            # 真实语料中存在大量空注解 〖〗（占位/间隔），单独登记而非报未识别
            return {
                "raw": "", "name": "(空注解)", "params": "", "sub": "",
                "cat": "其他", "form": "single", "desc": "空注解（占位/间隔）",
                "confidence": "high", "known": True, "op": "neutral",
            }
        name, params, confidence = self.match_name(raw)
        entry = self.entries.get(name, {})
        form = entry.get("form", "unknown")

        # ZD 家族：ZD<名>（ 开 … ZD） 闭
        sub = ""
        if name == "ZD":
            form = "def"
            sub = params[:-1] if params[-1:] in _OPEN + _CLOSE else params
            sub = sub.strip()

        op = "neutral"
        if form == "paren":
            head = params[:1]
            # 注意：params 为空时不可用 `'' in "(（"` 判断（Python 中恒为真）
            if head and head in _OPEN:
                op = "open"
            elif head and head in _CLOSE:
                op = "close"
        elif form == "toggle":
            op = "open" if params else "close"
        elif form == "def":
            tail = params[-1:]
            if tail and tail in _OPEN:
                op = "open"
            elif params in (")", "）"):
                op = "close"
        elif form == "call":
            op = "args-close" if params == "" else "call"

        return {
            "raw": raw,
            "name": name or "(未识别)",
            "params": params,
            "sub": sub,
            "cat": entry.get("cat", "未登记"),
            "form": form,
            "desc": entry.get("desc", ""),
            "confidence": confidence,
            "known": name in self.entries,
            "op": op,
        }


_default: AnnotDict | None = None


def default() -> AnnotDict:
    global _default
    if _default is None:
        _default = AnnotDict()
    return _default

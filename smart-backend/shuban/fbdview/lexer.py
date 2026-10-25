# -*- coding: utf-8 -*-
"""词法层：把解码后的字符流切成 文本 / 注解 / 控制符 / 换段 四类 Token。

要点：
  · 注解以 〖…〗 为界，且**允许跨物理行**（真实语料中存在被 CRLF 拆开的注解）；
  · 控制符（A4/A5/A6/A1/A3/A9/AA/A8/AC）作为独立 Token 保留；
  · 顺带计算注解嵌套深度，供结构视图使用。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import annotations as annot_mod
from .bytes_io import Decoded


@dataclass
class Token:
    kind: str                 # text | annot | ctrl | newline
    raw: str                  # text: 正文；annot: 〖〗 内原文；ctrl: 代号（如 A4）
    line: int
    offset: int
    end_offset: int
    # ---- 仅 annot ----
    name: str = ""
    params: str = ""
    sub: str = ""             # ZD 家族的自定义注解名
    cat: str = ""
    form: str = ""
    desc: str = ""
    op: str = ""              # open | close | neutral | call | args-close
    confidence: str = ""
    known: bool = True
    depth: int = 0
    in_def: bool = False      # 是否位于自定义注解定义块（〖ZD…（〗…〖ZD）〗）内部
    definition_line: int | None = None
    definition_offset: int | None = None


@dataclass
class LexResult:
    tokens: list[Token] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    unclosed: int = 0


def tokenize(dec: Decoded, annots: annot_mod.AnnotDict | None = None) -> LexResult:
    annots = annots or annot_mod.default()
    s, lines, offsets = dec.text, dec.lines, dec.offsets
    marks = dec.marks
    special = set(marks) | {"\n", "〖"}
    n = len(s)
    res = LexResult()
    depth = 0
    def_depth = 0            # >0 表示正处于自定义注解定义块内
    pos = 0

    def add(tok: Token):
        res.tokens.append(tok)

    while pos < n:
        c = s[pos]
        # ---- 换段 ----
        if c == "\n":
            add(Token("newline", "\n", lines[pos], offsets[pos], offsets[pos] + 1))
            pos += 1
            continue
        # ---- 控制符 ----
        if c in marks:
            kind, label = marks[c]
            if kind == "ctrl":
                add(Token("ctrl", label, lines[pos], offsets[pos], offsets[pos] + 2))
            else:                                   # 未知用户区字节：归入文本但记录
                add(Token("text", c, lines[pos], offsets[pos], offsets[pos] + 2))
            pos += 1
            continue
        # ---- 注解 ----
        if c == "〖":
            end = s.find("〗", pos + 1)
            if end < 0:
                res.unclosed += 1
                res.warnings.append(f"第 {lines[pos]} 行：注解缺少 〗（已按文本处理）")
                add(Token("text", s[pos:], lines[pos], offsets[pos], offsets[-1] + 1))
                break
            raw = s[pos + 1:end]
            info = annots.classify(raw)
            is_zd = info["name"] == "ZD"
            tok = Token("annot", raw, lines[pos], offsets[pos], offsets[end] + 2,
                        name=info["name"], params=info["params"], sub=info["sub"],
                        cat=info["cat"], form=info["form"], desc=info["desc"],
                        op=info["op"], confidence=info["confidence"],
                        known=info["known"], depth=depth,
                        in_def=(def_depth > 0) or is_zd)
            add(tok)
            # 嵌套深度：开则 +1，闭则 -1（先记录再加/减）
            if info["op"] == "open":
                depth += 1
            elif info["op"] == "close" and depth > 0:
                depth -= 1
            # 自定义注解定义块的进出
            if is_zd:
                if info["op"] == "open":
                    def_depth += 1
                elif info["op"] == "close":
                    def_depth = max(0, def_depth - 1)
            pos = end + 1
            continue
        # ---- 文本段 ----
        start = pos
        while pos < n and s[pos] not in special:
            pos += 1
        add(Token("text", s[start:pos], lines[start], offsets[start], offsets[pos - 1] + 1))

    return res

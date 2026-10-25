# -*- coding: utf-8 -*-
"""统计与校验报告：注解计数、开闭配对、未知/低置信清单、控制符与告警。"""
from __future__ import annotations

import os
import time
from collections import Counter, defaultdict

from . import annotations as annot_mod
from .bytes_io import CTRL_TABLE, Decoded, read as read_bytes
from .lexer import LexResult, tokenize

_PAIR_FORMS = {"paren", "toggle", "def"}


def _width(s: str) -> int:
    """中文按 2 列计算的显示宽度。"""
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in s)


def pad(s: str, width: int) -> str:
    return s + " " * max(0, width - _width(s))


def analyze(path: str, dec: Decoded | None = None, lex: LexResult | None = None,
            annots: annot_mod.AnnotDict | None = None) -> dict:
    annots = annots or annot_mod.default()
    t0 = time.perf_counter()
    if dec is None:
        dec = read_bytes(path)
    t_dec = time.perf_counter()
    if lex is None:
        lex = tokenize(dec, annots)
    t_lex = time.perf_counter()

    name_counts: Counter = Counter()
    cat_counts: Counter = Counter()
    op_counts: dict[str, Counter] = defaultdict(Counter)
    op_checked: dict[str, Counter] = defaultdict(Counter)   # 排除定义块内部后的开闭
    conf_counts: Counter = Counter()
    ctrl_counts: Counter = Counter()
    samples: dict[str, list[str]] = defaultdict(list)
    lowconf: set[str] = set()
    def_excluded = 0
    annot_total = 0
    text_chars = 0
    cjk_chars = 0
    call_args_open = 0        # 〖=SB(…〗 这类带参宏调用的开
    call_args_close = 0       # 其收尾 〖=〗

    for t in lex.tokens:
        if t.kind == "annot":
            annot_total += 1
            key = t.name + (f":{t.sub}" if t.sub else "")
            name_counts[key] += 1
            cat_counts[t.cat] += 1
            op_counts[t.name][t.op] += 1
            if t.in_def:
                # 定义块内部允许出现“半边”注解（如 ZDF 定义中的裸 〖ZZ)〗），不计入配对
                def_excluded += 1
            else:
                op_checked[t.name][t.op] += 1
            conf_counts[t.confidence] += 1
            if t.name == "=" and t.form == "call":
                if t.params == "":
                    call_args_close += 1
                elif t.params[-1:] in "(（":
                    call_args_open += 1
            if (not t.known) or t.confidence in ("low", "unknown", "none"):
                lowconf.add(key)
                if len(samples[key]) < 3 and t.raw not in samples[key]:
                    samples[key].append(t.raw[:40])
        elif t.kind == "ctrl":
            ctrl_counts[t.raw] += 1
        elif t.kind == "text":
            text_chars += len(t.raw)
            cjk_chars += sum(1 for ch in t.raw if ord(ch) > 0x2E80 and ch not in dec.marks)

    # ---- 开闭配对（ZD 定义块内部的“半边”注解不计入） ----
    pairs = {}
    for name, occ in op_checked.items():
        entry = annots.entries.get(name, {})
        if entry.get("form") in _PAIR_FORMS:
            o, c = occ.get("open", 0), occ.get("close", 0)
            if o or c:                       # 全是 neutral（如 〖JY。〗）不列入配对表
                pairs[name] = {"open": o, "close": c, "balance": o - c,
                               "check": entry.get("balanced", True)}
    if call_args_open or call_args_close:
        pairs["=带参调用"] = {"open": call_args_open, "close": call_args_close,
                              "balance": call_args_open - call_args_close, "check": True}

    # ---- 告警 ----
    warnings = list(lex.warnings)
    for name, p in sorted(pairs.items()):
        if p["balance"] != 0 and p.get("check", True):
            warnings.append(f"注解 {name} 开闭不平衡：开 {p['open']} / 闭 {p['close']}")
    if dec.stats["bom"]:
        warnings.append("文件含 UTF-8 BOM（书版小样应为无 BOM 的 GBK）")
    if dec.stats["lone_lf"] or dec.stats["lone_cr"]:
        warnings.append(f"存在裸 LF={dec.stats['lone_lf']} / 裸 CR={dec.stats['lone_cr']}（应为 CRLF）")
    if dec.stats["unknown_bytes"]:
        vals = sorted(v[1] for v in dec.marks.values() if v[0] == "unknown")
        detail = "；".join(f"{v}（{annots.unknown_bytes[v]}）" if v in annots.unknown_bytes else v
                          for v in vals)
        warnings.append(f"存在 {len(vals)} 种未知用户区字节：{detail}")
    unknown_bytes = []
    if dec.stats["unknown_bytes"]:
        first_line: dict[str, int | None] = {}
        for ph, (kind, label) in dec.marks.items():
            if kind != "unknown":
                continue
            idx = dec.text.find(ph)
            first_line[label] = dec.lines[idx] if idx >= 0 else None
        unknown_bytes = [
            {"hex": label, "line": first_line.get(label),
             "note": annots.unknown_bytes.get(label, "待确认")}
            for kind, label in dec.marks.values() if kind == "unknown"
        ]
    # 文件结束符：实测 .fbd 为 2 个、.PRO 为 1 个；位置应落在文件末尾区域
    # （正文类文件在 A6A6 之后还有 〖FL）0〗/〖LM〗 等收尾注解行，故不要求位于最后一行）
    is_pro = path.lower().endswith(".pro")
    expected_a6 = 1 if is_pro else 2
    a6 = ctrl_counts.get("A6", 0)
    if a6 == 0:
        warnings.append("未见文件结束符 A6")
    elif a6 != expected_a6:
        warnings.append(f"文件结束符 A6 数量为 {a6}（{'PRO' if is_pro else 'fbd'} 常见为 {expected_a6}）")
    a6_lines = [t.line for t in lex.tokens if t.kind == "ctrl" and t.raw == "A6"]
    total_lines = dec.stats["crlf"] + dec.stats["lone_lf"] + dec.stats["lone_cr"] + 1
    if a6_lines and total_lines - max(a6_lines) > 6:
        # 标准收尾块（A6A6 → 空行 → 〖LM〗〖HT〗〖HJ〗 → 空行）约 4 行，超过则疑为截断
        warnings.append(f"文件结束符 A6 出现在第 {max(a6_lines)} 行，距末尾较远（文件可能被截断）")

    pro_path = os.path.splitext(path)[0] + ".PRO"
    pro_exists = os.path.exists(pro_path)

    return {
        "file": path,
        "size": dec.stats["size"],
        "lines": dec.stats["crlf"] + dec.stats["lone_lf"] + dec.stats["lone_cr"] + 1,
        "chars": dec.stats["chars"],
        "text_chars": text_chars,
        "cjk_chars": cjk_chars,
        "ctrl": dict(ctrl_counts),
        "ctrl_desc": {code: desc for code, desc in CTRL_TABLE.values()},
        "annot_total": annot_total,
        "annot_names": len(name_counts),
        "def_excluded": def_excluded,
        "name_counts": dict(name_counts.most_common()),
        "cat_counts": dict(cat_counts.most_common()),
        "pairs": pairs,
        "confidence": dict(conf_counts),
        "low_confidence": {k: samples[k] for k in sorted(lowconf)},
        "unknown_bytes": unknown_bytes,
        "warnings": warnings,
        "pro": {"path": pro_path if pro_exists else None, "exists": pro_exists},
        "timing": {"decode_ms": round((t_dec - t0) * 1000, 1),
                   "lex_ms": round((t_lex - t_dec) * 1000, 1),
                   "total_ms": round((t_lex - t0) * 1000, 1)},
        "_dec": dec,
        "_lex": lex,
    }


# ----------------------------------------------------------------------
def format_stats(rep: dict, show_samples: bool = True) -> str:
    out = []
    out.append(f"文件      {rep['file']}")
    out.append(f"大小      {rep['size']:,} 字节   行数 {rep['lines']:,}   字符 {rep['chars']:,}"
               f"（正文 {rep['text_chars']:,}，其中汉字 {rep['cjk_chars']:,}）")
    out.append(f"耗时      解码 {rep['timing']['decode_ms']} ms + 词法 {rep['timing']['lex_ms']} ms"
               f" = {rep['timing']['total_ms']} ms")
    out.append(f"PRO       {'有：' + os.path.basename(rep['pro']['path']) if rep['pro']['exists'] else '同名 .PRO 未找到'}")
    out.append("")
    ctrl = rep["ctrl"]
    ctrl_str = "  ".join(f"{k}×{v}" for k, v in sorted(ctrl.items())) or "无"
    out.append(f"控制符    {ctrl_str}")
    out.append("")
    out.append(f"注解      共 {rep['annot_total']:,} 处，{rep['annot_names']} 个名称；"
               f"按类别：" + "  ".join(f"{k}×{v}" for k, v in rep["cat_counts"].items()))
    if rep.get("def_excluded"):
        out.append(f"          其中 {rep['def_excluded']} 处位于自定义注解定义块内（不参与开闭配对校验）")
    out.append("")
    out.append("  " + pad("注解", 12) + pad("次数", 8) + pad("类别", 8) + "开/闭")
    out.append("  " + "-" * 46)
    for name, cnt in list(rep["name_counts"].items())[:40]:
        p = rep["pairs"].get(name)
        flag = ""
        if p:
            if not p.get("check", True):
                flag = f"{p['open']}/{p['close']}  (不校验)"
            else:
                flag = f"{p['open']}/{p['close']}" + ("  ⚠不平衡" if p["balance"] else "  ✓")
        out.append("  " + pad(name, 12) + pad(str(cnt), 8) +
                   pad(annot_mod.default().entries.get(name, {}).get("cat", "—"), 8) + flag)
    if len(rep["name_counts"]) > 40:
        out.append(f"  …（其余 {len(rep['name_counts']) - 40} 个名称略）")
    out.append("")
    conf = rep["confidence"]
    out.append("置信分布  " + "  ".join(f"{k}×{v}" for k, v in conf.items()))
    if rep["low_confidence"]:
        out.append("")
        out.append(f"待补/待确认注解（{len(rep['low_confidence'])} 项）：")
        for name, smp in rep["low_confidence"].items():
            out.append(f"  · {name}  例：{(' | '.join(smp)) if smp else ''}" if show_samples
                       else f"  · {name}")
    if rep["warnings"]:
        out.append("")
        out.append("告警：")
        for w in rep["warnings"]:
            out.append(f"  ⚠ {w}")
    else:
        out.append("")
        out.append("告警：无")
    return "\n".join(out)


def format_geometry(geo) -> str:
    out = ["版面几何（BP + PRO）", "  " + geo.summary()]
    for c in geo.checks:
        mark = {"ok": "✓", "warn": "⚠", "info": "·"}.get(c["level"], "·")
        out.append(f"  {mark} {c['text']}")
    for n in geo.notes:
        out.append(f"  · {n}")
    return "\n".join(out)


def format_corpus(rows: list[dict]) -> str:
    out = []
    head = (pad("文件", 46) + pad("大小", 11) + pad("行数", 8) + pad("A4", 7) + pad("A6", 5)
            + pad("注解", 8) + pad("待确认", 8) + pad("耗时ms", 8) + "PRO")
    out.append(head)
    out.append("-" * 118)
    total_annots = 0
    for r in rows:
        name = r["file"] if len(r["file"]) <= 44 else "…" + r["file"][-43:]
        out.append(pad(name, 46) + pad(f"{r['size']:,}", 11) + pad(f"{r['lines']:,}", 8)
                   + pad(str(r["ctrl"].get("A4", 0)), 7) + pad(str(r["ctrl"].get("A6", 0)), 5)
                   + pad(f"{r['annot_total']:,}", 8) + pad(str(len(r["low_confidence"])), 8)
                   + pad(str(r["timing"]["total_ms"]), 8)
                   + ("—" if r["file"].lower().endswith(".pro")
                      else ("有" if r["pro"]["exists"] else "—")))
        total_annots += r["annot_total"]
    out.append("-" * 118)
    warn_files = [r for r in rows if r["warnings"]]
    out.append(f"合计 {len(rows)} 个文件，注解 {total_annots:,} 处；有告警 {len(warn_files)} 个")
    for r in warn_files:
        for w in r["warnings"]:
            out.append(f"  ⚠ {os.path.basename(r['file'])}：{w}")
    low = Counter()
    for r in rows:
        for k in r["low_confidence"]:
            low[k] += 1
    if low:
        out.append("待补/待确认注解（跨文件）：" + "  ".join(f"{k}({v})" for k, v in low.most_common()))

    # ---- 版面分组：页面/版心/栏 相同者归组，异常组往往就是参数错配 ----
    groups: dict = {}
    for r in rows:
        g = r.get("_geo")
        if not g:
            continue
        key = (g.page_w, g.page_h, g.text_w, g.text_h, g.columns)
        groups.setdefault(key, []).append(os.path.basename(r["file"]))
    if groups:
        out.append("")
        out.append("版面分组（页面 / 版心 / 栏；同组应属同一开本）：")
        for key, names in sorted(groups.items(), key=lambda kv: (-len(kv[1]), str(kv[0]))):
            pw, ph, tw, th, cols = key
            show = "、".join(names[:4]) + ("…" if len(names) > 4 else "")
            out.append(f"  页面 {pw}×{ph} / 版心 {tw}×{th} / {cols}栏 ×{len(names)}：{show}")
    geo_warns = [(os.path.basename(r["file"]), c["text"]) for r in rows
                 for c in (r.get("_geo").checks if r.get("_geo") else []) if c["level"] == "warn"]
    if geo_warns:
        out.append("")
        out.append("几何校验告警：")
        for f, t in geo_warns:
            out.append(f"  ⚠ {f}：{t}")
    return "\n".join(out)

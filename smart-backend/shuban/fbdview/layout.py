# -*- coding: utf-8 -*-
"""版面几何（P3）：解析 BP 与 PRO 的 BX，推导页面/版心/边空/栏，并与成品 PS 交叉校验。

实测要点（见 docs/agent/FBD排版经验总结.md）：
  · BP 形如 〖BP(〗426*303（含出血）〓上16.5〓下21.5〓左右23〖BP)〗，
    两个数字的**书写顺序在不同文件里不一致**（正文是宽*高、目录为高*宽），
    必须用 PRO 的 C 值（页面 高。宽）或版心回推来消歧；
  · PRO 的 BX：〖BX〈基准字号〉，〈行距〉〈字体〉＆〈外文〉＆〈数字〉，
    〈版心高〉。〈版心宽〉，〈出血〉C〈页面高〉。〈页面宽〉，[A]S〈上〉，Z〈左〉，0mm，F〗
  · 不变量：版心 = 页面尺寸 − 边空；**成品 = 页面尺寸 − 2×出血**，
    且同名 .PS 的介质尺寸通常等于成品尺寸（答案16K 实测 185×260 精确吻合）。
"""
from __future__ import annotations

import os
import re
from collections import Counter
from dataclasses import dataclass, field

from .bytes_io import Decoded, read as read_bytes


@dataclass
class Geometry:
    page_w: float | None = None      # 页面宽（含出血，mm）
    page_h: float | None = None
    bleed: float | None = None
    trim_w: float | None = None      # 成品宽（优先取 PRO 的 C 值）
    trim_h: float | None = None
    m_top: float | None = None
    m_bottom: float | None = None
    m_left: float | None = None
    m_right: float | None = None
    text_w: float | None = None      # 版心宽
    text_h: float | None = None
    columns: int = 1
    column_gap: float | None = None
    column_w: float | None = None    # 单栏宽
    column_rule: str | None = None   # 栏线（线型/线号；! 才画线）
    base_pt: float | None = None     # 版心字号（纵向，pt）
    base_pt_h: float | None = None   # 版心字号（横向，pt）
    base_font: str | None = None
    line_gap_mm: float | None = None    # 行距（行间空隙，PRO 的 BX 行距）
    line_pitch_mm: float | None = None  # 行高 = 字高 + 行距
    lines_per_page: int | None = None   # 版心高 / 行高
    chars_per_line: int | None = None   # 单栏宽 / 字宽
    ps: dict | None = None           # 成品 PS 的介质尺寸/页数
    checks: list[dict] = field(default_factory=list)
    source: str = "无"
    notes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    pro_path: str | None = None

    def summary(self) -> str:
        def f(v):
            return "—" if v is None else f"{v:g}"
        parts = [f"页面 {f(self.page_w)}×{f(self.page_h)}mm"]
        if self.bleed is not None:
            parts.append(f"出血 {f(self.bleed)}mm")
        if self.trim_w:
            parts.append(f"成品 {f(self.trim_w)}×{f(self.trim_h)}mm")
        parts.append(f"版心 {f(self.text_w)}×{f(self.text_h)}mm")
        col = f"{self.columns} 栏"
        if self.column_w:
            col += f"（栏宽 {f(self.column_w)}mm"
            col += f"，栏距 {f(self.column_gap)}mm）" if self.column_gap else "）"
        parts.append(col)
        if self.base_pt:
            parts.append(f"基准 {f(self.base_pt)}pt")
        parts.append(f"来源：{self.source}")
        return "；".join(parts)


_NUM = r"(\d+(?:\.\d+)?)"


def _bp_text(dec: Decoded) -> str:
    t = dec.text
    m = re.search(r"〖BP[(（]〗([^〖]*)", t)
    if m:
        return m.group(1)
    m2 = re.search(r"〖BP[(（]([^〖]*)", t)
    return m2.group(1) if m2 else ""


def parse_bp(dec: Decoded) -> dict:
    s = _bp_text(dec)
    out: dict = {"raw": s.strip()}
    s2 = s.replace("乘以", "*").replace("×", "*").replace("X", "*")
    # "成品206乘以296" 这类写法：给出的顺序即 宽×高
    m = re.search(rf"成品[：:　 ]*{_NUM}\s*[*]\s*{_NUM}", s2)
    if m:
        out["a"], out["b"] = float(m.group(1)), float(m.group(2))
        out["order"] = "wh"
    else:
        m = re.search(rf"{_NUM}\s*[*]\s*{_NUM}", s2)
        if m:
            out["a"], out["b"] = float(m.group(1)), float(m.group(2))
    for key, pat in (("top", rf"上\s*{_NUM}"), ("bottom", rf"下\s*{_NUM}"),
                     ("left1", rf"左\s*{_NUM}"), ("right1", rf"右\s*{_NUM}")):
        mm = re.search(pat, s)
        if mm:
            out[key] = float(mm.group(1))
    mm = re.search(rf"左右\s*{_NUM}", s)
    if mm:
        out["left"] = out["right"] = float(mm.group(1))
    mm = re.search(rf"上下\s*{_NUM}", s)
    if mm:
        out["top"] = out["bottom"] = float(mm.group(1))
    out.setdefault("left", out.get("left1"))
    out.setdefault("right", out.get("right1"))
    if "含出血" in s:
        out["bleed"] = 3.0
    return out


def parse_bx(dec: Decoded) -> dict:
    """按官方公式解析 PRO 的 BX 注解：

    [BX<版心字号><版心字体>[《H外挂》][《W外挂》][<颜色>],
       <版心高>。<版心宽>,<行距>[!][B][D]
       [C<成品高>。<成品宽>,[A][S]<上空或下空>,[Z]<订口或切口>,<出血>,[Q][F]]]

    注意：第三个 mm 值是**行距**（曾被误读为出血）；C 值才是成品尺寸；
    出血尺寸是 C 段里最后一个 mm（本系列均为 0）。
    """
    m = re.search(r"〖BX([^〗]*)〗", dec.text)
    if not m:
        return {}
    body = m.group(1)
    out: dict = {"raw": body}
    rest = body

    # ---- 1) 版心字号（双向字号；`N"`=小N号，`N.`=N磅，`N.M`=N磅M分）+ 字体 ----
    m = re.match(
        r"\s*(?P<v>\d+(?:\.\d*)?[;\"”]?)"
        r"(?:[，,]\s*(?P<h>\d+(?:\.\d*)?[;\"”]?))?"
        r"(?P<fonts>[A-Za-z＆&]*)", rest)
    if m:
        from .sizes import parse_size
        out["base_pt_v"] = parse_size(m.group("v"))
        out["base_pt_h"] = parse_size(m.group("h")) if m.group("h") else out["base_pt_v"]
        out["base_fonts"] = m.group("fonts")
        rest = rest[m.end():]

    # ---- 2) 版心高。版心宽 ----
    m = re.match(r"[，,]?\s*(\d+(?:\.\d+)?)mm\s*[。.]\s*(\d+(?:\.\d+)?)mm", rest)
    if m:
        out["text_h"], out["text_w"] = float(m.group(1)), float(m.group(2))
        rest = rest[m.end():]

    # ---- 3) 行距（到 C 或下一个 ，S/，Z/，数字mm 之前）----
    m = re.match(r"[，,]?\s*([^，,C]*?)(?=(?:C|[，,]\s*[ASZ\d])|$)", rest)
    if m and m.group(1).strip():
        out["line_gap_raw"] = m.group(1).strip()
        out["line_gap_mm"] = _to_mm(m.group(1).strip().rstrip("!BD"), out.get("base_pt_v"))
        rest = rest[m.end():]

    # ---- 4) 标志 !/B/D ----
    m = re.match(r"([!BD]*)", rest)
    if m and m.group(1):
        out["flags"] = m.group(1)
        rest = rest[m.end():]

    # ---- 5) C 成品尺寸 ----
    m = re.match(r"\s*C\s*(\d+(?:\.\d+)?)mm\s*[。.]\s*(\d+(?:\.\d+)?)mm", rest)
    if m:
        out["trim_h"], out["trim_w"] = float(m.group(1)), float(m.group(2))
        rest = rest[m.end():]

    # ---- 6) [A][S]<上空/下空> ----
    m = re.match(r"[，,]?\s*(A?)(S?)\s*(\d+(?:\.\d+)?)mm", rest)
    if m:
        out["align_center"] = bool(m.group(1))
        out["space_is_top"] = bool(m.group(2))       # 有 S 表示上空，否则下空
        out["space_mm"] = float(m.group(3))
        rest = rest[m.end():]

    # ---- 7) [Z]<订口/切口> ----
    m = re.match(r"[，,]?\s*(Z?)\s*(\d+(?:\.\d+)?)mm", rest)
    if m:
        out["gutter_is_left"] = bool(m.group(1))     # 有 Z 表示订口，否则切口
        out["gutter_mm"] = float(m.group(2))
        rest = rest[m.end():]

    # ---- 8) 出血尺寸 ----
    m = re.match(r"[，,]?\s*(\d+(?:\.\d+)?)mm", rest)
    if m:
        out["bleed"] = float(m.group(1))
        rest = rest[m.end():]

    # ---- 9) [Q][F] ----
    m = re.match(r"[，,]?\s*([QF]*)", rest)
    if m and m.group(1):
        out["page_flags"] = m.group(1)
    return out


def _to_mm(expr: str, base_pt: float | None) -> float | None:
    """行距/字距参数 → mm。支持 mm / p(磅) / x(字宽) / 倍数[*分数] / 字号:倍数*分数。"""
    try:
        e = (expr or "").strip()
        if not e:
            return None
        m = re.match(r"(?:([\d.]+[;\"”]?)\s*:\s*)?(.*)$", e)
        ref_pt = base_pt
        if m and m.group(1):
            from .sizes import parse_size
            ref_pt = parse_size(m.group(1))
            e = m.group(2).strip()
        from .sizes import PT2MM
        em = (ref_pt or 12.0) * PT2MM
        m = re.fullmatch(r"(\d+(?:\.\d+)?)mm", e)
        if m:
            return float(m.group(1))
        m = re.fullmatch(r"(\d+(?:\.\d+)?)p", e)
        if m:
            return round(float(m.group(1)) * PT2MM, 3)
        m = re.fullmatch(r"(\d+(?:\.\d+)?)x", e)
        if m:
            return round(float(m.group(1)) * em, 3)
        m = re.fullmatch(r"\*?\s*(\d+)\s*/\s*(\d+)", e)          # *分数
        if m:
            return round(em * int(m.group(1)) / int(m.group(2)), 3)
        m = re.fullmatch(r'(\d+(?:\.\d+)?)?\*(\d+)', e)
        if m:
            # Legacy shorthand *2 = 1/2; 1*2 = 1 + 1/2 (guide examples).
            return round(em * (float(m.group(1) or 0) + 1 / int(m.group(2))), 3)
        m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*\*?\s*(?:(\d+)\s*/\s*(\d+))?", e)  # 倍数[*分数]
        if m:
            v = float(m.group(1))
            if m.group(2) and m.group(3):
                v += int(m.group(2)) / int(m.group(3))
            return round(em * v, 3)
        return None
    except (ValueError, TypeError):
        return None


def parse_fl(dec: Decoded, base_pt: float | None = None) -> dict:
    """解析分栏注解（官方公式）：

    [FL(<栏宽>|<分栏数>)[!][H<线号>]<线型>][<颜色>][K<字距>]]…[FL)(X|<拉平栏数>)]

    注意：`K` 后面的是**栏间距**（曾被误读为栏数）；`!` 才画栏线；
    `-<线型>` 是线型（F/S/D/Q/=/CW/XW/H<花边编号>）。
    """
    raws = re.findall(r"〖FL[(（]([^〗]*)〗", dec.text)
    if not raws:
        return {}
    raw = Counter(raws).most_common(1)[0][0]
    s = raw
    out: dict = {"raw": raw, "variants": dict(Counter(raws))}
    m = re.match(r"\s*(\d+)", s)                       # 分栏数
    if m:
        out["columns"] = int(m.group(1))
        s = s[m.end():]
    if s.startswith("!"):
        out["rule"] = True
        s = s[1:]
    m = re.match(r"H(\d+(?:\.\d+)?[\"”]?)", s)          # 线号
    if m:
        out["line_size"] = m.group(1)
        s = s[m.end():]
    m = re.match(r"-(CW|XW|H\d+|[FSDQZ=])", s)        # K starts gap, not part of line type
    if m:
        out["line_type"] = m.group(1)
        s = s[m.end():]
        out['rule'] = True
    m = re.match(r"@(%?)\(([\d,]+)\)", s)               # 栏线颜色
    if m:
        out["color"] = m.group(2)
        s = s[m.end():]
    m = re.match(r"K(.+)$", s)                          # 栏间距（字距）
    if m:
        out["gap_raw"] = m.group(1).strip()
        out["gap"] = _to_mm(out["gap_raw"], base_pt)
    return out


def _ps_candidates(fbd_path: str) -> list[str]:
    """在与 fbd 同级、上级、上上级目录中收集 .PS 候选。"""
    d = os.path.dirname(os.path.abspath(fbd_path))
    out: list[str] = []
    for _ in range(3):
        if not d:
            break
        for fn in os.listdir(d) if os.path.isdir(d) else []:
            if fn.lower().endswith(".ps"):
                p = os.path.join(d, fn)
                if p not in out:
                    out.append(p)
        d = os.path.dirname(d)
    return out


def _read_ps(ps: str) -> dict:
    size = os.path.getsize(ps)
    try:
        with open(ps, "rb") as f:
            head = f.read(8192).decode("latin-1", errors="replace")
        m = re.search(r"%%BoundingBox:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", head)
        bbox = None
        if m:
            x0, y0, x1, y1 = map(float, m.groups())
            bbox = (round((x1 - x0) * 25.4 / 72, 1), round((y1 - y0) * 25.4 / 72, 1))
        with open(ps, "rb") as f:
            data = f.read()
        pages = data.count(b"showpage")
        m2 = re.search(rb"%%Pages:\s*(\d+)", data[-400000:])
        if m2:
            pages = int(m2.group(1))
        return {"path": ps, "name": os.path.basename(ps), "size": size,
                "bbox_mm": bbox, "pages": pages}
    except Exception as e:
        return {"path": ps, "name": os.path.basename(ps), "size": size,
                "bbox_mm": None, "pages": None, "error": str(e)}


_PS_KEYWORDS = ["答题卡", "小册子", "目录", "答案", "正文"]


def probe_ps(fbd_path: str, trim: tuple | None = None) -> dict | None:
    """为 fbd 找对应的成品 PS：① 同名 → ② 组件关键词 → ③ 长公共子串 → ④ 成品尺寸；否则只列候选。

    （工程里 PS 常按组件命名，如 目录.PS / 答案16K.PS / 人教七语上.PS，
      与小样名并不一致；仅靠"七语"这类通用字串会误配，故优先组件关键词。）
    """
    stem = os.path.splitext(os.path.basename(fbd_path))[0]
    cands = _ps_candidates(fbd_path)
    if not cands:
        return None
    infos = [_read_ps(p) for p in cands]
    match, how = None, None
    for i in infos:                                    # ① 同名
        if os.path.splitext(i["name"])[0] == stem:
            match, how = i, "同名"
            break
    if match is None:                                  # ② 组件关键词
        keys = [k for k in _PS_KEYWORDS if k in stem]
        for i in infos:
            if any(k in i["name"] for k in keys):
                match, how = i, f"组件关键词（{'/'.join(keys)}）"
                break
    if match is None:                                  # ③ 长公共子串（≥3 字）
        best, best_len = None, 2
        for i in infos:
            other = os.path.splitext(i["name"])[0]
            for L in range(min(len(stem), len(other)), 2, -1):
                if any(stem[a:a + L] in other for a in range(len(stem) - L + 1)):
                    if L > best_len:
                        best, best_len = i, L
                    break
        if best is not None:
            match, how = best, f"名称相近（{best_len} 字）"
    if match is None and trim:                         # ④ 成品尺寸匹配
        tw, th = trim
        for i in infos:
            b = i.get("bbox_mm")
            if b and abs(min(b) - min(tw, th)) < 2.0 and abs(max(b) - max(tw, th)) < 2.0:
                match, how = i, "成品尺寸匹配"
                break
    out = {"match": match, "how": how,
           "candidates": [{k: v for k, v in i.items() if k in ("name", "bbox_mm", "pages")}
                          for i in infos]}
    if match:
        out.update(match)
    return out



def _check(g: Geometry, bp: dict, bx: dict) -> None:
    """生成校验项：每一处差异都给出 level 与原文级说明。"""
    from .sizes import mm_of
    ch = g.checks
    if g.page_w and g.page_h:
        ch.append({"level": "ok",
                   "text": f"页面（含出血）{g.page_w:g}×{g.page_h:g}mm ← BP 声明"})
    # ---- 成品：官方定义为 PRO 的 C 值；缺 PRO 时按 页面−2×出血 推定 ----
    if bx.get("trim_w") and bx.get("trim_h"):
        g.trim_w, g.trim_h = bx["trim_w"], bx["trim_h"]
        ch.append({"level": "ok",
                   "text": f"成品尺寸 {g.trim_w:g}×{g.trim_h:g}mm ← PRO 的 C 值"})
        if g.page_w and g.page_h:
            dw = abs(g.page_w - g.trim_w)
            if dw > 1.5:
                # 6mm（每边 3mm）是典型出血关系 → 提示；其它差值 → 提示为可能错配
                lvl = "info"
                why = ("相差 6mm = 每边 3mm，符合出血/裁切关系" if abs(dw - 6) < 1.0
                       else f"相差 {dw:g}mm，与常规出血不符，请确认 PRO 是否与本小样配套")
                ch.append({"level": lvl,
                           "text": f"成品 {g.trim_w:g}×{g.trim_h:g}mm（PRO）与 BP 页面 "
                                   f"{g.page_w:g}×{g.page_h:g}mm {why}"})
    elif g.page_w and g.page_h and g.bleed:
        g.trim_w = round(g.page_w - 2 * g.bleed, 1)
        g.trim_h = round(g.page_h - 2 * g.bleed, 1)
        ch.append({"level": "info",
                   "text": f"成品（推定）= 页面 − 2×出血 = {g.trim_w:g}×{g.trim_h:g}mm（无 PRO）"})
    # ---- 先算单栏宽（后面的字/行估算要用） ----
    if g.columns >= 2 and g.text_w and g.column_gap:
        g.column_w = round((g.text_w - (g.columns - 1) * g.column_gap) / g.columns, 2)
    # ---- 行高与容量估算（P4 基础） ----
    if g.line_gap_mm is not None and g.base_pt:
        g.line_pitch_mm = round(mm_of(g.base_pt) + g.line_gap_mm, 3)
        ch.append({"level": "ok",
                   "text": f"行距 {g.line_gap_mm:g}mm（PRO 的 BX）+ 字高 {mm_of(g.base_pt):g}mm"
                           f" → 行高 {g.line_pitch_mm:g}mm"})
        if g.text_h:
            g.lines_per_page = int(g.text_h // g.line_pitch_mm)
            ch.append({"level": "info",
                       "text": f"版心高 {g.text_h:g}mm ÷ 行高 {g.line_pitch_mm:g}mm"
                               f" ≈ {g.lines_per_page} 行/页（未计 HJ 覆盖）"})
    if g.text_w and g.base_pt:
        char_w = mm_of(g.base_pt_h or g.base_pt)
        col_w = g.column_w or g.text_w
        if char_w:
            g.chars_per_line = int(col_w // char_w)
            ch.append({"level": "info",
                       "text": f"单栏宽 {col_w:g}mm ÷ 字宽 {char_w:g}mm"
                               f" ≈ {g.chars_per_line} 字/行（未计标点挤压与禁则）"})
    if g.ps and g.ps.get("bbox_mm"):
        pw, ph = g.ps["bbox_mm"]
        tag = f"（{g.ps.get('how')}）" if g.ps.get("how") else ""
        if g.trim_w:
            same = (abs(min(pw, ph) - min(g.trim_w, g.trim_h)) < 2.0
                    and abs(max(pw, ph) - max(g.trim_w, g.trim_h)) < 2.0)
            ch.append({"level": "ok" if same else "warn",
                       "text": (f"成品 PS {g.ps['name']}{tag} 介质 {pw:g}×{ph:g}mm"
                                + (f"（{g.ps['pages']} 页）与成品尺寸一致"
                                   if same else
                                   f"（{g.ps['pages']} 页）与成品 {g.trim_w:g}×{g.trim_h:g}mm "
                                   "不一致：输出/发排设置不随文件携带，需人工确认"))})
        else:
            ch.append({"level": "info",
                       "text": f"成品 PS {g.ps['name']}{tag} 介质 {pw:g}×{ph:g}mm（{g.ps['pages']} 页）"})
    elif g.ps and g.ps.get("candidates"):
        cs = "；".join(f"{c['name']} {c['bbox_mm'][0]:g}×{c['bbox_mm'][1]:g}mm"
                       + (f"（{c['pages']} 页）" if c.get("pages") else "")
                       for c in g.ps["candidates"] if c.get("bbox_mm"))
        if cs:
            ch.append({"level": "info", "text": "邻近 PS 候选（未能确定对应关系）：" + cs})
    if bx and bp.get("a"):
        if g.text_w and g.m_left is not None and g.m_right is not None and g.page_w:
            calc = g.page_w - g.m_left - g.m_right
            lvl = "ok" if abs(calc - g.text_w) <= 2.0 else "warn"
            ch.append({"level": lvl,
                       "text": f"版心宽 {g.text_w:g}mm ← PRO；页面−边空 = {calc:g}mm"
                               + ("（一致）" if lvl == "ok" else "（不一致）")})
        if bx.get("trim_w") and g.page_w and abs(bx["trim_w"] - g.page_w) > 1.5:
            ch.append({"level": "warn",
                       "text": f"成品宽不一致：PRO 的 C 值 {bx['trim_w']:g} vs BP {g.page_w:g}mm"
                               "（参数错配，PRO 可能是旧文件）"})
    elif not bx:
        ch.append({"level": "info", "text": "未找到同名 .PRO：边空/版心由 BP 推导"})
    if g.columns >= 2 and g.text_w and g.column_gap:
        ch.append({"level": "ok",
                   "text": f"单栏宽 = ({g.text_w:g} − {g.columns - 1}×{g.column_gap:g}) / {g.columns}"
                           f" = {g.column_w:g}mm"
                           + (f"；{g.column_rule}" if g.column_rule else "")})


def analyze_geometry(fbd_path: str, fbd_dec: Decoded, pro_path: str | None = None) -> Geometry:
    bp = parse_bp(fbd_dec)
    pro_path = pro_path or os.path.splitext(fbd_path)[0] + ".PRO"
    bx = parse_bx(read_bytes(pro_path)) if os.path.exists(pro_path) else {}

    g = Geometry()
    g.pro_path = pro_path if os.path.isfile(pro_path) else None
    # 版心字号要先算出来，分栏的 `K<字距>`（字宽为单位）需要它换算
    if bx.get("base_pt_v"):
        g.base_pt = bx["base_pt_v"]
        g.base_pt_h = bx.get("base_pt_h") or bx["base_pt_v"]
        g.base_font = re.split(r'[＆&]', bx.get("base_fonts") or 'SS')[0]
    g.line_gap_mm = bx.get("line_gap_mm")
    if g.line_gap_mm is None and bx.get("line_gap_raw"):
        g.notes.append(f"行距参数 {bx['line_gap_raw']} 未能换算为毫米（按未设置处理）")
    fl = parse_fl(fbd_dec, g.base_pt)

    g.columns = fl.get("columns") or (2 if fl.get('raw') else 1)
    g.column_gap = fl.get("gap")
    if fl.get("rule") or fl.get("line_type"):
        g.column_rule = ("栏线 " + (fl.get("line_type") or "正线")
                         + (f"（线号 {fl['line_size']}）" if fl.get("line_size") else "")) \
            if fl.get("rule") else f"线型 {fl.get('line_type')}（未加 !，按不画线处理）"
    if fl.get("variants") and len(fl["variants"]) > 1:
        g.notes.append("分栏写法不唯一：" + "、".join(f"{k}×{v}" for k, v in fl["variants"].items()))
    if fl.get("raw") and fl.get("columns") is None:
        g.notes.append(f"分栏 〖FL（{fl['raw']}〗 未给出栏数（官方公式中栏数可缺省），"
                       f"预览默认采用 2 栏（参考本工程成品，可在网页调整），栏间距按 {fl.get('gap_raw') or '—'} 计")

    a, b = bp.get("a"), bp.get("b")
    if a and b:
        cand = [(a, b), (b, a)]
        chosen = None
        if bx.get("trim_w") and bx.get("trim_h"):
            for w, h in cand:                              # 用 PRO 的成品尺寸消歧
                if abs(w - bx["trim_w"]) < 1.5 and abs(h - bx["trim_h"]) < 1.5:
                    chosen, g.source = (w, h), "BP+PRO"
                    break
        if chosen is None and bx.get("text_w") and bp.get("left") is not None:
            for w, h in cand:
                if abs((w - 2 * bp["left"]) - bx["text_w"]) < 2.0:
                    chosen, g.source = (w, h), "BP+PRO（按版心消歧）"
                    break
        if chosen is None:
            if bp.get("order") == "wh":           # BP 用"成品宽×高"写法，直接采信
                chosen = (a, b)
                g.source = "BP（成品写法）"
            elif g.columns >= 3:                  # 三栏及以上 → 横向对页（试卷）
                chosen = (max(a, b), min(a, b))
                g.source = "BP（取向推定：多栏）"
            else:
                chosen = (min(a, b), max(a, b))
                g.source = "BP（取向推定：纵向）"
            g.notes.append("PRO 与 BP 尺寸不一致，页面取向按 BP+分栏推定" if bx
                           else "无同名 .PRO，页面取向为推定值")
        g.page_w, g.page_h = chosen
    elif bx.get("trim_w"):
        g.page_w, g.page_h = bx["trim_w"], bx["trim_h"]
        g.source = "PRO（无 BP）"

    if bx.get('trim_w') and bx.get('trim_h'):
        # BP is a non-printing comment, not an authoritative page instruction.
        declared = (bx['trim_w'] + 2*(bx.get('bleed') or 0), bx['trim_h'] + 2*(bx.get('bleed') or 0))
        if g.page_w and (abs(g.page_w-declared[0])>.1 or abs(g.page_h-declared[1])>.1):
            g.notes.append('BP 尺寸提示与 PRO 不一致；预览采用 PRO 成品和出血设置')
        g.page_w,g.page_h = declared
        g.source = 'PRO（BP 为非排版尺寸提示）'

    g.bleed = bx.get('bleed') if bx.get('bleed') is not None else bp.get('bleed')
    g.m_top, g.m_bottom = bp.get("top"), bp.get("bottom")
    g.m_left, g.m_right = bp.get("left"), bp.get("right")
    # PRO 的 S/Z：有 S 表示上空，否则下空；有 Z 表示订口（左），否则切口（右）
    if g.m_top is None and bx.get("space_mm") is not None:
        if bx.get("space_is_top"):
            g.m_top = bx["space_mm"]
        else:
            g.m_bottom = bx["space_mm"]
    if g.m_left is None and bx.get("gutter_mm") is not None:
        if bx.get("gutter_is_left"):
            g.m_left = bx["gutter_mm"]
        else:
            g.m_right = bx["gutter_mm"]
    if g.m_top is not None and g.m_bottom is None and bx.get("text_h") and g.page_h:
        g.m_bottom = round(g.page_h - g.m_top - bx["text_h"], 2)
    if g.m_left is not None and g.m_right is None and bx.get("text_w") and g.page_w:
        g.m_right = round(g.page_w - g.m_left - bx["text_w"], 2)

    g.text_w, g.text_h = bx.get("text_w"), bx.get("text_h")
    if bx.get('align_center') and g.page_w and g.page_h and g.text_w and g.text_h:
        g.m_left = g.m_right = (g.page_w-g.text_w)/2
        g.m_top = g.m_bottom = (g.page_h-g.text_h)/2
    if g.text_w is None and g.page_w and g.m_left is not None and g.m_right is not None:
        g.text_w = round(g.page_w - g.m_left - g.m_right, 2)
        g.source += "（版心为推导值）"
    if g.text_h is None and g.page_h and g.m_top is not None and g.m_bottom is not None:
        g.text_h = round(g.page_h - g.m_top - g.m_bottom, 2)
    # 成品：优先 PRO 的 C 值（官方定义），否则用 页面−2×出血 推定
    if bx.get("trim_w") and bx.get("trim_h"):
        g.trim_w, g.trim_h = bx["trim_w"], bx["trim_h"]
    elif g.page_w and g.page_h and g.bleed:
        g.trim_w = round(g.page_w - 2 * g.bleed, 1)
        g.trim_h = round(g.page_h - 2 * g.bleed, 1)
    g.ps = probe_ps(fbd_path, (g.trim_w, g.trim_h) if g.trim_w else None)

    _check(g, bp, bx)
    for c in g.checks:
        if c["level"] == "warn":
            g.warnings.append(c["text"])
    return g

# -*- coding: utf-8 -*-
"""字号与字体（依据《方正书版使用指南》9.2 汉体注解(HT)）。

公式： [HT[<双向字号>][<汉字字体>[<汉字外挂字体>]]]
  <双向字号>：<纵向字号>[,<横向字号>]
  字号三选一：
    · 常用字号：数字 0–8；`N"`（右双引号）= 小 N 号
    · 磅字号  ：<磅数>.<磅分数>，磅分数 ∈ {25,50,75}；也可只写 <磅数>. 表示整磅
    · 级字号  ：<数字>;（1 级 = 0.25mm）
  字体：书宋(SS)、黑体(H)、楷体(K)、仿宋(F)、报宋(BS)、细报宋(XBS)、魏碑(W)…
  外文/数字字体：白正(BZ)、黑正(HZ) 等（WT/ST 注解用）
"""
from __future__ import annotations

import re

# 常用字号 → pt（0=初号…8=八号）
SIZE_TABLE = {
    "0": 42.0, "1": 27.5, "2": 21.0, "3": 15.75, "4": 13.75,
    "5": 10.5, "6": 7.875, "7": 5.25, "8": 4.5,
}
# 小字号（`N"`）→ pt
SMALL_TABLE = {
    "0": 36.0, "1": 24.0, "2": 18.0, "3": 15.0, "4": 12.0,
    "5": 9.0, "6": 6.875, "7": 4.5, "8": 4.0,
}
# 汉字字体 → CSS（Windows 常见字体；无对应字体时降级并在报告注明）
FONT_CSS = {
    "SS": "'方正书宋_GBK','FZShuSong-Z01','SimSun','宋体',serif",
    "XBS": "'SimSun','宋体',serif",       # 细报宋
    "BS": "'SimSun','宋体',serif",        # 报宋
    "H": "'方正黑体_GBK','方正公文黑体','FZHei-B01','SimHei','黑体',sans-serif",
    "K": "'方正楷体_GBK','方正公文楷体','FZKai-Z03','KaiTi','STKaiti','楷体',serif",
    "F": "'方正仿宋_GBK','方正公文仿宋','FZFangSong-Z02','FangSong','仿宋',serif",
    "XT": "'方正中等线_GBK','SimHei','黑体',sans-serif",
    "W": "'方正魏碑_GBK','KaiTi','楷体',serif",
    "L": "'LiSu','隶书',serif",           # 隶书
    "Y": "'KaiTi','楷体',serif",          # 隶变/其他
    "BZ": "'Times New Roman',serif",      # 白正（外文/数字）
    "HZ": "'方正黑体_GBK','FZHei-B01','SimHei','黑体',sans-serif",  # 黑正（外文/数字）：用方正黑体的数字/外文字形，不再用 Arial 伪造
}
# 字体代号 → 中文名（供报告显示）
FONT_NAME = {
    "SS": "书宋", "XBS": "细报宋", "BS": "报宋", "H": "黑体", "K": "楷体",
    "F": "仿宋", "XT": "细体", "W": "魏碑", "L": "隶书", "Y": "隶变",
    "BZ": "白正", "HZ": "黑正",
}
# Common legacy faces retain their identity even when rendered by a substitute.
FONT_CSS.update({'DBS': FONT_CSS['BS'], 'DH': FONT_CSS['H'], 'Y3': FONT_CSS['Y'],
                 'BZ6': FONT_CSS['BZ'], 'HZ6': FONT_CSS['HZ'], 'B3': FONT_CSS['BZ'], 'F6': FONT_CSS['F']})
_FONT_KEYS = sorted(FONT_CSS, key=len, reverse=True)
# 外挂字体名写法：《名字[#B][#I]》[!]（官方 HT 公式里的 <汉字外挂字体>）
_EXT_RE = re.compile(r"《([^》]+)》([!]?)")

# Legacy Bookmaker body point. Reference PDF has 5.10mm baseline pitch for
# BX12. / HJ0.9mm: 12 * .35 + .9. CSS/PostScript points remain 25.4/72mm.
PT2MM = 0.35
CSS_PT_SCALE = PT2MM / (25.4 / 72.0)


def size_to_pt(num: str, small: bool = False) -> float | None:
    """字号 → pt。num 为数字串（可能是 5、11.5、17 等）。"""
    if num is None or num == "":
        return None
    if "." not in num and num in (SMALL_TABLE if small else SIZE_TABLE):
        return (SMALL_TABLE if small else SIZE_TABLE)[num]
    try:
        return float(num)
    except ValueError:
        return None


_SIZE_RE = re.compile(
    r"""^\s*
        (?P<v>\d+(?:\.\d*)?[;"”]?)
        (?:[，,]\s*(?P<h>\d+(?:\.\d*)?[;"”]?))?
        (?P<rest>.*)$""",
    re.X | re.S,
)


def parse_size(value: str) -> float | None:
    """书版字号，保留整磅的小数点及级字号的分号。"""
    value = value.strip()
    if value.endswith(";"):
        return float(value[:-1]) * 0.25 / PT2MM
    return size_to_pt(value.rstrip('\"”'), value.endswith(('"', '”')))


def parse_ht(params: str) -> dict:
    """解析 HT/WT/ST 参数。

    官方（HT）：`[HT[<双向字号>][<汉字字体>[<汉字外挂字体>][<汉字外挂字体>]]]`
      <汉字外挂字体>：`#` | `《<汉字外挂字体名>[<外挂字体效果>]》[!]`，效果为 `#B`/`#I`。
      · 只写字体（如 `〖HTH〗`/`〖HTK〗`/`〖HTSS〗`）是合法形态：不改字号、只换字体；
      · `《…》` 是**外挂字体**（GBK 字符用它，书版特有符号仍用方正字体）；
      · 单独一个 `#` 取消外挂字体；`!` 表示外挂字体只对汉字起作用。

    返回 dict：pt_v/pt_h（pt，None=不改）、code（方正字体代号）、ext（外挂字体名）、
    bold/italic（外挂效果 #B/#I）、bang（`!`）、cancel_ext（`#`）、rest（未识别残余）。
    """
    out = {"pt_v": None, "pt_h": None, "code": None, "ext": None,
           "bold": False, "italic": False, "bang": False, "cancel_ext": False, "rest": ""}
    if not params:
        return out
    rest = params
    m = _SIZE_RE.match(params)
    if m:
        out["pt_v"] = parse_size(m.group("v"))
        if m.group("h"):
            out["pt_h"] = parse_size(m.group("h"))
        else:
            out["pt_h"] = out["pt_v"]
        rest = m.group("rest") or ""
        # 磅字号写法 `17.H`：数字后的 `.` 属于字号分隔
        if rest.startswith(".") or rest.startswith("。"):
            rest = rest[1:]
    # 外挂字体《名字[#B|#I]》
    m = _EXT_RE.search(rest)
    if m:
        name, eff = m.group(1), ""
        if "#" in name:
            name, _, eff = name.partition("#")
        out["ext"] = name.strip()
        out["bold"] = "B" in eff.upper()
        out["italic"] = "I" in eff.upper()
        out["bang"] = m.group(2) == "!"
        rest = rest[:m.start()] + rest[m.end():]
    if rest.startswith("#"):                 # 取消外挂字体
        out["cancel_ext"] = True
        rest = rest[1:]
    for k in _FONT_KEYS:                     # 方正汉字字体代号
        if rest.upper().startswith(k):
            out["code"] = k
            rest = rest[len(k):]
            break
    out["rest"] = rest
    return out


def parse_size_font(params: str) -> tuple[float | None, float | None, str | None, str]:
    """兼容旧接口：返回 (纵向pt, 横向pt, 字体代号, 剩余参数)。

    外挂字体以 `@名字` 形式返回（`font_css` 认识这种写法）。
    """
    d = parse_ht(params)
    font = f"@{d['ext']}" if d["ext"] else d["code"]
    return d["pt_v"], d["pt_h"], font, d["rest"]


def family_css(code: str | None, ext: str | None = None) -> str:
    """CSS 字体族：有外挂字体时优先用它，方正字体作为后备。

    官方语义：外挂字体管 GBK 字符，书版特有符号仍用方正汉字字体 —— 所以后备正是方正字体。
    """
    base = FONT_CSS.get((code or "").upper(), FONT_CSS["SS"])
    if not ext:
        return base
    if '黑' in ext:
        base = FONT_CSS['H']
    elif '楷' in ext:
        base = FONT_CSS['K']
    return "'" + ext.replace("'", "").replace('"', "") + "'," + base


def font_css(code: str | None) -> str:
    """字体代号或 `@外挂字体名` → CSS 字体族。"""
    c = code or ""
    if c.startswith("@"):
        return family_css(None, c[1:])
    return FONT_CSS.get(c.upper(), FONT_CSS["SS"])


def font_name(code: str | None) -> str:
    c = code or ""
    if c.startswith("@"):
        return c[1:]
    return FONT_NAME.get(c.upper(), c or "—")


def mm_of(pt: float | None) -> float | None:
    return None if pt is None else round(pt * PT2MM, 3)

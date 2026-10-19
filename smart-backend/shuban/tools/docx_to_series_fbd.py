#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「核心素养综合评价」系列（排版工程侧又称「大联考」）的 Word 稿排成 fbd。

与 docx_to_unit_fbd.py 的区别：那个是**一次性任务脚本**（源路径、参照路径、标题白名单、
颜色值、栏宽全硬编码）；本脚本是**通用版**——版式基底取自系列定稿 fbd 的书眉头字节区间，
其余全部参数化，可换册、换源文件。

系列背景：**「大联考」与「核心素养」是同一系列的两种叫法**（同一产品线，排版工程侧叫大联考、
Word 稿侧叫核心素养）。所以版式参数、书眉头、14 个答案宏、素材命名规范都是**系列共用**的，
照搬定稿不是"借别的系列来套"。

版式基底（同系列定稿 `2026大联考七上语文正文（教用）.fbd`）：
  · 书眉头 = 定稿字节区间 [0, 1481) **去掉左帖线块**（BP 版面声明 + 14 个 ZD 宏定义 + 书眉 + logo 底纹）
  · 卷尾   = 〖LM〗〖FL）0〗〖HT〗〖HJ〗（右帖线块同样不输出，见 STRIP_BLOCK）
  · 文件尾 = 〖FL）0〗 / A6A6 / 空行 / 〖LM〗〖HT〗〖HJ〗（照定稿自身末尾形态）
  · PRO    = 定稿 PRO 逐字节复制
  · 素材   = 正文图与书眉头 EPS 一律写进 **fbd 同目录**（书版按小样同目录查找）

纪律：不手打注解、不手拼字节；换行/换段/结束一律走 fbdgen 的 LINE/PARA/END；
生成后必须 validate() 且内容核对通过。

用法：
    python tools/docx_to_series_fbd.py --source <源.docx> --reference <定稿.fbd> \
        --pro <定稿.PRO> --out output/<名> --name <名> --title-prefix "九年级语文(上)"
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import sys
import unicodedata
import zipfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from xml.etree import ElementTree as ET

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

import fbdgen                                            # noqa: E402
from fbdview.bytes_io import decode                      # noqa: E402

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
LINE, PARA, END = fbdgen.LINE, fbdgen.PARA, fbdgen.END
MATH_FONT_DEFAULT = 'Cambria Math'
MATH_GBK_SYMBOLS = frozenset('×÷≤≥≠±∞∠∑∏√π…∶∴∵∈∉⊂⊆∪∩')
WORD_TAB_WIDTH_MM = 12.7


def fbd_point_size(value: str) -> str:
    points = float(value)
    whole = int(points)
    fraction = round((points - whole) * 100)
    return f'{whole}.{fraction:02d}' if fraction else f'{whole}.'

# ---- docx 特征 → 书版写法（本系列实测，见 模板/语文/大联考/排版规则/06） ----
FONT_CODE = {'方正黑体_GBK': 'H', '方正楷体_GBK': 'K', '方正仿宋_GBK': 'F',
             '方正魏碑_GBK': 'W', '方正书宋_GBK': 'SS',
             '方正小标宋简体': 'XBS',          # 夹册里的横幅标题字（八上夹册实测）
             None: 'SS'}
# 半磅值 → 书版磅值。分数字号带两位小数（10.50）——见 06 第 9 条。
SIZE_PT = {'36': '18', '34': '17', '28': '14', '24': '12', '22': '11',
           '21': '10.50', '18': '9', '16': '8', '12': '6'}
# 卷标题字号（半磅）：七上/九全是 34（17pt），八上是 36（18pt）。
# 分卷判定必须用这个集合，不能写死 '34'——否则换册后一卷都识别不出来。
TITLE_SIZES = {'34', '36'}
ANSWER_COLOR = 'ABD8DA'          # 浅蓝 = 教用答案（正文）
LABEL_COLOR = 'A46AA6'           # 紫 = 题源标注（魏碑）或新考法标签（黑体）
WEIBEI_FONT = '方正魏碑_GBK'
COL_OPEN = '〖FL(3K8mm〗'
# 每卷卷尾的右帖线（装订线）块 —— 整块不输出，原因见 STRIP_BLOCK。
VOL_TAIL = []
VOL_CLOSE = '〖LM〗〖FL）0〗〖HT〗〖HJ〗'

# 帖线（装订线）块：装饰性 BW + 表格 + 帖线图。**发排时必然报 pass2 错误**：
#   官方 PS 语法 `<尺寸>: <空行参数>[。<字距>]` 是 `<高>。<宽>`（注解手册/图片.md），
#   定稿模板把占位框写成 `〖BHDWG10mm,WK265mmW〗`（行高10mm×栏宽265mm 的**横框**）
#   + `〖PSZBW新，+10mm。265mm，BP〗`（高10mm×宽265mm），而 `ZBW新.EPS`/`YBW新.eps`
#   实体是 **10.2×265.3mm 的竖条** —— 10mm 高的行里放 265mm 高的图 → 「内容超高」，
#   并连锁「JZ 内容重叠」「LN 无法拆行」「BW 内容超高」。
#   帖线不承载内容、不影响分页，用户确认可去，故整块删除（左帖线在书眉头、右帖线在 VOL_TAIL）。
STRIP_BLOCK = [
    '〖BW((Y-2*2，，)〗',
    '〖BW)〗',
    '〖BW(B(Z1mm，，)〗',
    '〖BG(〗〖BHDWG10mm,WK265mmW〗',
    '〖PSZBW新，+10mm。265mm，BP〗',
    '〖BG)W〗',
    '〖BW)〗',
]
FILE_TAIL = '〖FL）0〗' + '\r\n' + END + END + '\r\n\r\n〖LM〗〖HT〗〖HJ〗\r\n\r\n'

# ---- 小册子（夹册）版式：基底取自系列定稿 小册子/2026大联考七语小册子.fbd ----
# 与小册子定稿的行区间（1 起、含首不含尾）：[BP 声明 + ZDSB/ZDCC 宏] + [ZDA…ZDWB 宏]。
# 中间夹着的 〖ML(〗 目录块与「名著概览」装饰板块是七上专属内容，不取。
BOOKLET_HEAD_RANGES = [(1, 20), (48, 68)]
# 小册子版式的正文是**双栏**：板块头表格之后 `〖HJ2.8mm〗` + `〖FL(-DK2〗` 开栏，
# 板块末 `〖FL）〗` 收栏；文件尾就是收栏后的双 A6（不再有 〖LM〗〖HT〗〖HJ〗）。
BOOKLET_FL_OPEN = '〖FL(-DK2〗'
BOOKLET_FL_CLOSE = '〖FL）〗'
BOOKLET_TAIL = END + END + '\r\n\r\n'
BOOKLET_TITLE_FONT = '《方正艺黑简体》'      # 板块标题外挂字体（夹册 docx 实测同款）
BOOKLET_TITLE_IMAGE = None
BOOKLET_TITLE_PREFIX = '〖ML〗'
BOOKLET_TITLE_SUFFIX = '〖HT〗'
BOOKLET_TABLE_W = 150.0                     # 板块头表格总宽 mm
BOOKLET_COLOR = 'A46AA6'                    # 夹册的答案色是**紫色**（与正文的浅蓝相反）
SCORE_HEADER = '〖BG(！〗〖BHDFG2,FK4*2,K4*2。5F〗'
SCORE_DIVIDER = '〖BHDG2〗'

# 源文档里 GBK 编码不了的符号 → 书版可用的等价写法。
# 依据：定稿的梳理题箭头就写 `→`（GBK A1FA）；`⇨` 是 Word 流程图里的白色右箭头变体。
# 映射不上的一律**报错停下**，不静默丢字符（丢字符会让内容核对也看不出来）。
SYMBOL_MAP = {
    '⇨': '→', '⇒': '→', '⟶': '→', '⟹': '→',
    '−': '－',                       # Word 数学减号 → 参照数学 FBD 的全角减号
    '∘': '°',                        # 数学字体常用此字符表示角度；书版 GBK 使用度数符号
    '∼': '∽',                        # 几何相似符号 → GBK 可编码的近似相似符号
    '≅': '≌',                        # 三角形全等符号 → GBK 可编码的全等变体
    '⩽': '≤',                        # 小于等于关系符号变体
    '⊗': '⊕',                        # 用户定义运算符 → GBK 可编码的圈形运算符
    '⋅': '·',                        # 数学居中点乘号 → GBK 中点
    '⋯': '…',                        # 数学中线省略号 → GBK 省略号
    '•': '·',                        # 题目标题中的分隔点
    '∗': '＊',                       # 用户定义运算符 → 全角星号，区别于普通乘号
    '\u2009': ' ',                   # Word 细空格 → 普通空格，保留词间分隔
    '\u200a': ' ',                   # Word Hair Space → 普通空格
    '▱': '平行四边形',               # 几何图形标记用文字表达，避免替换成不同形状
    '\u2060': '',                    # Word Joiner 不可见且不承载内容
    '₂': chr(0xE1AD) + '2',          # 化学式下标 → 书版下标控制符
    '₄': chr(0xE1AD) + '4',
    '₅': chr(0xE1AD) + '5',
    '⑪': chr(0xE1A1) + 'B21' + chr(0xE1A3),  # 圈码 11
    '⑫': chr(0xE1A1) + 'B22' + chr(0xE1A3),  # 圈码 12
    '➝': '→',                        # 化学反应箭头
    chr(0x100C47): '⊕',             # Word 私用运算符字形，源文档语义为“⊕”
    '|': '｜', '{': '｛', '}': '｝',
}
CONTENT_SYMBOL_MAP = {
    **SYMBOL_MAP,
    '₂': '2', '₄': '4', '₅': '5',
    '⑪': '21', '⑫': '22',
}

# 半角方括号 `[` `]` 在方正书版里是**注解定界符**（注解可写 `[注解]` 或 `〖注解〗`），
# 正文里出现就会被当成注解去解析 → pass1「注解位置错」。必须转成全角。
# 定稿的写法即如此：`［〖HTK〗《十一月四日风雨大作》（其二）〖HT〗］`
# （定稿里半角 `[`/`]` 出现 0 次，全角 `［`/`］` 4 次。）
DELIM_MAP = {'[': '［', ']': '］'}

# 答案宏 `=C/=D` 是否内联展开。默认内联（历史行为）；
# `--macro-answers` 改回宏调用，与系列定稿一致。详见 INLINE_C_ANSWER 的用法说明。
INLINE_C_ANSWER = True
MATH_ANSWER_SCHEME = False


@dataclass
class Run:
    text: str = ''
    font: str | None = None
    ascii_font: str | None = None
    size: str | None = None
    color: str | None = None
    underline: str | None = None
    em: bool = False
    bold: bool = False
    italic: bool = False
    vert_align: str | None = None
    image: str | None = None
    image_w: float | None = None
    image_h: float | None = None
    image_scale_x: float | None = None
    image_scale_y: float | None = None
    br: bool = False
    tab: bool = False
    para_break: bool = False        # 单元格内多个 w:p 的分界（渲染时落成换行符）
    formula: bool = False

    @property
    def is_answer(self) -> bool:
        return ANSWER_COLOR is not None and self.color == ANSWER_COLOR

    @property
    def is_label(self) -> bool:
        # 题源标注：魏碑体；或（正文里）紫色。夹册模式把紫色让给答案，所以魏碑只能按字体认。
        return self.font == WEIBEI_FONT or (LABEL_COLOR is not None
                                            and self.color == LABEL_COLOR)


@dataclass
class Para:
    runs: list = field(default_factory=list)
    center: bool = False
    right: bool = False
    indent: bool = False

    @property
    def text(self) -> str:
        return ''.join(r.text for r in self.runs)

    @property
    def max_size(self) -> str:
        """最大字号（半磅）。用于识别卷标题——标题段整段都是标题字号。"""
        sizes = [r.size for r in self.runs if r.size]
        return max(sizes, key=lambda s: float(s)) if sizes else '24'

    @property
    def dom_size(self) -> str:
        """**占字符数最多**的字号（半磅）。用于段首字体切换——
        用 max 会把「一个 9pt 答案 run + 一整段 6pt 参考译文」整段放大成 9pt。"""
        counts = {}
        for r in self.runs:
            if r.text.strip() and r.size:
                counts[r.size] = counts.get(r.size, 0) + len(r.text)
        if counts:
            return max(counts, key=counts.get)
        return self.max_size

    @property
    def dom_font(self) -> str:
        """按字符数占多数的字体（跳过答案 run，答案由宏自带字体）。"""
        counts = {}
        for r in self.runs:
            if r.is_answer or not r.text.strip():
                continue
            counts[r.font] = counts.get(r.font, 0) + len(r.text)
        return max(counts, key=counts.get) if counts else None

    @property
    def all_answer(self) -> bool:
        return bool(self.runs) and all(r.is_answer or not r.text.strip() for r in self.runs)


# ---------- docx 解析 ----------

def parse_runs(el, mark_paras: bool = False) -> list:
    """把一个 w:p / w:tc 解析成 Run 列表。

    mark_paras=True 时（**表格单元格专用**）：按 cell 内的各个 `w:p` 分别取 run，
    段与段之间插一个 `para_break` 标记 —— 否则 `el.iter(W+'r')` 会把一格里的
    7 个段落拉平成一段，落盘后**整格文字挤在一行、撑满整栏**
    （八上正文的「邀请函」就是这样坏的）。同时保留 OMML 公式在段落中的原有顺序。
    """
    out = []
    if not mark_paras:
        return _runs_of(el)
    for child in el:
        if child.tag == W+'p':
            if out:
                out.append(Run(para_break=True))
            out.extend(_runs_of(child))
        elif child.tag == W+'tbl':
            rows = child.findall(W+'tr')
            for ri, tr in enumerate(rows):
                if out or ri:
                    out.append(Run(para_break=True))
                for ci, tc in enumerate(tr.findall(W+'tc')):
                    if ci:
                        out.append(Run(text='　'))
                    out.extend(parse_runs(tc, mark_paras=True))
    return out


def _runs_of(el) -> list:
    out = []

    def visible_text(node):
        return ''.join(t.text or '' for t in node.iter() if t.tag in (W+'t', M+'t'))

    def needs_gap_before(ch):
        return ch is not None and not ch.isspace() and ch not in '([{（［《〈「『“‘'

    def needs_gap_after(ch):
        return ch is not None and not ch.isspace() and ch not in ')]}，。；：？！、）》］〉」』”’'

    size_counts = {}
    for candidate in el.iter(W+'r'):
        candidate_pr = candidate.find(W+'rPr')
        candidate_size = candidate_pr.find(W+'sz') if candidate_pr is not None else None
        text = ''.join(t.text or '' for t in candidate.iter(W+'t'))
        if candidate_size is not None and text.strip():
            size_counts[candidate_size.get(W+'val')] = (
                size_counts.get(candidate_size.get(W+'val'), 0) + len(text))
    para_pr = el.find(W+'pPr')
    para_rpr = para_pr.find(W+'rPr') if para_pr is not None else None
    para_size = para_rpr.find(W+'sz') if para_rpr is not None else None
    base_size = (f'{int(max(size_counts, key=size_counts.get)) / 2:g}' if size_counts
                 else f'{int(para_size.get(W+"val")) / 2:g}' if para_size is not None
                 else '12')

    def enabled(rPr, name):
        item = rPr.find(W + name)
        return item is not None and item.get(W+'val', '1').lower() not in ('0', 'false', 'off')

    def add_run(r):
        rPr = r.find(W+'rPr')
        run = Run()
        if rPr is not None:
            f = rPr.find(W+'rFonts')
            s = rPr.find(W+'sz')
            c = rPr.find(W+'color')
            u = rPr.find(W+'u')
            run.font = f.get(W+'eastAsia') if f is not None else None
            run.ascii_font = ((f.get(W+'ascii') or f.get(W+'hAnsi'))
                              if f is not None else None)
            run.size = s.get(W+'val') if s is not None else None
            run.color = c.get(W+'val') if c is not None else None
            run.underline = u.get(W+'val') if u is not None else None
            run.em = rPr.find(W+'em') is not None
            run.bold = enabled(rPr, 'b')
            run.italic = enabled(rPr, 'i')
            va = rPr.find(W+'vertAlign')
            run.vert_align = va.get(W+'val') if va is not None else None
        run.text = ''.join(t.text or '' for t in r.iter(W+'t'))
        run.br = r.find(W+'br') is not None
        run.tab = r.find(W+'tab') is not None
        blip = r.find('.//' + '{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
        if blip is not None:
            run.image = blip.get(R+'embed')
            extent = r.find('.//' + WP+'extent')
            if extent is not None:
                run.image_w = int(extent.get('cx', '0')) / 36000
                run.image_h = int(extent.get('cy', '0')) / 36000
        if run.text or run.image or run.br or run.tab:
            out.append(run)

    def walk(node):
        children = list(node)
        for index, child in enumerate(children):
            if child.tag == W+'r':
                add_run(child)
            elif child.tag in (M+'oMath', M+'oMathPara'):
                text = omml_to_fbd(child, base_size=base_size)
                previous = next((r.text for r in reversed(out) if r.text), '')
                following = next((visible_text(sibling) for sibling in children[index+1:]
                                  if visible_text(sibling)), '')
                if previous and needs_gap_before(previous[-1]):
                    text = ' ' + text
                if following and needs_gap_after(following[0]):
                    text += ' '
                out.append(Run(text=text, formula=True))
            else:
                walk(child)

    walk(el)
    for i, run in enumerate(out):
        if not run.formula:
            continue
        neighbors = out[max(0, i - 1):i] + out[i + 1:i + 2]
        styled = next((candidate for candidate in neighbors if candidate.color), None)
        if styled:
            run.color = styled.color
    return out


def omml_to_fbd(node, base_size: str = '12') -> str:
    """将 Word OMML 数学节点映射为参照数学 FBD 中实测的结构。"""
    def tag(el):
        return el.tag.rsplit('}', 1)[-1]

    def child(el, name):
        return el.find(M + name) if el is not None else None

    def enabled(rPr, name):
        item = rPr.find(W + name) if rPr is not None else None
        return item is not None and item.get(W+'val', '1').lower() not in ('0', 'false', 'off')

    def value(el, name, default=''):
        prop = child(el, name)
        return prop.get(M + 'val', default) if prop is not None else default

    def size_pt(rPr):
        size = rPr.find(W+'sz') if rPr is not None else None
        size_cs = rPr.find(W+'szCs') if rPr is not None else None
        value = size if size is not None else size_cs
        return f'{int(value.get(W+"val")) / 2:g}' if value is not None else None

    def math_run(el, script=None, force_upright=False, size_override=None):
        text = ''.join(c.text or '' for c in el if tag(c) == 't')
        mPr = child(el, 'rPr')
        wPr = el.find(W+'rPr')
        # OMML math style and embedded Word run style are separate; apply explicit
        # values first, then Word's default italic treatment for Latin identifiers.
        sty = child(mPr, 'sty')
        math_style = sty.get(M+'val') if sty is not None else None
        fonts = wPr.find(W+'rFonts') if wPr is not None else None
        font = ((fonts.get(W+'ascii') or fonts.get(W+'hAnsi') or fonts.get(W+'eastAsia'))
                if fonts is not None else None) or MATH_FONT_DEFAULT
        w_bold = enabled(wPr, 'b') if wPr is not None else False
        w_italic = enabled(wPr, 'i') if wPr is not None else False
        bold = math_style in ('b', 'bi') or w_bold
        italic_mode = (math_style in ('i', 'bi') if math_style in ('p', 'b', 'i', 'bi')
                       else True if w_italic else None)
        size = size_pt(wPr) or size_override
        pieces = []
        for ch in text:
            italic = (italic_mode if italic_mode is not None
                      else ch.isascii() and ch.isalpha() and not force_upright)
            effect = ('#B' if bold else '') + ('#I' if italic else '')
            marker = script or ''
            if ch.isascii():
                size_tag = fbd_point_size(size) if size else ''
                base_tag = fbd_point_size(base_size)
                open_font = f'〖WT{size_tag}《{font}{effect}》〗'
                close_font = f'〖WT{base_tag}#〗' if size else '〖WT#〗'
                open_digit_size = f'〖ST{size_tag}〗' if size and ch.isdigit() else ''
                close_digit_size = f'〖ST{base_tag}〗' if size and ch.isdigit() else ''
            elif ch in MATH_GBK_SYMBOLS:
                size_tag = fbd_point_size(size) if size else ''
                base_tag = fbd_point_size(base_size)
                open_font = f'〖HT{size_tag}《{font}》〗'
                close_font = f'〖HT{base_tag}#〗' if size else '〖HT#〗'
                open_digit_size = close_digit_size = ''
            elif size:
                size_tag = fbd_point_size(size)
                base_tag = fbd_point_size(base_size)
                open_font = f'〖HT{size_tag}SS〗'
                close_font = f'〖HT{base_tag}SS〗'
                open_digit_size = close_digit_size = ''
            else:
                open_font, close_font = '', ''
                open_digit_size = close_digit_size = ''
            pieces.append(f'{open_font}{open_digit_size}{marker}{ch}'
                          f'{close_digit_size}{close_font}')
        return ''.join(pieces)

    def render(el, script=None, force_upright=False, size_override=None):
        if el is None:
            return ''
        kind = tag(el)
        if kind == 't':
            return el.text or ''
        if kind == 'r':
            return math_run(el, script, force_upright, size_override)
        if kind in ('oMath', 'oMathPara', 'e', 'num', 'den', 'sup', 'sub', 'lim'):
            return ''.join(render(c, script, force_upright, size_override) for c in el
                           if not tag(c).endswith('Pr'))
        if kind == 'f':
            return '〖SX(〗' + render(child(el, 'num')) + '〖〗' + render(child(el, 'den')) + '〖SX)〗'
        if kind == 'rad':
            return '〖KF(〗' + render(child(el, 'e')) + '〖KF)〗'
        if kind in ('sSup', 'sSub', 'sSubSup'):
            base = render(child(el, 'e'))
            if kind in ('sSub', 'sSubSup'):
                base += render(child(el, 'sub'), chr(0xE1AD))
            if kind in ('sSup', 'sSubSup'):
                base += render(child(el, 'sup'), chr(0xE1AC))
            return base
        if kind == 'limLow':
            expr = child(el, 'e')
            limit = child(el, 'lim')
            group = next((item for item in expr.iter() if tag(item) == 'groupChr'), None) if expr is not None else None
            if group is not None:
                lower_pt = round(float(base_size) * 0.7 * 4) / 4
                lower_size = f'{lower_pt:g}'
                return ('〖SX(〗' + render(child(group, 'e'))
                        + '〖〗' + render(limit, size_override=lower_size) + '〖SX)〗')
            return render(expr) + render(limit, chr(0xE1AD))
        if kind == 'limUpp':
            return render(child(el, 'e')) + render(child(el, 'lim'), chr(0xE1AC))
        if kind == 'd':
            opening = value(child(el, 'dPr'), 'begChr', '(')
            closing = value(child(el, 'dPr'), 'endChr', ')')
            opening = {'[': '［', ']': '［', '{': '｛', '}': '｝', '|': '｜'}.get(opening, opening)
            closing = {'[': '］', ']': '］', '{': '｝', '}': '｝', '|': '｜'}.get(closing, closing)
            return opening + render(child(el, 'e')) + closing
        if kind == 'groupChr':
            return render(child(el, 'e'))
        if kind == 'm':
            rows = [render(row) for row in el if tag(row) == 'mr']
            return '〖JB({〗' + LINE.join(rows) + '〖JB)〗'
        if kind == 'mr':
            return '，'.join(render(c) for c in el if tag(c) == 'e')
        if kind in ('oMath', 'oMathPara'):
            return ''.join(render(c) for c in el)
        return ''.join(render(c) for c in el if not tag(c).endswith('Pr'))

    return render(node)


def source_content_text(path: Path) -> str:
    """提取 Word 可见文本，并补入 OMML 的成对定界符供内容核对。"""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read('word/document.xml'))

    def walk(el):
        if el.tag in (W+'t', M+'t'):
            return el.text or ''
        if el.tag == M+'d':
            props = el.find(M+'dPr')
            begin = props.find(M+'begChr') if props is not None else None
            end = props.find(M+'endChr') if props is not None else None
            left = begin.get(M+'val', '(') if begin is not None else '('
            right = end.get(M+'val', ')') if end is not None else ')'
            return left + ''.join(walk(c) for c in el if c.tag != M+'dPr') + right
        if el.tag == M+'rad':
            return ''.join(walk(c) for c in el if c.tag not in (M+'radPr', M+'deg'))
        if el.tag == M+'f':
            return walk(el.find(M+'num')) + walk(el.find(M+'den'))
        if el.tag in (M+'sSup', M+'sSub', M+'sSubSup'):
            names = ('e', 'sub', 'sup')
            return ''.join(walk(el.find(M+n)) for n in names if el.find(M+n) is not None)
        if el.tag == M+'limLow':
            return walk(el.find(M+'e')) + walk(el.find(M+'lim'))
        if el.tag == M+'groupChr':
            return walk(el.find(M+'e'))
        if el.tag == M+'m':
            return ''.join(walk(c) for c in el if c.tag == M+'mr')
        return ''.join(walk(c) for c in el)

    text = walk(root)
    for src, dst in CONTENT_SYMBOL_MAP.items():
        text = text.replace(src, dst)
    return text


def math_content_report(expected: str, lex, dec) -> dict:
    """比较 Word 文本与 FBD 可见文本；脚标控制符不计入正文文字。"""
    out, in_circle = [], False
    for token in lex.tokens:
        if token.kind == 'ctrl':
            in_circle = token.raw == 'A1' if token.raw in ('A1', 'A3') else in_circle
            continue
        if token.kind != 'text' or token.in_def:
            continue
        raw = token.raw
        if in_circle and re.fullmatch(r'B\d+', raw):
            raw = raw[1:]
        out.append(raw)
    exp = fbdgen.normalize_text(expected).translate(fbdgen.CANON)
    visible = fbdgen.normalize_text(''.join(out)).translate(fbdgen.CANON)
    start = visible.find(exp[:20])
    if start < 0:
        return {'passed': False, 'reason': '回读文本中找不到源文本起点'}
    visible = visible[start:]
    differences = {}
    for kind, i1, i2, j1, j2 in difflib.SequenceMatcher(
            None, exp, visible, autojunk=False).get_opcodes():
        if kind != 'equal':
            key = f'{exp[i1:i2]} → {visible[j1:j2]}'
            differences[key] = differences.get(key, 0) + 1
    return {
        'passed': exp == visible,
        'expectedChars': len(exp),
        'visibleChars': len(visible),
        'identicalAfterCanon': exp == visible,
        'residualForms': differences,
    }


def parse_para(el, mark_paras: bool = False) -> Para:
    p = Para(runs=parse_runs(el, mark_paras=mark_paras))
    pPr = el.find(W+'pPr')
    if pPr is not None:
        jc = pPr.find(W+'jc')
        if jc is not None:
            p.center = jc.get(W+'val') == 'center'
            p.right = jc.get(W+'val') == 'right'
        ind = pPr.find(W+'ind')
        p.indent = ind is not None and ind.get(W+'firstLineChars') not in (None, '0')
    return p


def parse_body(path):
    """返回顶层块序列：Para / ('table', rows, 是否得分表)。"""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read('word/document.xml'))
        rels = ET.fromstring(z.read('word/_rels/document.xml.rels'))
        try:
            settings = ET.fromstring(z.read('word/settings.xml'))
        except KeyError:
            settings = None
        media = {r.get('Id'): r.get('Target').split('/')[-1] for r in rels}
    global MATH_FONT_DEFAULT, WORD_TAB_WIDTH_MM
    WORD_TAB_WIDTH_MM = 12.7
    default_tab = settings.find(W+'defaultTabStop') if settings is not None else None
    if default_tab is not None and default_tab.get(W+'val'):
        try:
            WORD_TAB_WIDTH_MM = float(default_tab.get(W+'val')) * 25.4 / 1440
        except ValueError:
            pass
    math_pr = settings.find(M+'mathPr') if settings is not None else None
    math_font = math_pr.find(M+'mathFont') if math_pr is not None else None
    if math_font is not None and math_font.get(M+'val'):
        MATH_FONT_DEFAULT = math_font.get(M+'val')
    blocks = []
    for el in root.find(W+'body'):
        if el.tag == W+'p':
            blocks.append(parse_para(el))
        elif el.tag == W+'tbl':
            rows = [[parse_para(tc, mark_paras=True) for tc in tr.findall(W+'tc')]
                    for tr in el.findall(W+'tr')]
            head = rows[0][0].text.replace('　', '').strip() if rows and rows[0] else ''
            score = (head == '题号' and len(rows) > 1 and rows[1]
                     and rows[1][0].text.replace('　', '').strip() == '得分')
            grid = el.find(W+'tblGrid')
            widths = ([int(c.get(W+'w', '0')) * 25.4 / 1440
                       for c in grid.findall(W+'gridCol')]
                      if grid is not None else [])
            blocks.append(('table', rows, score, widths))

    from io import BytesIO
    from PIL import Image
    natural_sizes = {}
    with zipfile.ZipFile(path) as z:
        for rid, target in media.items():
            try:
                with Image.open(BytesIO(z.read('word/media/' + target))) as image:
                    dpi = image.info.get('dpi') or (96, 96)
                    dx, dy = (float(dpi[0] or 96), float(dpi[1] or 96))
                    if not (0 < dx < 10000 and 0 < dy < 10000):
                        dx = dy = 96
                    natural_sizes[rid] = (
                        image.width * 25.4 / dx,
                        image.height * 25.4 / dy,
                    )
            except Exception:
                continue

    for block in blocks:
        runs = (r for row in block[1] for cell in row for r in cell.runs) \
            if isinstance(block, tuple) else iter(block.runs)
        for run in runs:
            natural = natural_sizes.get(run.image)
            if run.image and natural and run.image_w and run.image_h:
                run.image_scale_x = run.image_w / natural[0] * 100
                run.image_scale_y = run.image_h / natural[1] * 100
    return blocks, media


# ---------- run → fbd 文本 ----------

def _answer_macro(text: str, underline: str | None, all_answer: bool,
                  prev_tail: str = '') -> str:
    """按「颜色 + 形态」选答案宏（见 04-答案与颜色体系.md 的选择原则）。"""
    if re.fullmatch(r'[A-D]{1,4}', text):
        return 'C' if MATH_ANSWER_SCHEME else 'A'
    if text and all(unicodedata.name(c, '').startswith('LATIN ') for c in text):
        return '3'                                  # 注音题：拼音答案
    if re.search(r'[A-Za-zÀ-ɏ]{2,}[（(]?$', prev_tail) and re.fullmatch(r'[一-鿿]{1,3}', text):
        return '3'                                  # 注音题：`固zhi(执)` 里括号内的汉字答案
    if all_answer:
        return 'E' if MATH_ANSWER_SCHEME else '1'
    if MATH_ANSWER_SCHEME:
        return 'A'
    return 'C' if underline else 'E'


def _wrap_answer(macro: str, text: str) -> str:
    if macro == 'A':
        return f'〖=A〗{text}〖=B〗'
    if macro == 'C' and not INLINE_C_ANSWER:
        return f'〖=C〗{text}〖=D〗'
    if macro == '3':
        return f'〖=3〗〖WTXT〗{text}〖WTBZ〗〖=4〗'
    if macro == 'E':
        return f'〖=E〗{text}〖=F〗'
    if macro == 'C':
        if INLINE_C_ANSWER:
            # 把宏体直接写进正文。**实测在书版里会出问题**：从第一个内联答案开始，
            # 后续所有文字被填充成平铺图案（徽文logo 底纹）并画两遍（0 Tr + 2 Tr），
            # PDF 里每个汉字出现两次。定稿用宏调用 `〖=C〗…〖=D〗` 就没这个现象。
            return (f'〖ZZ(Z〗〖HT5”H〗〖CS%100，0，0，0〗〓{text}〓'
                    '〖HT〗〖CS〗〖ZZ)〗')
        return f'〖=C〗{text}〖=D〗'          # 与定稿一致：交回书版自己展开
    if macro == '1':
        return f'〖=1〗{text}〖=2〗'
    return f'〖=A〗{text}〖=B〗'


def strip_leading(para: Para, n: int) -> Para:
    """从段首去掉 n 个字符（用于剥掉正文里重复的题号前缀）。"""
    runs, left = [], n
    for r in para.runs:
        if left <= 0:
            runs.append(r)
            continue
        if len(r.text) <= left:
            left -= len(r.text)
            if r.image:
                runs.append(r)
            continue
        runs.append(replace(r, text=r.text[left:]))
        left = 0
    return Para(runs=runs, center=para.center, right=para.right, indent=para.indent)


def _spans(runs):
    """把 run 合并成 span。

    关键：**连续的同色 run 必须合成一段**——答案/标签在源文档里被 Word 拆成多个 run
    （答案内部还混排黑体与书宋：黑体是答案正文、书宋是标点），逐个 run 包宏会切碎宏调用，
    标签甚至会被切成 `〖=SB(·〖=〗` 这种非法形态。
    """
    spans = []
    for r in runs:
        if r.br:
            continue
        if r.tab:
            spans.append(['tab', [r], None])
            continue
        if r.para_break:
            spans.append(['break', [r], None])
            continue
        if r.image:
            spans.append(['img', [r], None])
            continue
        if not r.text:
            continue
        kind = 'answer' if r.is_answer else 'label' if r.is_label else 'text'
        key = None if kind != 'text' else (
            r.font, r.ascii_font, r.size, r.underline, r.em, r.bold, r.italic, r.vert_align)
        if spans and spans[-1][0] == kind and (kind != 'text' or spans[-1][2] == key):
            spans[-1][1].append(r)
        else:
            spans.append([kind, [r], key])
    return spans


def base_style(para: Para) -> str:
    """段落主导字体/字号 → 段首一次性的 〖HT…〗。

    **不做段内字体切换**：源文档里大量单字 楷体 run（如「(10分)」的「分」、书名号内）
    是 Word 的字体替换噪声，定稿一律不切（见 06-docx转fbd映射规则.md）。
    """
    size = SIZE_PT.get(para.dom_size, '12')
    font = FONT_CODE.get(para.dom_font, 'SS')
    # 分数字号已经包含字号内部的小数点，不能再用整磅格式追加第二个点。
    spec = f'{size}{font}' if re.fullmatch(r'\d+\.(?:25|50|75)', size) else f'{size}.{font}'
    return f'〖HT{spec}〗'


def render_runs(para: Para, media: dict, img_names: dict) -> str:
    """一个段落 → 一行 fbd 文本（不含行尾控制符，不含段首字体切换）。"""
    out, zz_open = [], False

    def close_zz():
        nonlocal zz_open
        if zz_open:
            out.append('〖ZZ)〗')
            zz_open = False

    spans = _spans(para.runs)
    for si, (kind, group, _) in enumerate(spans):
        if kind == 'break':                      # 单元格内的段落分界 → 换行符
            close_zz()
            out.append(LINE)
            continue
        if kind == 'tab':
            close_zz()
            out.append(f'〖KG{WORD_TAB_WIDTH_MM:g}mm〗')
            continue
        if kind == 'img':
            close_zz()
            # 紧邻「新考法」标签的图标 = 小书标，`=SB` 宏内已含 〖XC小书标.EPS;P〗，
            # 再输出一次会重复；直接跳过，由宏提供。
            neigh = [s[0] for s in spans[max(0, si - 1):si + 2] if s is not spans[si]]
            if 'label' in neigh:
                continue
            run = group[0]
            rid = run.image
            scale = (run.image_scale_x, run.image_scale_y)
            if not all(scale) or (abs(scale[0] - 100) < .5 and abs(scale[1] - 100) < .5):
                scale = None
            size = f';%{scale[0]:.2f}%{scale[1]:.2f}' if scale else ''
            out.append(f'〖XC{img_names.get(rid, media.get(rid, "?"))}{size}，JZ〗')
            continue

        if kind == 'answer':
            close_zz()
            text = ''.join(r.text for r in group).strip('　\xa0 ')
            if not text:
                continue
            underline = next((r.underline for r in group if r.underline), None)
            if text in ('/', '／') and underline is None:
                # 断句题中的斜杠是分隔符。Word 把它染成答案色，但它不是待填答案，
                # 不应展开成 =E/=F 答案宏（书版会把该符号当作答案内容处理）。
                out.append(text)
                continue
            prev_tail = ''.join(r.text for r in spans[si - 1][1]) if si else ''
            out.append(_wrap_answer(
                _answer_macro(text, underline, para.all_answer, prev_tail), text))
            continue

        if kind == 'label':
            close_zz()
            text = ''.join(r.text for r in group).strip()
            if not text:
                continue
            if any(r.font == WEIBEI_FONT for r in group):
                # 题源标注：定稿写 〖HTW〗（2025·合肥45中一中改编）〖HT〗——魏碑、全角括号、无颜色
                out.append('〖HTW〗' + text.replace('(', '（').replace(')', '）') + '〖HT〗')
            else:
                if MATH_ANSWER_SCHEME:
                    out.append(f'〖=1（〗{text}〖=〗')
                else:
                    out.append(f'〖=SB(〗{text}〖=〗')
            continue

        run = group[0]
        text = ''.join(r.text for r in group).replace('　', '〓').replace('\xa0', '')
        if not text:
            continue
        if run.vert_align in ('superscript', 'subscript'):
            marker = chr(0xE1AC if run.vert_align == 'superscript' else 0xE1AD)
            text = ''.join(marker + ch for ch in text)
            script_font = run.ascii_font or run.font
            if script_font:
                size = f'{int(run.size) / 2:g}' if run.size else ''
                effect = ('#B' if run.bold else '') + ('#I' if run.italic else '')
                size_tag = fbd_point_size(size) if size else ''
                base_tag = fbd_point_size(SIZE_PT.get(para.dom_size, '12'))
                out.append(f'〖WT{size_tag}《{script_font}{effect}》〗{text}')
                out.append(f'〖WT{base_tag}#〗')
                continue
            out.append(text)
            continue
        if run.bold or run.italic:
            if run.ascii_font:
                effect = ('#B' if run.bold else '') + ('#I' if run.italic else '')
                size = f'{int(run.size) / 2:g}' if run.size else ''
                size_tag = fbd_point_size(size) if size else ''
                base_tag = fbd_point_size(SIZE_PT.get(para.dom_size, '12'))
                out.append(f'〖WT{size_tag}《{run.ascii_font}{effect}》〗{text}')
                out.append(f'〖WT{base_tag}#〗')
                continue
        if run.em:
            # 着重号逐字加（〖ZZ(〗字〖ZZ)〗），不与其他 ZZ 形态嵌套
            close_zz()
            out.append(''.join(f'〖ZZ(〗{c}〖ZZ)〗' for c in text))
            continue
        if run.underline in ('single', 'wave'):
            if not zz_open:
                out.append('〖ZZ(Q〗' if run.underline == 'wave' else '〖ZZ(Z〗')
                zz_open = True
            out.append(text)
        else:
            close_zz()
            out.append(text)
    close_zz()
    return ''.join(out)


# ---------- 段落分类 ----------

RE_MAJOR = re.compile(r'^(\d+)[.．]')
RE_MINOR = re.compile(r'^[(（](\d+)[)）]')
RE_OPTION = re.compile(r'^[ABCD][.．]')
RE_SECTION = re.compile(r'^[一二三四五]、')
RE_SOURCE = re.compile(r'^[\[（(]\s*选自')
RE_RANGE = re.compile(r'^[\[【]\s*考查')


def fix_delims(para: Para) -> Para:
    """半角方括号 `[` `]` 是书版**注解定界符**，正文里出现就报 pass1「注解位置错」。

    按上下文分流（三者都不能把半角方括号留在正文里）：
      · 考查范围行 `[考查范围:第一、三单元]` → `【考查范围：第一、三单元】`（照定稿）
      · 出处行 `[选自《人民日报》(海外版),有删改]` → `（选自《人民日报》(海外版),有删改）`（照定稿的 〖JY〗 形态）
      · 其余 → `［…］`（兜底，如书名引用）
    逐 run 改写以保留字体属性；末端的 `DELIM_MAP` 兜底清理漏网的半角方括号。
    """
    text = ''.join(r.text for r in para.runs)
    bare = re.sub(r'^[\s〓　]+', '', text)
    if RE_SOURCE.match(bare):
        # 定稿形态：〖JY〗〖HTF〗（选自《青年文摘》，有删改）〖HT〗 —— 全角括号。
        # 源里出处行有的写 `[选自…]`、有的直接写 `(选自…)`，两种都归一成全角。
        table = str.maketrans({'[': '（', ']': '）', '(': '（', ')': '）'})
    elif '[' in text or ']' in text:
        if RE_RANGE.match(bare):
            table = str.maketrans({'[': '【', ']': '】', ':': '：'})
        else:
            table = str.maketrans({'[': '［', ']': '］'})
    else:
        return para
    return Para(runs=[replace(r, text=r.text.translate(table)) for r in para.runs],
                center=para.center, right=para.right, indent=para.indent)


def classify(para: Para, is_new_vol: bool, ctx: dict) -> list:
    """段落 → fbd 行列表（大题号由 build() 处理，这里不含）。"""
    bare = re.sub(r'^[\s〓　]+', '', para.text)
    body = render_runs(para, ctx['media'], ctx['imgs'])

    if para.center:
        if bare.startswith('【考查'):
            return [f'〖JZ〗〖HT4”K〗{para.text.strip()}〖HT〗']
        if bare.startswith('(时间') or bare.startswith('（时间'):
            return [f'〖JZ〗〖HTF〗{para.text.strip()}〖HT〗']
        return [f'〖JZ〗{base_style(para)}{body}〖HT〗']
    if para.right or RE_SOURCE.match(bare):
        return [f'〖JY(〗{base_style(para)}{body}〖HT〗〖JY)〗']
    if RE_SECTION.match(bare) and para.dom_font == '方正黑体_GBK':
        return [f'〖HTH〗{body}〖HTSS〗']
    return [('〓〓' if para.indent else '') + base_style(para) + body + '〖HT〗']


# ---------- 表格 ----------

def render_table(rows, is_score: bool, media: dict, img_names: dict, col_w: float,
                 col_widths: list[float] | None = None) -> list:
    if is_score and len(rows) == 2:
        # 得分表：照系列定稿的固定形态
        head = [c.text.replace('　', '').strip() for c in rows[0]]
        score = [c.text.replace('　', '').strip() for c in rows[1]]
        lines = [SCORE_HEADER]
        for i, cell in enumerate(head[:-1]):
            lines.append(f'{cell}〖〗')
        lines.append(f'{head[-1]}{SCORE_DIVIDER}')
        # 得分行照定稿的压缩形态：只写「得分」与一个空格位，余下由表列自动补齐
        lines += [f'{score[0]}〖〗', '〖〗', '〖BG)F〗〖HT〗']
        return lines
    # 内容表格：照定稿「通报/倡议书类」表格的写法。
    #
    # ⚠️ 两个坑（都踩过）：
    #  1. **不要用 `G<数字>` 固定行高**。`G8mm` = 本行固定 8mm 高，只够排一行，
    #     书版没有"第二行"的余地 ⇒ **单元格里的长文字不换行、横向撑开、铺满版面**。
    #     定稿在内容型表格里一律用 `TK+1.0mmJK+1.0mm`（行高按内容自动，只加 1mm 行距）。
    #  2. **单列时栏宽不要写死**。定稿写 `KZQ`——`K` 不带宽度即取表格可用宽度，`ZQ` 左齐。
    #     写死 mm（尤其带小数如 `117.0mm`）既偏离定稿写法，也容易算错可用宽度。
    ncol = max(len(r) for r in rows)
    if col_widths and len(col_widths) == ncol and all(w > 0 for w in col_widths):
        widths = [int(round(w)) for w in col_widths]
    elif ncol == 1:
        widths = None
        spec = ',FKZQF'                       # 栏宽自动 + 左齐
    else:
        kw = int(col_w // ncol)               # 整数 mm，末列补足
        widths = [kw] * (ncol - 1) + [int(col_w) - kw * (ncol - 1)]
    if widths is not None:
        # ⚠️ `mm` 后缀**不能省**：書版 `<栏宽>: K[<字距>]`，`K39` 是 39 **字距**（≈164mm），
        # `K39mm` 才是 39 毫米。定稿即写作 `K117mmZQ`（答题卡）、`K50mm`（小册子卷头表）。
        spec = ',F' + ','.join(f'K{w}mmZQ' for w in widths) + 'F'
    lines = [f'〖HT5〗〖BG(!〗']
    for row in rows:
        lines.append(f'〖BHDFTK+1.0mmJK+1.0mm{spec}〗')
        lines.append('〖〗'.join(render_runs(c, media, img_names) for c in row))
    lines += ['〖BG)F〗〖HT〗']
    return lines


# ---------- 组装 ----------

def head_bytes(reference: Path) -> tuple:
    """定稿书眉头：文件头到第一个 〖FL(3K8mm〗 之前，**剔除帖线块**（见 STRIP_BLOCK）。

    保留：〖BP(〗 版面声明、14 个宏定义、书眉（DMX/SMX）、整页背景（徽文logo）。
    剔除：左帖线（装订线）——原因见 STRIP_BLOCK 注释。
    """
    raw = reference.read_bytes()
    dec = decode(raw)
    lines = dec.text.split('\n')
    starts, i = [], 0
    for ln in lines:
        starts.append(i)
        i += len(ln) + 1
    drop = str.maketrans('', '', ''.join(dec.marks))
    norm = [ln.translate(drop).strip() for ln in lines]

    open_idx = next((k for k, s in enumerate(norm) if s == COL_OPEN), None)
    if open_idx is None:
        raise SystemExit(f'定稿里找不到开栏行 {COL_OPEN}')

    open_char = starts[open_idx]
    source_strip = '〖BW(B(Z1mm，，)〗'
    strip_start = dec.text.rfind(source_strip, 0, open_char)
    if strip_start >= 0:
        strip_end_token = '〖BW)〗'
        strip_end = dec.text.find(strip_end_token, strip_start, open_char)
        if strip_end < 0:
            raise SystemExit('帖线块起始存在但找不到闭合标记，不能安全抽取版头')
        strip_end += len(strip_end_token)
        before_strip = dec.offsets[strip_start]
        after_strip = dec.offsets[strip_end] if strip_end < len(dec.offsets) else len(raw)
    else:
        n = len(STRIP_BLOCK)
        hits = [k for k in range(0, max(0, open_idx - n + 2))
                if norm[k:k + n] == STRIP_BLOCK]
        if len(hits) != 1:
            raise SystemExit('定稿里找不到唯一已知帖线块，不能安全抽取版头')
        before_strip = dec.offsets[starts[hits[0]]]
        after_line = starts[hits[0] + n] if hits[0] + n < len(starts) else len(dec.offsets)
        after_strip = dec.offsets[after_line] if after_line < len(dec.offsets) else len(raw)
    head = (raw[:before_strip]
            + raw[after_strip:dec.offsets[open_char]])
    return head, dec, lines


def head_ranges_bytes(reference: Path, ranges) -> bytes:
    """按**行区间**从定稿取字节并拼接（区间可以不相邻）。

    小册子定稿的版式基底分两段：`[BP 声明 + ZDSB/ZDCC 宏]` 与 `[ZDA…ZDWB 宏]`，
    中间夹着七上专属的 `〖ML(〗` 目录块与「名著概览」装饰板块，不取。
    """
    raw = reference.read_bytes()
    dec = decode(raw)
    lines = dec.text.split('\n')
    starts, i = [], 0
    for ln in lines:
        starts.append(i)
        i += len(ln) + 1

    def off(n: int) -> int:                      # 行号（1 起）→ 该行首字节偏移
        return dec.offsets[starts[n - 1]] if n - 1 < len(starts) else len(raw)

    return b''.join(raw[off(a):off(b)] for a, b in ranges)


def is_section_head(rows) -> bool:
    """夹册的板块头表格：两行，第二行是「建议用时…分值…得分」。"""
    return (len(rows) == 2 and len(rows[0]) >= 1
            and '建议用时' in ''.join(c.text for c in rows[1]))


def booklet_table(rows, media: dict, img_names: dict) -> list:
    """板块头表格：`〖BG（!SDXD;N〗` 带底纹，列宽 = 150mm ÷ 列数（取整到 5mm，末列补足）。"""
    head = [c.text.replace('　', '').strip() for c in rows[0]]
    n = max(1, len(head))
    w = max(5, round(BOOKLET_TABLE_W / n / 5) * 5)
    widths = [w] * (n - 1) + [BOOKLET_TABLE_W - w * (n - 1)]
    spec = ','.join(f'K{int(x)}mm' for x in widths)
    tail = ''.join(c.text for c in rows[1]) if len(rows) > 1 else ''
    lines = [f'〖HT5SS〗〖BG（!SDXD;N〗〖BHDF,F{spec}F〗']
    lines += [f'{c}〖〗' for c in head[:-1]] + [head[-1]]
    lines += ['〖BHD,FK150mmF〗',
              f'{tail.replace(":", "：")}〖BG）F〗〖HT〗']
    return lines


def build(source: Path, reference: Path, title_prefix: str, img_names: dict,
          mode: str = 'text', head_override: bytes | None = None) -> tuple:
    """组装 fbd。

    mode='text'    —— 系列正文（3 栏 A3 试卷版式），基底取正文定稿书眉头；
    mode='booklet' —— 夹册（小册子版式），基底取小册子定稿的 BP + 宏定义区间，
                      板块标题走 `〖ML〗〖HT2”《方正艺黑简体》〗`，板块头表格走 SDXD 底纹表。
    """
    booklet = (mode == 'booklet')
    blocks, media = parse_body(source)
    head = head_override if head_override is not None else (
        head_ranges_bytes(reference, BOOKLET_HEAD_RANGES) if booklet
        else head_bytes(reference)[0]
    )
    has_volume_title = any(
        not isinstance(block, tuple) and block.center and block.max_size in TITLE_SIZES
        for block in blocks
    )
    ctx = {'media': media, 'imgs': img_names, 'in_zk': False}

    out_lines, vol_count, stats = [], 0, {'paras': 0, 'tables': 0, 'images': 0, 'answers': 0}
    if not has_volume_title:
        if booklet:
            out_lines.extend([BOOKLET_FL_OPEN + '〖HJ1.5mm〗', ''])
            ctx['fl_open'] = True
        else:
            out_lines.append(COL_OPEN)
    score_done = True          # 本卷的得分表是否已处理（用于插 〖HT11.5〗/〖HJ0.9mm〗）

    def close_zk():
        """收大题块：块的末行改用换段符（定稿里一个 〖STHZ〗 大题 = 一个段）。"""
        if ctx['in_zk'] and out_lines:
            out_lines[-1] = out_lines[-1][:-len(LINE)] + PARA if out_lines[-1].endswith(LINE) else out_lines[-1]
            out_lines[-1] += '〖ZK)〗'
            ctx['in_zk'] = False

    def emit(line: str, tail: str = LINE):
        out_lines.append(line + tail)

    for blk in blocks:
        if isinstance(blk, tuple):
            _, rows, is_score, source_widths = blk
            stats['images'] += sum(1 for row in rows for cell in row
                                   for run in cell.runs if run.image)
            close_zk()
            if booklet and is_section_head(rows):
                out_lines += booklet_table(rows, media, img_names)
                out_lines += ['〖HJ2.8mm〗', BOOKLET_FL_OPEN]   # 照定稿：表后开双栏
                ctx['fl_open'] = True
                if out_lines and out_lines[-1]:
                    out_lines[-1] += PARA
                stats['tables'] += 1
                continue
            if is_score and not score_done:
                emit('〖HT11.5〗', '')
                out_lines += render_table(rows, is_score, media, img_names, 117.0,
                                          source_widths if booklet else None)
                emit('〖HJ0.9mm〗', '')
                score_done = True
            else:
                out_lines += render_table(rows, is_score, media, img_names, 117.0,
                                          source_widths if booklet else None)
                if out_lines and out_lines[-1]:
                    out_lines[-1] += PARA
            stats['tables'] += 1
            continue

        para = fix_delims(blk)          # 半角方括号是书版定界符，先按上下文转掉
        if not vol_count and not para.text and not any(r.image or r.br for r in para.runs):
            continue
        stats['paras'] += 1
        stats['answers'] += sum(1 for r in para.runs if r.is_answer)
        stats['images'] += sum(1 for r in para.runs if r.image)

        # 居中/居右段落会插入 JZ/JY 结构。不要把它们嵌进前一个题干的 ZK 块。
        if (para.center or para.right) and ctx['in_zk']:
            close_zk()

        if para.center and para.max_size in TITLE_SIZES:
            close_zk()
            if booklet:
                # 夹册板块标题：照小册子定稿 〖ML〗〖HT2”《方正艺黑简体》〗滚动训练（一）
                if ctx.get('fl_open'):
                    emit(BOOKLET_FL_CLOSE, '')      # 上一板块收栏
                    ctx['fl_open'] = False
                vol_count += 1
                title = para.text.strip().replace('(', '（').replace(')', '）')
                title_image = (f'〖XC{BOOKLET_TITLE_IMAGE},JZ;P〗 〖〗'
                               if BOOKLET_TITLE_IMAGE else '')
                emit(f'{BOOKLET_TITLE_PREFIX}{title_image}〖HT2”{BOOKLET_TITLE_FONT}〗'
                     f'{title}{BOOKLET_TITLE_SUFFIX}')
                out_lines[-1] += LINE
                out_lines.append('')
                emit(BOOKLET_FL_OPEN + '〖HJ1.5mm〗', '')
                ctx['fl_open'] = True
                continue
            if vol_count:
                out_lines += VOL_TAIL + [VOL_CLOSE, '']
            vol_count += 1
            score_done = False
            emit(COL_OPEN, '')
            name = para.text.strip().split(chr(0x3000))[-1]
            # 卷标题字号随册走：七上/九全 17pt，八上 18pt —— 不要写死 HT17.H
            emit(f'〖JZ〗〖HT{SIZE_PT.get(para.max_size, "17")}.H〗{title_prefix}〓{name}〖HT〗')
            continue

        if booklet and para.max_size == '28' and para.dom_font == '方正黑体_GBK':
            close_zk()
            body = render_runs(para, media, img_names)
            emit(f'〖HT14.H〗〖ML〗{body}〖HT〗')
            continue

        bare = re.sub(r'^[\s〓　]+', '', para.text)
        m = RE_MAJOR.match(bare)
        if m and para.dom_font == '方正书宋_GBK':
            close_zk()
            # 题号已由 〖STHZ〗N.〖STBZ〗 给出，正文里要把同样的 `N.` 前缀去掉，否则重复
            body = render_runs(strip_leading(para, len(m.group(0))), media, img_names)
            emit(f'〖STHZ〗{m.group(1)}.〖STBZ〗〖ZK(〗{base_style(para)}{body}〖HT〗')
            ctx['in_zk'] = True
            continue
        out_lines += classify(para, False, ctx)
        if out_lines and out_lines[-1] and not out_lines[-1].endswith((LINE, PARA)):
            out_lines[-1] += LINE

    close_zk()
    if booklet and ctx.get('fl_open'):
        emit(BOOKLET_FL_CLOSE, '')              # 末板块收栏
    out_lines += ([''] if booklet else VOL_TAIL + [''])
    text = '\r\n'.join(out_lines)
    # 收尾清洗：全角空格→空位符〓、NBSP 丢弃（源文档两者都用来占位/对齐）
    text = text.replace('　', '〓').replace('\xa0', '')
    for src, dst in SYMBOL_MAP.items():
        text = text.replace(src, dst)
    for src, dst in DELIM_MAP.items():          # 半角方括号是书版注解定界符，必须转全角
        text = text.replace(src, dst)
    bad = sorted({c for c in text if not _encodable(c)})
    conversion_errors = []
    replacement = '□' if _encodable('□') else '?'
    if bad:
        head_dec = decode(head)
        head_lines = sum(head_dec.stats[key] for key in ('crlf', 'lone_lf', 'lone_cr'))
        locations = {char: [] for char in bad}
        occurrences = dict.fromkeys(bad, 0)
        for line_number, line in enumerate(text.splitlines(), head_lines + 1):
            for char in bad:
                start = 0
                while (index := line.find(char, start)) >= 0:
                    occurrences[char] += 1
                    if len(locations[char]) < 5:
                        excerpt = line[max(0, index - 14):index + 15].strip()
                        locations[char].append({"segment": line_number, "context": excerpt})
                    start = index + 1
        for char in bad:
            conversion_errors.append({
                "character": char,
                "codepoint": f"U+{ord(char):04X}",
                "replacement": replacement,
                "occurrences": occurrences[char],
                "locations": locations[char],
            })
        bad_set = set(bad)
        text = ''.join(replacement if char in bad_set else char for char in text)
    data = head + fbdgen.encode(text) + fbdgen.encode(BOOKLET_TAIL if booklet else FILE_TAIL)
    return data, stats, media, vol_count, conversion_errors


def _encodable(ch: str) -> bool:
    """能否按 GBK 编码（PUA 控制符载体另行处理，不算内容字符）。"""
    if 0xE100 <= ord(ch) <= 0xE1FF:
        return True
    try:
        ch.encode('gbk')
        return True
    except UnicodeEncodeError:
        return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='核心素养（大联考）系列 docx → fbd')
    ap.add_argument('--source', required=True)
    ap.add_argument('--reference', required=True, help='同系列定稿 .fbd（取书眉头）')
    ap.add_argument('--template-head', help='已提取的模板版头字节文件')
    ap.add_argument('--pro', help='定稿 .PRO，逐字节复制到输出目录')
    ap.add_argument('--out', required=True)
    ap.add_argument('--name', help='输出基名（默认取 --source 的 stem）')
    ap.add_argument('--title-prefix', default='', help='卷名前缀，如 九年级语文(上)')
    ap.add_argument('--image-prefix', default='26语文正文',
                    help='提取图片的命名前缀（系列惯例，如 26八上语文正文 / 26语文夹册）')
    ap.add_argument('--macro-answers', action='store_true',
                    help='答案宏 =C/=D 改回宏调用（与系列定稿一致），不内联展开')
    ap.add_argument('--math-answer-scheme', action='store_true',
                    help='使用数学定稿宏：选择题 C/D，解析 E/F，素养标签 =1')
    ap.add_argument('--booklet', action='store_true',
                    help='夹册（小册子版式）：基底取小册子定稿、板块标题走 ML+艺黑、'
                         '板块头表格走 SDXD 底纹表、答案色改用紫色')
    ap.add_argument('--column-open', help='正文开栏注解，默认沿用语文系列模板')
    ap.add_argument('--booklet-head-lines', help='夹册版头行区间，如 1-21 表示取第 1 至 20 行')
    ap.add_argument('--booklet-title-font', help='夹册标题字体代码，默认沿用语文系列模板')
    ap.add_argument('--booklet-title-image', help='夹册标题前的模板 EPS 文件名')
    ap.add_argument('--booklet-title-prefix', help='夹册标题前的数学/系列版式结构注解')
    ap.add_argument('--booklet-title-suffix', help='夹册标题后的数学/系列版式结构注解')
    ap.add_argument('--booklet-answer-color', help='夹册答案颜色 RGB，默认沿用语文系列模板')
    ap.add_argument('--score-header', help='得分表首行注解，默认沿用语文系列模板')
    ap.add_argument('--score-divider', help='得分表末列后的分行注解')
    a = ap.parse_args(argv)

    # 夹册的答案色是**紫色**（与正文的浅蓝相反），此时紫色不能再当题源标注用——
    # 题源改按魏碑字体识别（见 Run.is_label）。
    if a.macro_answers:
        globals()['INLINE_C_ANSWER'] = False
    if a.math_answer_scheme:
        globals()['MATH_ANSWER_SCHEME'] = True
    if a.column_open:
        globals()['COL_OPEN'] = a.column_open
    if a.booklet_head_lines:
        start, end = (int(v) for v in a.booklet_head_lines.split('-', 1))
        globals()['BOOKLET_HEAD_RANGES'] = [(start, end)]
    if a.booklet_title_font:
        globals()['BOOKLET_TITLE_FONT'] = a.booklet_title_font
    if a.booklet_title_image:
        globals()['BOOKLET_TITLE_IMAGE'] = a.booklet_title_image
    if a.booklet_title_prefix:
        globals()['BOOKLET_TITLE_PREFIX'] = a.booklet_title_prefix
    if a.booklet_title_suffix:
        globals()['BOOKLET_TITLE_SUFFIX'] = a.booklet_title_suffix
    if a.score_header:
        globals()['SCORE_HEADER'] = a.score_header
    if a.score_divider:
        globals()['SCORE_DIVIDER'] = a.score_divider
    if a.booklet:
        globals()['ANSWER_COLOR'] = a.booklet_answer_color or BOOKLET_COLOR
        globals()['LABEL_COLOR'] = None

    source, reference = Path(a.source), Path(a.reference)
    name = a.name or source.stem
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 图片素材：按**正文里首次引用顺序**命名（系列惯例 26九全语文正文N.TIF），
    # 紧邻「新考法」标签的小书标图标不单列（由 =SB 宏提供）。
    blocks, media = parse_body(source)
    # 所有图都提取命名——紧邻「新考法」标签的那张（小书标图标）在渲染时跳过、
    # 由 =SB 宏提供，但**文件仍要复制**：同一张图在别处可能不紧邻标签，会被正常引用。
    order = []
    for blk in blocks:
        if isinstance(blk, tuple):
            runs = (r for row in blk[1] for cell in row for r in cell.runs)
        else:
            runs = iter(blk.runs)
        for r in runs:
            if r.image and r.image not in order:
                order.append(r.image)

    # 正文图与书眉头 EPS 一律放 **fbd 同目录**：书版查找图片的顺序是
    # 「注解内指定路径 → 发排设置的缺省图片路径 → 小样所在目录」（注解手册/图片.md），
    # 放子目录里书版找不到。
    stale = out_dir / '素材'
    if stale.exists():                   # 清掉上一轮遗留的子目录形态
        shutil.rmtree(stale)
    img_names = {}
    with zipfile.ZipFile(source) as z:
        for i, rid in enumerate(order, 1):
            src = 'word/media/' + media[rid]
            from PIL import Image
            from io import BytesIO
            new = f'{a.image_prefix}{i}.TIF'
            with Image.open(BytesIO(z.read(src))) as im:
                dpi = im.info.get('dpi') or (96, 96)
                dpi_x, dpi_y = float(dpi[0] or 96), float(dpi[1] or 96)
                if not (0 < dpi_x < 10000 and 0 < dpi_y < 10000):
                    dpi_x = dpi_y = 96
                im.convert('RGB').save(
                    out_dir / new, format='TIFF', compression='tiff_lzw',
                    dpi=(dpi_x, dpi_y))
            img_names[rid] = new

    # 书眉头引用系列共用 EPS。将其放到 FBD 同目录，书版软件无需依赖预览根目录搜索。
    # （ZBW新/YBW新 是帖线图，帖线块已整块去掉，不再复制。）
    asset_root = reference.parent
    stems = ('小书标', 'DMX', 'SMX', '徽文logo') if not a.booklet else ('小书标',)
    if a.booklet_title_image:
        stems += (Path(a.booklet_title_image).stem,)
    for stem in stems:
        matches = [p for p in asset_root.iterdir()
                   if p.is_file() and p.suffix.lower() == '.eps' and p.stem.casefold() == stem.casefold()]
        if matches:
            shutil.copy2(matches[0], out_dir / matches[0].name)

    head_override = Path(a.template_head).read_bytes() if a.template_head else None
    data, stats, _, vols, conversion_errors = build(
        source, reference, a.title_prefix, img_names,
        mode='booklet' if a.booklet else 'text', head_override=head_override,
    )
    fbd_path = out_dir / f'{name}.fbd'
    fbd_path.write_bytes(data)

    info = fbdgen.validate(fbd_path)
    result = {
        'source': str(source), 'reference': str(reference), 'fbd': str(fbd_path),
        'bytes': len(data), 'volumes': vols, **stats,
        'ctrl': info['ctrl'], 'annotTotal': info['annot_total'],
        'geometry': info['geometry'], 'warnings': info['warnings'],
        'images': img_names, 'conversionErrors': conversion_errors,
    }
    unknown_hex = {item['hex'] for item in info['unknown_bytes']}
    result['warningNotes'] = [
        note for code, note in (
            ('aaab', 'aaab 来自数学参照宏定义；当前字节字典仍未释义，不应当作公式脚标。'),
        ) if code in unknown_hex
    ]
    if conversion_errors:
        total_replacements = sum(error['occurrences'] for error in conversion_errors)
        result['warnings'].append(
            f"有 {len(conversion_errors)} 种字符无法按 GBK 编码，共 {total_replacements} 处已用占位符替换；"
            "请查看转换问题说明.txt并修正后再发排。"
        )
    if a.pro:
        result['pro'] = str(fbdgen.copy_pro(a.pro, out_dir, f'{name}.PRO'))

    expected = source_content_text(source)
    result['sourceCharacters'] = len(re.sub(r'\s', '', expected))
    result['contentCheck'] = math_content_report(expected, info['_lex'], info['_dec'])
    result['contentVerified'] = result['contentCheck']['passed']

    (out_dir / '转换核对.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'已写出 {fbd_path}（{len(data)} 字节，{vols} 套卷）')
    print(f"段落 {stats['paras']} / 表格 {stats['tables']} / 图 {stats['images']} / 答案 run {stats['answers']}")
    print(f"控制符：{info['ctrl']}")
    print('告警：' + ('无' if not info['warnings'] else '；'.join(info['warnings'])))
    print('内容一致性：' + ('通过' if result['contentVerified'] else '**未通过**（见 转换核对.json）'))
    return 0 if (not info['warnings'] and result['contentVerified']) else 2


if __name__ == '__main__':
    sys.exit(main())

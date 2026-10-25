#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FBD 排版公共库：编码 → 写出 → 校验 → 预览 四件套。

排版任务脚本（如 docx_to_unit_fbd.py，或按 skills/fbd-typeset 写的一次性脚本）
import 这些件，不要手写 GBK 字节、不要手拼 AA 控制符。

纪律（docs/agent/FBD排版经验总结.md 一/二节）：
  · 不要手打注解——以同系列已定稿 fbd 为版式模板，脚本只把数据填进模板行；
  · fbd 只能字节级读写（本库 encode/write_fbd），普通文本编辑器另存会毁控制符；
  · 生成后必须 validate()，告警逐条解释后再交付。
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

# 书版 AA 控制符的 PUA 载体：拼进字符串，encode() 落盘时转回真实字节
LINE = chr(0xE1A4)   # AA A4 段内换行
PARA = chr(0xE1A5)   # AA A5 换段
END = chr(0xE1A6)    # AA A6 文件结束符（fbd 恒 2 个，write_fbd 统一补足）


def encode(text: str) -> bytes:
    """PUA 控制字符（U+E100–E1FF）→ `AA xx` 字节，其余按 GBK strict 编码。"""
    chunks = []
    for part in re.split('([' + chr(0xE100) + '-' + chr(0xE1FF) + '])', text):
        if len(part) == 1 and 0xE100 <= ord(part) <= 0xE1FF:
            chunks.append(bytes([0xAA, ord(part) - 0xE100]))
        else:
            chunks.append(part.encode('gbk', errors='strict'))
    return b''.join(chunks)


def write_fbd(blocks, out) -> bytes:
    """按语料规范写出 fbd：GBK + CRLF、无 BOM，文件尾 `…CRLF CRLF A6A6 CRLF CRLF`。

    blocks 是字符串列表（每项一行/一块），**不要**自带 END——本函数统一补足两个 A6。
    """
    text = '\r\n'.join(str(b) for b in blocks) + '\r\n\r\n' + END + END + '\r\n\r\n'
    data = encode(text)
    Path(out).write_bytes(data)
    return data


def validate(path, pro=None) -> dict:
    """跑 fbdview 管线（解码→词法→统计→几何），返回汇总 dict（含 `_` 前缀的原始对象）。"""
    from fbdview.bytes_io import read
    from fbdview.lexer import tokenize
    from fbdview.layout import analyze_geometry
    from fbdview import report as report_mod
    path = str(path)
    dec = read(path)
    lex = tokenize(dec)
    rep = report_mod.analyze(path, dec, lex)
    geo = analyze_geometry(path, dec, pro)
    return {
        'path': path,
        'size': rep['size'], 'lines': rep['lines'], 'chars': rep['chars'],
        'ctrl': rep['ctrl'], 'annot_total': rep['annot_total'],
        'name_counts': rep['name_counts'], 'pairs': rep['pairs'],
        'unknown_bytes': rep['unknown_bytes'],
        'warnings': list(rep['warnings']),
        'geometry': {'page': [geo.page_w, geo.page_h], 'columns': geo.columns,
                     'column_w': geo.column_w, 'column_gap': geo.column_gap},
        '_dec': dec, '_lex': lex, '_geo': geo,
    }


def normalize_text(s: str) -> str:
    """内容一致性比较用的归一化：去全部空白与空位符〓（docx 转换验证同款）。"""
    return re.sub(r'\s|〓', '', s)


def visible_text(lex) -> str:
    """token 流里的正文字符（排除自定义注解定义块内部）。"""
    return ''.join(t.raw for t in lex.tokens if t.kind == 'text' and not t.in_def)


def content_matches(expected: str, visible: str) -> bool:
    """expected（源数据文本）归一化后是否完整出现在 visible（渲染/回读文本）中。"""
    return normalize_text(expected) in normalize_text(visible)


# ---- docx 源与定稿 fbd 的内容核对 ----
# 定稿相对 docx 有既定的样式规范化（全角括号/逗号/分号改半角、波浪号改全角～）。
# 两侧套同一套映射后要求**逐字符完全相等**——比"差异白名单"更强：漏字、错字、多字
# 都逃不掉，只有全/半角互换被有意吸收。子串匹配（content_matches）会被这些规范化
# 打断连续性而必然失败，不能用作判据。
CANON = str.maketrans({
    '（': '(', '）': ')', '，': ',', '；': ';', '：': ':', '~': '～',
    # 源里 GBK 编不了的箭头 → 书版可用的 →（定稿梳理题即用 →）
    '⇨': '→', '⇒': '→', '⟶': '→',
    # 括号类全部归一到半角圆括号：**同一个半角 `[` 在不同上下文要映射到不同的全角形态**
    # （考查范围 → 【】、出处 → （）、书名引用 → ［］），字符级映射分不出来，
    # 所以两侧一律归一到同一对再比。内容核对只关心"字有没有丢"，不关心括号形状。
    '[': '(', ']': ')', '［': '(', '］': ')', '【': '(', '】': ')',
})


def docx_text(path) -> str:
    """docx 正文纯文本（解 zip 读 document.xml；不引入 python-docx 依赖）。"""
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    return re.sub(r'<[^>]+>', '', re.sub(r'</w:p>', '\n', xml))


def compare_text(lex) -> str:
    """正文可见文本；圈码 ⟨A1⟩B<编号⟩⟨A3⟩ 去掉编号的前导 B
    （定稿写 B11、源 docx 写裸 11，同一段号的不同记法，不是内容差异）。"""
    out, in_circle = [], False
    for t in lex.tokens:
        if t.kind == 'ctrl':
            in_circle = (t.raw == 'A1') if t.raw in ('A1', 'A3') else in_circle
            continue
        if t.kind != 'text' or t.in_def:
            continue
        raw = t.raw
        if in_circle and re.fullmatch(r'B\d+', raw):
            raw = raw[1:]
        out.append(raw)
    return ''.join(out)


def diff_report(expected: str, lex) -> dict:
    """docx 归一化文本 vs 定稿回读文本：规范化后逐字符比对，并留差异清单备查。"""
    exp = normalize_text(expected).translate(CANON)
    vis_all = normalize_text(compare_text(lex)).translate(CANON)
    k = vis_all.find(exp[:20])
    if k < 0:
        return {'passed': False, 'reason': '回读文本中找不到源文本起点'}
    vis = vis_all[k:]
    forms = {}
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, exp, vis,
                                                        autojunk=False).get_opcodes():
        if tag != 'equal':
            forms[f'{exp[i1:i2]} → {vis[j1:j2]}'] = forms.get(f'{exp[i1:i2]} → {vis[j1:j2]}', 0) + 1
    return {
        'passed': exp == vis,          # 规范化后完全相等才算内容无损
        'expectedChars': len(exp), 'visibleChars': len(vis),
        'identicalAfterCanon': exp == vis,
        'residualForms': forms,        # 非空即内容风险，必须人工解释
    }


def render_preview(path, out=None, pro=None, columns=None, root=None) -> Path:
    """渲染自包含单文件 HTML（图片内嵌 data URI，可离线双击打开）。返回 HTML 路径。"""
    from fbdview.bytes_io import read
    from fbdview.lexer import tokenize
    from fbdview.layout import analyze_geometry
    from fbdview import render_html, report as report_mod
    path = str(path)
    dec = read(path)
    lex = tokenize(dec)
    rep = report_mod.analyze(path, dec, lex)
    geo = analyze_geometry(path, dec, pro)
    if columns:
        geo.columns = columns
        geo.column_w = ((geo.text_w or 170) - (columns - 1) *
                        (geo.column_gap if geo.column_gap is not None else 8)) / columns
    out = Path(out) if out else Path(os.path.splitext(path)[0] + '.preview.html')
    out.write_text(
        render_html.page(dec, lex, rep, geo, path, os.path.basename(path),
                         rel='', root=root or os.path.dirname(os.path.abspath(path)),
                         inline=True),
        encoding='utf-8', newline='\n')
    return out


def copy_pro(ref, out_dir, name=None) -> Path:
    """参照 PRO 逐字节复制到输出目录（PRO 与小样同名配套）。"""
    src = Path(ref)
    dst = Path(out_dir) / (name or (src.stem + '.PRO'))
    dst.write_bytes(src.read_bytes())
    return dst


def _print_summary(info: dict) -> None:
    ctrl = info['ctrl']
    print(f"文件：{info['path']}")
    print(f"规模：{info['size']} 字节 / {info['lines']} 行 / 注解 {info['annot_total']} 处")
    print(f"控制符：A4={ctrl.get('A4', 0)} A5={ctrl.get('A5', 0)} "
          f"A6={ctrl.get('A6', 0)}（fbd 应为 2）")
    print(f"几何：页面 {info['geometry']['page']}，栏数 {info['geometry']['columns']}")
    if info['unknown_bytes']:
        print('未知用户区字节：' + '、'.join(b['hex'] for b in info['unknown_bytes']))
    if info['warnings']:
        print(f"告警 {len(info['warnings'])} 条（退出码 2）：")
        for w in info['warnings']:
            print('  - ' + w)
    else:
        print('告警：无')


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description='FBD 排版四件套：validate / preview')
    sub = p.add_subparsers(dest='cmd', required=True)
    v = sub.add_parser('validate', help='解析 + 统计 + 告警清单（有告警退出码 2）')
    v.add_argument('file')
    v.add_argument('--pro', help='指定配套 PRO（默认同名文件）')
    v.add_argument('--json', action='store_true', help='输出完整 JSON')
    r = sub.add_parser('preview', help='渲染自包含单文件 HTML 预览')
    r.add_argument('file')
    r.add_argument('--out', help='输出路径（默认 <file>.preview.html）')
    r.add_argument('--pro', help='指定配套 PRO')
    r.add_argument('--columns', type=int, choices=range(1, 9), help='显式覆盖栏数')
    a = p.parse_args(argv)
    if a.cmd == 'validate':
        info = validate(a.file, a.pro)
        if a.json:
            print(json.dumps({k: w for k, w in info.items() if not k.startswith('_')},
                             ensure_ascii=False, indent=2))
        else:
            _print_summary(info)
        return 2 if info['warnings'] else 0
    out = render_preview(a.file, a.out, a.pro, a.columns)
    print('已写入 ' + str(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())

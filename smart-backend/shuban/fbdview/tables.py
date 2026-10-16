"""BH widths and row geometry; unsupported marks are retained as diagnostics."""
import re
from .layout import _to_mm


def parse_row(params, base_pt, available, previous=None):
    p = params.replace('，', ',').replace('＋', '+').replace('－', '-')
    chunks = re.split(r',(?![^()]*\))', p)
    header = chunks[0]
    result = dict(previous or {})
    result.setdefault('cells', [{'width': available, 'align': 'left', 'line': 'Z'}])
    result.setdefault('height', None)
    result.setdefault('top', 'Z')
    result.setdefault('valign', 'middle')
    m = re.match(r'D([FSWZDQ=]?)', header)
    if m:
        result['top'] = m.group(1) or 'Z'
    if len(chunks)>1:
        right=re.search(r'([FSWZDQ=])$',chunks[-1])
        result['right']=right.group(1) if right else 'Z'
    for key, code in [('height', 'G'), ('padding_top', 'TK'), ('padding_bottom', 'JK')]:
        m = re.search(code + r'([+\d.*:/;\"”]+(?:mm|p|x)?)', header)
        if m:
            result[key] = _to_mm(m.group(1).lstrip('+'), base_pt)
    for flag, align in [('SQ', 'top'), ('XQ', 'bottom'), ('JZ', 'middle')]:
        if flag in header:
            result['valign'] = align
    cells = []
    for chunk in chunks[1:]:
        m = re.search(r'([FSWZDQ=]?)(?:\d+[\"”]?)?K([^。]*)(?:。(\d+))?', chunk)
        if not m:
            continue
        expr = re.split(r'DW|CM|YQ|ZQ|[FSWZDQ=]$', m.group(2))[0]
        width = _to_mm(expr.lstrip('+'), base_pt) if expr else None
        cell = {'width': width, 'line': m.group(1) or 'Z',
                'align': 'right' if 'YQ' in chunk else 'left' if 'ZQ' in chunk else 'center'}
        cells.extend(dict(cell) for _ in range(int(m.group(3) or 1)))
    if cells:
        free = max(0, available - sum(c['width'] or 0 for c in cells))
        flexible = sum(c['width'] is None for c in cells)
        for c in cells:
            if c['width'] is None:
                c['width'] = free / flexible if flexible else available / len(cells)
        result['cells'] = cells
    return result


def border(code, color):
    # 线宽对照成品 PDF 实测：正线 0.33pt、反线/粗线 0.76pt —— 1px / 2px 两级
    return f"{1 if code == 'W' else 2 if code == 'F' else 3 if code in ('S', '=') else 1}px {'double' if code in ('S', '=') else 'dotted' if code == 'D' else 'solid'} {color}"

"""FBD 小样 → Word (.docx) 导出。纯标准库（zipfile + xml），不引入第三方依赖。

导出的是**可编辑内容流**，不是像素级成品版式（Word 会自行重排分页）：
- 〖LM〗〖FL）0〗/〖FL(…〗 → Word 节（section）：每份试卷一节，按 BP/PRO 的
  页面尺寸、边空与栏数设置分栏；节分隔默认"下一页起排"，与成品的分卷规律一致；
  独立的 〖LM〗 → 段落"段前分页"；
- 字体字号（HT/WT/ST 三通道）、外挂字体加粗/斜体、CS 彩色、YY 反白、ZZ 着重、
  JZ/JY 对齐、A4 换行、A5 换段、KH 空行（正向近似）；
- BG/BH 表格 → Word 表格（列宽、线型 F/S/D/W/Z、单元格内保留字体状态）；
- TP/XC 图片 → 内嵌 PNG（TIFF/BMP 经 Pillow、EPS 经 Ghostscript 栅格化）；
- 边文/背景（BW/BJ/PS）与页眉词条（CT）、脚注正文（ZW）属于页面装饰层，
  不进内容流，导出时跳过；FK/SX/ZK 等盒式/缩进注解退化为普通流内容。
"""

import io
import re
import zipfile
from xml.sax.saxutils import escape

from . import macros as macros_mod
from .context import load_context
from .font_state import FontState
from .render_html import (cmyk_to_css, image_size_mm, parse_pic_params,
                          rasterize, resolve_image)
from .sizes import family_css, mm_of

_MM_TO_DXA = 1440 / 25.4      # Word 列宽单位 dxa（1/20 pt）
_MM_TO_EMU = 36000
_LINE = {'Z': ('single', 4), 'F': ('single', 4), 'S': ('double', 4),
         'D': ('dotted', 4), 'W': ('single', 12), 'Q': ('double', 4),
         '=': ('double', 4)}
_WEST_DEFAULT = 'Times New Roman'   # 书版 BZ（白正）对应的标准西文字体


def _family_name(css: str) -> str:
    return (css or '').split(',')[0].strip().strip("'\":")


def _rpr(f_han, f_west, color=None, emph=False, reverse=False, sup=False):
    west = _family_name(family_css(f_west.code)) or _WEST_DEFAULT
    han = _family_name(family_css(f_han.code, f_han.external)) or '宋体'
    sz = round(f_han.vertical * 2 * 0.9921)   # 书版磅 → 标准磅 ×0.9921，半磅为单位
    r = [f'<w:rFonts w:ascii="{escape(west)}" w:hAnsi="{escape(west)}" '
         f'w:eastAsia="{escape(han)}" w:cs="{escape(west)}"/>']
    if f_han.bold:
        r.append('<w:b/>')
    if f_han.italic:
        r.append('<w:i/>')
    r.append(f'<w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/>')
    if reverse:
        r.append('<w:color w:val="FFFFFF"/><w:shd w:val="clear" w:fill="000000"/>')
    elif color:
        r.append(f'<w:color w:val="{color.lstrip("#").upper()}"/>')
    if emph:
        r.append('<w:em w:val="dot"/>')
    if sup:
        r.append('<w:vertAlign w:val="superscript"/>')
    return '<w:rPr>' + ''.join(r) + '</w:rPr>'


class _Body:
    """OOXML 部件收集器：正文 XML + 媒体文件 + 关系表。"""

    def __init__(self):
        self.body: list[str] = []
        self.media: list[tuple[str, bytes]] = []
        self.rels: list[str] = []
        self._id = 100

    def image(self, path: str, w_mm: float, h_mm: float) -> str | None:
        try:
            png = rasterize(path, 1400)
        except Exception:
            png = None
        if not png:
            return None
        name = f'image{len(self.media) + 1}.png'
        self.media.append((name, png))
        self._id += 1
        rid = f'rId{self._id}'
        self.rels.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            f'Target="media/{escape(name)}"/>')
        cx, cy = int(w_mm * _MM_TO_EMU), int(h_mm * _MM_TO_EMU)
        self._id += 1
        did = self._id
        return (f'<w:r><w:drawing>'
                f'<wp:inline distT="0" distB="0" distL="0" distR="0">'
                f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{did}" name="图片{did}"/>'
                f'<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                f'<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
                f'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
                f'<pic:nvPicPr><pic:cNvPr id="{did}" name="图片{did}"/><pic:cNvPicPr/></pic:nvPicPr>'
                f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
                f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
                f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
                f'</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')

    def sectpr(self, geo, columns: int, column_gap) -> str:
        pw = (geo.trim_w or geo.page_w or 210.0) * _MM_TO_DXA
        ph = (geo.trim_h or geo.page_h or 297.0) * _MM_TO_DXA
        mt = (geo.m_top if geo.m_top is not None else 15.0) * _MM_TO_DXA
        mb = (geo.m_bottom if geo.m_bottom is not None else 15.0) * _MM_TO_DXA
        ml = (geo.m_left if geo.m_left is not None else 15.0) * _MM_TO_DXA
        mr = (geo.m_right if geo.m_right is not None else 15.0) * _MM_TO_DXA
        orient = ' w:orient="landscape"' if pw > ph else ''
        cols = (f'<w:cols w:num="{columns}" w:space="{round((column_gap or 8) * _MM_TO_DXA)}"/>'
                if columns > 1 else '<w:cols w:space="425"/>')
        return (f'<w:sectPr><w:pgSz w:w="{round(pw)}" w:h="{round(ph)}"{orient}/>'
                f'<w:pgMar w:top="{round(mt)}" w:right="{round(mr)}" w:bottom="{round(mb)}" '
                f'w:left="{round(ml)}" w:header="851" w:footer="851" w:gutter="0"/>'
                f'{cols}<w:docGrid w:linePitch="360"/></w:sectPr>')


class _Exporter:
    """遍历宏展开后的 token 流，产出 Word 正文。"""

    def __init__(self, dec, lex, geo, fbd_path, root, hidden_colors=None):
        self.dec, self.geo = dec, geo
        self.fbd_path, self.root = fbd_path, root
        self.hidden = {c.lower() for c in (hidden_colors or ())}
        self.body = _Body()
        ctx = load_context(fbd_path, geo.pro_path) if fbd_path else None
        defs = macros_mod.collect_defs(lex.tokens)
        if ctx:
            defs = {**macros_mod.collect_defs(ctx.tokens), **defs}
        self.tokens = macros_mod.expand(lex.tokens, defs)
        self.fonts = FontState(vertical=geo.base_pt or 10.5,
                               aliases=ctx.aliases if ctx else {})
        self.par: list[str] = []          # 当前段落 run 列表
        self.jc = None                    # JZ/JY 状态，至换行/换段为止
        self.color = None
        self.emph = False
        self.reverse = False
        self.sup = False
        self.skip: list[str] = []         # 装饰块栈（BW/BJ/CT/ZW）
        self.table = None                 # 表格上下文
        self.section_open = False
        self.dirty = False                # 自上次 sectPr 后是否产出过内容
        self.since_sect = 0               # 最近一次 sectPr 之后追加的块数
        self.pending_brk = False          # 独立 LM：下一段段前分页
        self.last_sect = None

    # ---- 段落与运行 ----
    def _target(self):
        """当前 run 的去处：表格单元或正文段落。"""
        if self.table is not None and self.table['cell'] is not None:
            return self.table['cell']
        return self.par

    def add_run(self, text):
        if not text or self.skip:
            return
        if self.color and self.color.lower() in self.hidden:
            return               # 颜色栏隐藏的内容不导出（Word 版为可编辑流，内容省略）
        text = text.replace('〓', '　')
        text = ''.join(ch for ch in text if not ('\ue000' <= ch <= '\uf8ff'))
        if not text.strip('\n'):
            return
        f_han = self.fonts.select('中')[1]
        f_west = self.fonts.select('1')[1]
        run = (f'<w:r>{_rpr(f_han, f_west, self.color, self.emph, self.reverse, self.sup)}'
               f'<w:t xml:space="preserve">{escape(text)}</w:t></w:r>')
        self._target().append(run)
        self.dirty = True

    def add_break(self):
        if self.skip:
            return
        self._target().append('<w:r><w:br/></w:r>')

    def flush(self, sect=None):
        runs = self.par
        self.par = []
        brk = self.pending_brk and bool(runs)
        if runs:
            self.pending_brk = False
        if not runs and sect is None and not brk:
            return
        props = []
        if brk:
            props.append('<w:pageBreakBefore/>')
        if self.jc:
            props.append(f'<w:jc w:val="{self.jc}"/>')
        if sect:
            props.append(sect)
        ppr = f'<w:pPr>{"".join(props)}</w:pPr>' if props else ''
        self.body.body.append(f'<w:p>{ppr}{"".join(runs)}</w:p>')
        self.dirty = True
        self.since_sect += 1
        if sect:
            self.last_sect = sect
        self.jc = None

    def close_section(self, columns: int, gap):
        sect = self.body.sectpr(self.geo, columns, gap)
        self.flush(sect=sect)
        self.since_sect = 0
        self.dirty = False
        self.section_open = False

    # ---- 图片 ----
    def image_run(self, params):
        info = parse_pic_params(params)
        path = resolve_image(info['file'], self.fbd_path, self.root)
        if not path:
            return
        w_mm, h_mm = None, None
        if info.get('ent_h'):
            w_mm, h_mm = info['ent_w'] or info['ent_h'], info['ent_h']
        if w_mm is None:
            own = image_size_mm(path)
            if own:
                w_mm, h_mm = own
        if w_mm is None and info.get('box_h'):
            w_mm, h_mm = info['box_w'], info['box_h']
        if not w_mm or not h_mm:
            return
        if info.get('scale_x') and info.get('scale_y'):
            w_mm, h_mm = w_mm * info['scale_x'], h_mm * info['scale_y']
        col_w = self.geo.column_w or self.geo.text_w or 170
        if w_mm > col_w:                       # 超栏宽按栏宽等比收
            h_mm *= col_w / w_mm
            w_mm = col_w
        xml = self.body.image(path, w_mm, h_mm)
        if xml:
            self._target().append(xml)
            self.dirty = True

    # ---- 表格 ----
    def cell_end(self):
        tb = self.table
        if tb is None or tb['cell'] is None:
            return
        runs = tb['cell']
        tb['cell'] = None
        if not tb['rows']:
            return
        tb['rows'][-1][1].append(f'<w:p>{"".join(runs)}</w:p>' if runs else '<w:p/>')

    def table_flush(self):
        tb = self.table
        self.table = None
        if tb is None:
            return
        self.cell_end()
        if not tb['rows']:
            return
        grid = [c['width'] or 0 for c in tb['rows'][0][0]['cells']]
        rows_xml = []
        for spec, cells in tb['rows']:
            tr = []
            for i, cell in enumerate(spec['cells']):
                w = cell['width'] or (grid[i] if i < len(grid) else 10) or 10
                bd = []
                for side, code in (('top', spec.get('top', 'Z')),
                                   ('left', 'Z'), ('right', spec.get('right', 'Z')),
                                   ('bottom', spec.get('top', 'Z'))):
                    style, sz = _LINE.get(code or 'Z', _LINE['Z'])
                    bd.append(f'<w:{side} w:val="{style}" w:sz="{sz}" w:color="000000"/>')
                tcpr = (f'<w:tcPr><w:tcW w:w="{round(w * _MM_TO_DXA)}" w:type="dxa"/>'
                        f'<w:tcBorders>{"".join(bd)}</w:tcBorders>'
                        f'<w:vAlign w:val="center"/></w:tcPr>')
                paras = cells[i] if i < len(cells) and cells[i] else '<w:p/>'
                tr.append(f'<w:tc>{tcpr}{paras}</w:tc>')
            rows_xml.append(f'<w:tr>{"".join(tr)}</w:tr>')
        tblw = round((self.geo.text_w or sum(grid)) * _MM_TO_DXA)
        borders = ''.join(f'<w:{s} w:val="{_LINE["Z"][0]}" w:sz="{_LINE["Z"][1]}" w:color="000000"/>'
                          for s in ('top', 'left', 'bottom', 'right'))
        self.body.body.append(
            f'<w:tbl><w:tblPr><w:tblW w:w="{tblw}" w:type="dxa"/>'
            f'<w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>'
            f'<w:tblGrid>{"".join(f"<w:gridCol w:w=\"{round(g * _MM_TO_DXA)}\"/>" for g in grid)}</w:tblGrid>'
            + ''.join(rows_xml) + '</w:tbl>')
        self.dirty = True
        self.since_sect += 1

    # ---- 主循环 ----
    def run(self):
        from .tables import parse_row
        avail = self.geo.text_w or 170
        for t in self.tokens:
            if self.skip:
                if t.kind == 'annot':
                    if t.name == self.skip[-1] and t.op == 'open':
                        self.skip.append(t.name)
                    elif t.name == self.skip[-1] and t.op in ('close', 'args-close'):
                        self.skip.pop()
                continue
            if t.kind == 'newline':
                if self.table is None:
                    self.add_break()
                continue
            if t.kind == 'ctrl':
                if t.raw == 'A5':
                    if self.table is None:
                        self.flush()
                elif t.raw == 'A4':
                    self.add_break()
                elif t.raw == 'A6':
                    break
                continue
            if t.kind != 'annot':
                self.add_run(self.dec.translate(t.raw))
                continue
            n, p, op = t.name, t.params, t.op
            if n in ('HT', 'WT', 'ST'):
                self.fonts.apply(n, p)
            elif n in ('CS', 'CSX', 'CSD'):
                self.color = cmyk_to_css(p) if p else None
            elif n == 'JZ':
                self.jc = 'center'
            elif n == 'JY':
                self.jc = 'right'
            elif n == 'KH':
                self.flush()
                if p and not p.startswith(('-', '－', '−', '—')):
                    m = re.findall(r'\d+(?:\.\d+)?', p)
                    if m:
                        pitch = max(0.1, mm_of(self.fonts.select('中')[1].vertical))
                        for _ in range(max(1, round(float(m[0]) / pitch))):
                            self.body.body.append('<w:p/>')
                            self.dirty = True
            elif n == 'ZZ':
                self.emph = op != 'close'
            elif n == 'YY':
                self.reverse = op != 'close'
            elif n in ('BW', 'BJ', 'CT', 'ZW'):
                if op == 'open':
                    self.skip.append(n)
            elif n == 'SX':
                if op == 'open':
                    self.add_break()      # 上下叠排近似为换行
            elif n in ('TP', 'XC'):
                self.image_run(p)
            elif n == 'BG':
                if op == 'open':
                    self.flush()
                    self.table = {'rows': [], 'spec': None, 'cell': None, 'last': None}
                else:
                    self.table_flush()
            elif n == 'BH':
                if self.table is not None:
                    self.cell_end()
                    self.table['spec'] = parse_row(p, mm_of(self.geo.base_pt or 10.5),
                                                   avail, self.table['last'])
                    self.table['last'] = self.table['spec']
                    self.table['rows'].append([self.table['spec'], []])
                    self.table['cell'] = []
            elif n == 'FL':
                if op == 'close':
                    self.close_section(self.geo.columns if self.section_open else 1,
                                       self.geo.column_gap)
                elif not self.section_open:
                    self.par.clear()      # 分节边界上的换行残渣不进下一节
                    if self.dirty:        # 首个 FL( 前的通栏内容（BP/边文之外的正文）
                        self.close_section(1, None)
                    self.section_open = True
            elif n == 'LM':
                if self.section_open:
                    pass                  # 卷末 LM 总是与 FL）连用，节分隔自带换页
                else:
                    self.pending_brk = True
            elif n == '' and self.table is not None:
                self.cell_end()
                self.table['cell'] = []
            # 其余注解（FK/SX 收口/ZK/BT/HS 等）退化为普通流内容，仅忽略标记本身
        if self.table is not None:
            self.table_flush()
        if self.section_open or self.since_sect:
            self.close_section(self.geo.columns if self.section_open else 1, self.geo.column_gap)
        return self


def build_docx(dec, lex, geo, fbd_path, root=None, hidden_colors=None) -> bytes:
    """导出 .docx 字节。dec/lex/geo 与 render_html.page 的入参同源；
    hidden_colors 为要隐藏的 CS 颜色（#rrggbb 集合），对应内容不导出。"""
    ex = _Exporter(dec, lex, geo, fbd_path, root, hidden_colors).run()
    body = ex.body
    last_sect = ex.last_sect or body.sectpr(geo, 1, None)
    media_xml = ''.join(
        f'<Override PartName="/word/media/{name}" ContentType="image/png"/>' for name, _ in body.media)
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Default Extension="png" ContentType="image/png"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                     + media_xml + '</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                 '</Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId900" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                + ''.join(body.rels) + '</Relationships>')
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
              '<w:docDefaults><w:rPrDefault><w:rPr>'
              '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>'
              '<w:sz w:val="21"/><w:szCs w:val="21"/>'
              '</w:rPr></w:rPrDefault></w:docDefaults>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
              '</w:styles>')
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document '
                'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
                'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
                '<w:body>' + ''.join(body.body) + last_sect + '</w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', root_rels)
        z.writestr('word/document.xml', document)
        z.writestr('word/styles.xml', styles)
        z.writestr('word/_rels/document.xml.rels', doc_rels)
        for name, data in body.media:
            z.writestr(f'word/media/{name}', data)
    return buf.getvalue()

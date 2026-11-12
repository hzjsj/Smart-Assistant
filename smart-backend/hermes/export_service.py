"""Paper files from saved snapshots. No new project-wide dependencies."""

from collections import defaultdict
from pathlib import Path
import re
import uuid
from xml.sax.saxutils import escape
import zipfile

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import HermesExport, HermesPaper
from .question_bank_service import paper_response
from .question_schemas import ExportResponse

STORAGE_DIR = Path(__file__).parent / "storage"
MIME_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
    "json": "application/json",
}


def export_path(export: HermesExport) -> Path:
    return STORAGE_DIR / f"{export.id}.{export.format}"


def safe_filename(title: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", title).strip(". ")[:150] or "试卷"


def as_export_response(export: HermesExport) -> ExportResponse:
    return ExportResponse(id=export.id, paper_id=export.paper_id, format=export.format, status=export.status, filename=export.filename, error=export.error, download_url=f"/api/hermes/v1/exports/{export.id}/download" if export.status == "ready" else None)


def question_section_heading(type: str, questions, section_index: int) -> str:
    digits = "零一二三四五六七八九"
    value = section_index + 1
    ordinal = ""
    zero = False
    for unit, label in ((100, "百"), (10, "十"), (1, "")):
        digit, value = divmod(value, unit)
        if digit:
            if zero:
                ordinal += "零"
            if not (unit == 10 and digit == 1 and not ordinal):
                ordinal += digits[digit]
            ordinal += label
            zero = False
        elif ordinal and value:
            zero = True
    if any(question.score is None for question in questions):
        detail = "部分小题未标注分值"
    else:
        total = round(sum(question.score for question in questions), 6)
        total_text = f"{total:.6f}".rstrip("0").rstrip(".")
        if questions and all(question.score == questions[0].score for question in questions):
            score = format(questions[0].score, ".15g")
            detail = f"每小题{score}分，满分{total_text}分"
        else:
            detail = f"各小题分值不等，满分{total_text}分"
    return f"{ordinal}、{type}（本大题共{len(questions)}小题，{detail}）"


def paper_markdown(paper: HermesPaper) -> str:
    snapshot = paper_response(paper)
    document = snapshot.document
    total = f"{snapshot.total_score:g} 分" if snapshot.total_score is not None else "部分题目未标注分值"
    lines = [f"# {paper.title}", "", f"{document.subject} · {document.grade} · {document.exam_type}", "", f"题目数量：{len(document.questions)} 题　总分：{total}", ""]
    groups = defaultdict(list)
    for question in document.questions:
        groups[question.type].append(question)
    ordered_questions = []
    for section_index, (type, questions) in enumerate(groups.items()):
        lines.extend([f"## {question_section_heading(type, questions, section_index)}", ""])
        for question in questions:
            ordered_questions.append(question)
            lines.extend([f"**{len(ordered_questions)}.** {question.content}", ""])
            for option in question.options:
                lines.extend([f"{option.label}. {option.content}", ""])
    if paper.include_answers:
        lines.extend(["# 参考答案与解析", ""])
        for index, question in enumerate(ordered_questions, 1):
            lines.extend([f"### 第 {index} 题", "", f"答案：{question.answer or '未提供'}", "", question.analysis, ""])
    return "\n".join(lines)


def write_docx(paper: HermesPaper, path: Path):
    import pypandoc
    from docx import Document
    from docx.oxml.ns import qn
    from docx.shared import Mm, Pt

    pypandoc.convert_text(paper_markdown(paper), "docx", format="markdown+tex_math_dollars-raw_html-raw_attribute", outputfile=str(path), extra_args=["--standalone", "--sandbox"])
    document = Document(path)
    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(11)
    normal.element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    for section in document.sections:
        section.page_width = Mm(210)
        section.page_height = Mm(297)
        section.top_margin = section.bottom_margin = Mm(18)
    for paragraph in document.paragraphs:
        if paragraph.text == "参考答案与解析":
            paragraph.paragraph_format.page_break_before = True
    document.save(path)


def column_name(index: int) -> str:
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def write_xlsx(paper: HermesPaper, path: Path):
    snapshot = paper_response(paper)
    questions = snapshot.document.questions
    detail = [["题号", "题目ID", "题型", "知识点", "认知层级", "预估难度", "分值", "题干", "参考答案", "解析"]]
    for index, question in enumerate(questions, 1):
        detail.append([index, question.id, question.type, "、".join(question.knowledge_points), question.cognitive_level, question.difficulty, question.score, question.content, question.answer, question.analysis])
    summary = [["维度", "类别", "题数", "分值", "题数占比", "分值占比"]]
    for dimension, get_key in [
        ("知识点（首个为主）", lambda q: q.knowledge_points[0] if q.knowledge_points else "未标注"),
        ("题型", lambda q: q.type),
        ("认知层级", lambda q: q.cognitive_level or "未标注"),
    ]:
        groups = defaultdict(list)
        for question in questions:
            groups[get_key(question)].append(question)
        for category, members in groups.items():
            score = sum(q.score or 0 for q in members) if snapshot.total_score is not None else None
            summary.append([dimension, category, len(members), score, len(members) / len(questions), score / snapshot.total_score if snapshot.total_score else None])

    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    def worksheet(rows, percentages=False):
        content = []
        for row_index, values in enumerate(rows, 1):
            cells = []
            for col_index, value in enumerate(values, 1):
                ref = f"{column_name(col_index)}{row_index}"
                style = 1 if row_index == 1 else (2 if percentages and col_index >= 5 else 0)
                if value is None:
                    cells.append(f'<c r="{ref}" s="{style}"/>')
                elif isinstance(value, (int, float)):
                    cells.append(f'<c r="{ref}" s="{style}"><v>{value}</v></c>')
                else:
                    # inlineStr keeps formula-like source text from becoming Excel formulas.
                    clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', "", str(value))
                    cells.append(f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(clean)}</t></is></c>')
            content.append(f'<row r="{row_index}">{"".join(cells)}</row>')
        return f'<?xml version="1.0" encoding="UTF-8"?><worksheet {ns}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="10" width="22" customWidth="1"/></cols><sheetData>{"".join(content)}</sheetData></worksheet>'

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml', f'<workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="题目明细" sheetId="1" r:id="rId1"/><sheet name="维度汇总" sheetId="2" r:id="rId2"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        archive.writestr('xl/styles.xml', f'<styleSheet {ns}><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
        archive.writestr('xl/worksheets/sheet1.xml', worksheet(detail))
        archive.writestr('xl/worksheets/sheet2.xml', worksheet(summary, True))


def create_export(db: Session, user_id: int, paper: HermesPaper, format: str, pdf_data: bytes | None = None) -> ExportResponse:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    filename = safe_filename(paper.title) + ("_双向细目表" if format == "xlsx" else "") + f".{format}"
    export = HermesExport(id=uuid.uuid4().hex, user_id=user_id, paper_id=paper.id, format=format, status="generating", filename=filename)
    db.add(export)
    db.commit()
    path = export_path(export)
    try:
        if format == "docx":
            write_docx(paper, path)
        elif format == "xlsx":
            write_xlsx(paper, path)
        elif format == "json":
            path.write_text(paper.payload_json, encoding="utf-8")
        elif format == "pdf":
            import fitz
            if not pdf_data or len(pdf_data) > 30 * 1024 * 1024 or not pdf_data.startswith(b"%PDF-"):
                raise ValueError("无效的 PDF 文件或文件超过 30MB")
            with fitz.open(stream=pdf_data, filetype="pdf") as document:
                if not document.page_count:
                    raise ValueError("PDF 文件没有页面")
            path.write_bytes(pdf_data)
        else:
            raise ValueError("不支持的导出格式")
        if not path.is_file() or not path.stat().st_size:
            raise ValueError("导出文件为空")
        export.status = "ready"
        db.commit()
        return as_export_response(export)
    except Exception as exc:
        path.unlink(missing_ok=True)
        export.status = "failed"
        export.error = "文件生成失败，请检查内容及转换工具后重试"
        db.commit()
        raise HTTPException(503, export.error) from exc


def get_export(db: Session, export_id: str, user_id: int) -> HermesExport:
    export = db.query(HermesExport).filter_by(id=export_id, user_id=user_id).first()
    if not export:
        raise HTTPException(404, "导出文件不存在或无权访问")
    return export

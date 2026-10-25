"""Registered Word-to-FBD layouts backed by checked-in FBD/PRO headers."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


TEMPLATE_ROOT = Path(__file__).resolve().parent / "templates" / "word_fbd"


@dataclass(frozen=True)
class WordTemplate:
    id: str
    name: str
    description: str
    directory: str
    page_width: float
    page_height: float
    columns: int
    column_gap: float
    mode: str
    column_open: str
    booklet_title_prefix: str = ""
    booklet_title_suffix: str = ""
    booklet_title_font: str = ""
    booklet_title_image: str = ""
    booklet_answer_color: str = "ABD8DA"

    @property
    def directory_path(self) -> Path:
        return TEMPLATE_ROOT / self.directory

    @property
    def header_path(self) -> Path:
        return self.directory_path / "header.fbd"

    @property
    def pro_path(self) -> Path:
        return self.directory_path / "template.PRO"


WORD_TEMPLATES = (
    WordTemplate(
        id="math-main-3col",
        name="大联考数学正文（三栏 A3）",
        description="426 × 303 mm 页面，正文版心 380 × 265 mm，三栏，栏距 10 mm。",
        directory="math-main",
        page_width=426,
        page_height=303,
        columns=3,
        column_gap=10,
        mode="text",
        column_open="〖FL(3-DK10mm〗",
    ),
    WordTemplate(
        id="math-booklet-2col",
        name="大联考数学小夹册（双栏）",
        description="206 × 296 mm 页面，成品 200 × 290 mm，版心 170 × 260 mm，双栏，栏距 8.4 mm。",
        directory="math-booklet",
        page_width=206,
        page_height=296,
        columns=2,
        column_gap=8.4,
        mode="booklet",
        column_open="〖FL(-DK2〗",
        booklet_title_prefix="〖ML〗〖HS3〗〖JZ〗〖SX(B-6.5mm〗",
        booklet_title_suffix="〖SX)〗〖HT〗",
        booklet_title_font="DH",
        booklet_title_image="专项.eps",
        booklet_answer_color="ABD8DA",
    ),
)

TEMPLATE_BY_ID = {item.id: item for item in WORD_TEMPLATES}


def list_templates() -> list[dict]:
    return [
        {
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "pageWidth": item.page_width,
            "pageHeight": item.page_height,
            "columns": item.columns,
            "columnGap": item.column_gap,
        }
        for item in WORD_TEMPLATES
        if item.header_path.is_file() and item.pro_path.is_file()
    ]


def get_template(template_id: str) -> WordTemplate | None:
    template = TEMPLATE_BY_ID.get(template_id)
    if template and template.header_path.is_file() and template.pro_path.is_file():
        return template
    return None

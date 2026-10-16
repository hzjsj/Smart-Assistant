"""FBD 文件上传、解析、校验和预览接口。"""
from __future__ import annotations

import os
import re
import uuid
from dataclasses import asdict
from functools import lru_cache
from html import escape
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response

from auth import get_current_user
from users.models import User
from shuban.fbdview import annotations, ast as ast_mod, macros, render_html, report
from shuban.fbdview.bytes_io import read as read_bytes
from shuban.fbdview.layout import analyze_geometry
from shuban.fbdview.lexer import tokenize

router = APIRouter(
    prefix="/api/shuban",
    tags=["书版预览"],
    dependencies=[Depends(get_current_user)],
)

UPLOAD_ROOT = Path(__file__).resolve().parents[1] / "uploads" / "shuban"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".fbd", ".pro", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".tif", ".tiff", ".bmp", ".eps", ".ps",
}


def _user_dir(user: User) -> Path:
    user_key = re.sub(r"[^A-Za-z0-9_-]", "_", str(user.userid))[:80]
    if not user_key:
        raise HTTPException(status_code=400, detail="用户目录无效")
    path = (UPLOAD_ROOT / user_key).resolve()
    if UPLOAD_ROOT.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="用户目录无效")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_file(user: User, filename: str) -> Path:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=404, detail="文件不存在")
    root = _user_dir(user)
    path = (root / name).resolve()
    if path.parent != root or not path.is_file() or path.suffix.lower() != ".fbd":
        raise HTTPException(status_code=404, detail="FBD 文件不存在")
    return path


@lru_cache(maxsize=24)
def _analyze(path_text: str, mtime_ns: int, size: int) -> dict:
    path = Path(path_text)
    decoded = read_bytes(str(path))
    lexed = tokenize(decoded)
    result = report.analyze(str(path), decoded, lexed)
    result["_geo"] = analyze_geometry(str(path), decoded)
    result["_dec"] = decoded
    result["_lex"] = lexed
    return result


def _file_analysis(user: User, filename: str) -> tuple[Path, dict]:
    path = _safe_file(user, filename)
    stat = path.stat()
    try:
        return path, _analyze(str(path), stat.st_mtime_ns, stat.st_size)
    except (OSError, UnicodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"FBD 解析失败：{exc}") from exc


def _json_report(result: dict) -> dict:
    payload = {
        **{key: value for key, value in result.items() if not key.startswith("_")},
        "geometry": asdict(result["_geo"]),
    }
    payload["file"] = Path(payload["file"]).name
    if payload["pro"]["path"]:
        payload["pro"]["path"] = Path(payload["pro"]["path"]).name
    if payload["geometry"].get("pro_path"):
        payload["geometry"]["pro_path"] = Path(payload["geometry"]["pro_path"]).name
    return payload


def _text_view(result: dict, plain: bool) -> str:
    decoded = result["_dec"]
    chunks: list[str] = []
    lines: list[str] = []
    for token in result["_lex"].tokens:
        if token.kind == "newline":
            lines.append("".join(chunks))
            chunks = []
        elif token.kind == "ctrl":
            if not plain:
                chunks.append(f"⟨{token.raw}⟩")
        elif token.kind == "annot":
            if not plain:
                chunks.append("〖" + decoded.translate(token.raw).replace("\n", "⏎") + "〗")
        else:
            chunks.append(token.raw if plain else decoded.translate(token.raw))
    lines.append("".join(chunks))
    if plain:
        return "\n".join(lines)
    return "\n".join(f"{index:>5}| {line}" for index, line in enumerate(lines, 1))


@router.get("/files")
def list_files(current_user: User = Depends(get_current_user)):
    root = _user_dir(current_user)
    files = []
    for path in sorted(root.glob("*.fbd"), key=lambda item: item.name.casefold()):
        stat = path.stat()
        files.append({"name": path.name, "size": stat.st_size, "updatedAt": stat.st_mtime})
    return {"files": files}


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    name = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="仅支持 FBD、PRO 及预览所需的图片文件")
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=400, detail="文件名无效")

    root = _user_dir(current_user)
    destination = root / name
    temporary = root / f".{uuid.uuid4().hex}.upload"
    total = 0
    try:
        with temporary.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="单个文件不能超过 50 MB")
                output.write(chunk)
        os.replace(temporary, destination)
    finally:
        await file.close()
        temporary.unlink(missing_ok=True)
    _analyze.cache_clear()
    return {"success": True, "name": name, "size": total}


@router.get("/files/{filename}/report")
def get_report(filename: str, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    return _json_report(result)


@router.get("/files/{filename}/tokens")
def get_tokens(filename: str, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    return [
        {
            "kind": token.kind,
            "line": token.line,
            "offset": token.offset,
            "depth": token.depth,
            "name": token.name,
            "params": token.params,
            "op": token.op,
            "category": token.cat,
            "description": token.desc,
            "confidence": token.confidence,
            "known": token.known,
            "inDefinition": token.in_def,
            "raw": result["_dec"].translate(token.raw) if token.kind != "newline" else "",
        }
        for token in result["_lex"].tokens
    ]


@router.get("/files/{filename}/ast")
def get_ast(filename: str, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    tree = ast_mod.build(result["_lex"].tokens, annotations.default())
    stats = macros.MacroStats()
    macros.expand(result["_lex"].tokens, tree.defs, stats=stats)
    return {
        "summary": ast_mod.summarize(tree.root),
        "definitions": {key: len(value) for key, value in tree.defs.items()},
        "macros": {
            "calls": stats.calls,
            "callsWithArguments": stats.calls_with_args,
            "expanded": stats.expanded,
            "undefined": sorted(set(stats.undefined)),
        },
        "warnings": tree.warnings,
        "notes": tree.notes,
        "tree": ast_mod.to_dict(tree.root, max_depth=8),
        "text": ast_mod.tree_text(tree.root, max_lines=5000),
    }


@router.get("/files/{filename}/text")
def get_text(filename: str, plain: bool = False, current_user: User = Depends(get_current_user)):
    _, result = _file_analysis(current_user, filename)
    return {"text": _text_view(result, plain)}


@router.get("/files/{filename}/preview", response_class=HTMLResponse)
def get_preview(filename: str, current_user: User = Depends(get_current_user)):
    path, result = _file_analysis(current_user, filename)
    layout = render_html.preview_html(
        result["_dec"], result["_lex"], result["_geo"],
        str(path), str(path.parent), inline=True,
    )
    preview = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        f'<title>{escape(path.name)}</title><style>{render_html.CSS}</style></head>'
        f'<body class="hide-bg hide-bw">{layout}</body>'
        f'<script>{render_html.JS}'
        'window.addEventListener("message",function(event){'
        'if(event.data&&event.data.type==="shuban-print")window.print();});'
        '</script></html>'
    )
    return HTMLResponse(content=preview)


@router.get("/files/{filename}/word")
def export_word(filename: str, current_user: User = Depends(get_current_user)):
    path, result = _file_analysis(current_user, filename)
    from shuban.fbdview.export_docx import build_docx

    content = build_docx(
        result["_dec"], result["_lex"], result["_geo"], str(path), str(path.parent),
    )
    download_name = f"{path.stem}.docx"
    from urllib.parse import quote

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(download_name)}"},
    )

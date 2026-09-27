"""切题模块路由：上传 / 切题识别 / 题库快照 / 上传记录。

接口响应结构与 smart-question-bank 前端及参考项目 20260820project_GfrGj
保持一致，前端迁移后无需改动数据处理逻辑。
"""
import asyncio
import math
import time

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from qieti import crud
from qieti.schemas import (
    CutRequest,
    RecordsResponse,
    SnapshotGetResponse,
    SnapshotPayload,
    SnapshotSaveResponse,
)
from qieti.service import cut_questions, is_oss_configured, upload_image_to_oss
from utils.url_guard import validate_public_url

router = APIRouter(prefix="/api/qieti", tags=["切题"], dependencies=[Depends(get_current_user)])


def _is_http_url(url) -> bool:
    return isinstance(url, str) and url.startswith(("http://", "https://"))


def _get_primary_rect(question: dict):
    rects = question.get("rects")
    if isinstance(rects, list) and rects:
        return rects[0]
    return question.get("rect")


def _build_crop_url(image_url: str, rect: dict | None) -> str:
    """基于阿里云 OSS 图片处理参数生成题目裁剪图 URL（x-oss-process）。"""
    if not _is_http_url(image_url) or not rect:
        return ""
    base_url = str(image_url).split("?")[0]
    x = max(0, math.floor(float(rect.get("x") or 0)))
    y = max(0, math.floor(float(rect.get("y") or 0)))
    w = max(1, math.floor(float(rect.get("w") or 0)))
    h = max(1, math.floor(float(rect.get("h") or 0)))
    process = f"x-oss-process=image/crop,w_{w},h_{h},x_{x},y_{y}"
    return f"{base_url}?{process}"


def _normalize_snapshot_payload(payload: dict) -> dict:
    """把前端提交的 pages 归一化为快照（移植自 smart-question-bank question-bank-sync）。"""
    pages = payload.get("pages") if isinstance(payload.get("pages"), list) else []
    try:
        current_page_index = int(payload.get("currentPageIndex") or 0)
    except (TypeError, ValueError):
        current_page_index = 0

    files = []
    for page_index, page in enumerate(pages):
        page = page if isinstance(page, dict) else {}
        questions = page.get("questions") if isinstance(page.get("questions"), list) else []
        files.append(
            {
                "pageId": page.get("id") or f"page_{page_index + 1}",
                "pageIndex": page_index,
                "name": page.get("name") or f"第 {page_index + 1} 页",
                "width": int(page.get("width") or 0),
                "height": int(page.get("height") or 0),
                "uploadedImageUrl": page.get("uploadedImageUrl") if _is_http_url(page.get("uploadedImageUrl")) else "",
                "questionCount": len(questions),
            }
        )

    questions = []
    for page_index, page in enumerate(pages):
        page = page if isinstance(page, dict) else {}
        page_questions = page.get("questions") if isinstance(page.get("questions"), list) else []
        page_image_url = page.get("uploadedImageUrl") if _is_http_url(page.get("uploadedImageUrl")) else ""

        for q in page_questions:
            q = q if isinstance(q, dict) else {}
            info = q.get("info") if isinstance(q.get("info"), dict) else {}
            primary_rect = _get_primary_rect(q)
            merged_image = q.get("mergedImage") or ""
            figures = info.get("figures") if isinstance(info.get("figures"), list) else []
            option_texts = info.get("optionTexts") if isinstance(info.get("optionTexts"), list) else []
            subquestion_texts = info.get("subquestionTexts") if isinstance(info.get("subquestionTexts"), list) else []

            crop_url = _build_crop_url(page_image_url, primary_rect)
            all_image_urls = [
                merged_image if _is_http_url(merged_image) else "",
                crop_url,
                *[u for u in figures if _is_http_url(u)],
            ]
            questions.append(
                {
                    "id": q.get("id") or "",
                    "no": int(q.get("no") or 0),
                    "type": q.get("type") or "",
                    "pageIndex": page_index,
                    "pageId": page.get("id") or f"page_{page_index + 1}",
                    "pageName": page.get("name") or f"第 {page_index + 1} 页",
                    "mergedImage": merged_image,
                    "stemText": info.get("stemText") or "",
                    "optionTexts": option_texts,
                    "subquestionTexts": subquestion_texts,
                    "figures": figures,
                    "fullText": info.get("fullText") or "",
                    "rects": q.get("rects") if isinstance(q.get("rects"), list) else [],
                    "primaryRect": primary_rect,
                    "questionImageUrl": merged_image if _is_http_url(merged_image) else crop_url,
                    "allImageUrls": [u for u in all_image_urls if u],
                }
            )

    image_stats = {"questionImageCount": 0, "figureImageCount": 0, "totalImageCount": 0}
    for q in questions:
        if q["questionImageUrl"]:
            image_stats["questionImageCount"] += 1
        image_stats["figureImageCount"] += len(q["figures"])
        image_stats["totalImageCount"] += len(q["allImageUrls"])

    return {
        "snapshotKey": "latest",
        "currentPageIndex": current_page_index,
        "pages": pages,
        "files": files,
        "questions": questions,
        "imageStats": image_stats,
        "totalPages": len(pages),
        "totalQuestions": len(questions),
        "updatedAt": int(time.time() * 1000),
    }


@router.post("/upload")
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """上传切题图片到 OSS，并写入上传记录。响应结构与参考项目 /api/upload/single 一致。"""
    if not is_oss_configured():
        raise HTTPException(status_code=500, detail="OSS 未配置。请设置 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET 环境变量")

    try:
        content = await file.read()
        result = await asyncio.to_thread(
            upload_image_to_oss,
            content,
            file.filename or "upload.jpg",
            file.content_type or "",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {e}")
    finally:
        await file.close()

    try:
        crud.create_upload_record(
            db,
            file_name=file.filename or "unnamed",
            file_type=file.content_type or "",
            file_size=len(content),
            uploaded_url=result.get("url", ""),
        )
    except Exception as e:  # 记录失败不影响上传主流程
        print(f"[qieti] save upload record failed: {e}")

    return result


@router.post("/cut")
async def cut(request: CutRequest):
    """切题识别：URL 先过 SSRF 校验，再调用 EduTutor。响应结构 {questions_data}。"""
    url = validate_public_url(request.question_image_url)
    return await cut_questions(url)


@router.post("/snapshot", response_model=SnapshotSaveResponse)
async def save_snapshot(payload: SnapshotPayload, db: Session = Depends(get_db)):
    """保存题库快照（单行覆盖，snapshot_key='latest'）。"""
    snapshot = _normalize_snapshot_payload(payload.model_dump())
    crud.upsert_snapshot(db, snapshot)
    return SnapshotSaveResponse(
        success=True,
        totalPages=snapshot["totalPages"],
        totalQuestions=snapshot["totalQuestions"],
        updatedAt=snapshot["updatedAt"],
    )


@router.get("/snapshot", response_model=SnapshotGetResponse)
async def get_snapshot(db: Session = Depends(get_db)):
    """读取最新题库快照。"""
    snapshot = crud.get_latest_snapshot(db)
    return SnapshotGetResponse(success=True, snapshot=snapshot)


@router.get("/records", response_model=RecordsResponse)
async def list_records(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    """分页查询上传记录（id 倒序，与原 createdAt 倒序等价）。"""
    limit = max(1, min(200, limit))
    offset = max(0, offset)
    records = crud.list_upload_records(db, limit=limit, offset=offset)
    return RecordsResponse(success=True, records=records)

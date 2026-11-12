"""Hermes Agent 登录鉴权与 OpenAI 兼容代理路由。"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from urllib.parse import quote

from database import get_db

from auth import get_current_user, get_current_userid
from conversations.crud import record_user_message
from conversations.service import stream_upstream_with_recording
from hermes.schemas import ChatCompletionRequest
from hermes.service import HermesError, get_models, open_chat_stream
from hermes.question_schemas import ImportQuestionBankRequest, QuestionBankResponse, CreatePaperRequest, PaperResponse, CreateExportRequest, ExportResponse
from hermes.question_bank_service import import_bank, get_bank, bank_response, create_paper, get_paper, paper_response
from hermes.export_service import create_export, get_export, export_path, as_export_response, MIME_TYPES, safe_filename

router = APIRouter(
    prefix="/api/hermes/v1",
    tags=["Hermes Agent"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/models")
async def models():
    try:
        return await get_models()
    except HermesError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/chat/completions")
async def chat_completions(
    payload: ChatCompletionRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_userid),
):
    try:
        client, response = await open_chat_stream(
            payload.model_dump(exclude_none=True)
        )
    except HermesError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # 后端权威落库：转发前落最后一条 user 消息（会话不存在时跳过，向后兼容）。
    if payload.conversation_id:
        last_user = next(
            (m for m in reversed(payload.messages) if m.role == "user"), None
        )
        if last_user:
            record_user_message(
                db,
                user_id=user_id,
                conversation_id=payload.conversation_id,
                content=last_user.content,
                model="hermes",
            )

    # 采集转发器：客户端断开（刷新/断线）不影响后端继续读完上游并落库。
    return stream_upstream_with_recording(
        client=client,
        response=response,
        user_id=user_id,
        conversation_id=payload.conversation_id,
        model="hermes",
    )


@router.post("/question-banks/import", response_model=QuestionBankResponse)
async def import_question_bank(payload: ImportQuestionBankRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return await import_bank(db, user.id, payload)


@router.get("/question-banks/{bank_id}", response_model=QuestionBankResponse)
def question_bank_detail(bank_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return bank_response(get_bank(db, bank_id, user.id))


@router.get("/question-banks/{bank_id}/download")
def download_question_bank(bank_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    bank = get_bank(db, bank_id, user.id)
    title = bank_response(bank).document.title
    filename = quote(safe_filename(title) + ".json")
    return Response(bank.payload_json, media_type="application/json", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"})


@router.post("/papers", response_model=PaperResponse)
def save_paper(payload: CreatePaperRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return create_paper(db, user.id, payload)


@router.get("/papers/{paper_id}", response_model=PaperResponse)
def paper_detail(paper_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return paper_response(get_paper(db, paper_id, user.id))


@router.post("/papers/{paper_id}/exports", response_model=ExportResponse)
def export_paper(paper_id: str, payload: CreateExportRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return create_export(db, user.id, get_paper(db, paper_id, user.id), payload.format)


@router.post("/papers/{paper_id}/exports/pdf", response_model=ExportResponse)
async def store_paper_pdf(paper_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    paper = get_paper(db, paper_id, user.id)
    data = await file.read(30 * 1024 * 1024 + 1)
    await file.close()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(413, "PDF 文件超过 30MB 上限")
    return await run_in_threadpool(create_export, db, user.id, paper, "pdf", data)


@router.get("/exports/{export_id}", response_model=ExportResponse)
def export_detail(export_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return as_export_response(get_export(db, export_id, user.id))


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    export = get_export(db, export_id, user.id)
    path = export_path(export)
    if export.status != "ready" or not path.is_file():
        raise HTTPException(404, "文件尚未就绪或已失效，请重新导出")
    return FileResponse(path, filename=export.filename, media_type=MIME_TYPES[export.format])

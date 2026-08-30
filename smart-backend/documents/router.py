import os
import re
import uuid
import shutil
import traceback
import pypandoc
import asyncio
import requests
from datetime import datetime
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, UploadFile, File, Request,Path
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, get_sync_db
from documents.models import FileRecord
from documents.schemas import FileUpdate, FileRecordResponse, FileRequestBody, ErrorResponse
from documents import crud
from utils.oss_upload import upload_to_oss, upload_url_to_oss, convert_md_to_docx
from users.sessions import get_session_user_id
from users.models import User
from auth import get_current_user
from documents.knowledge import process_knowledge_zip, _convert_tiff_to_png


router = APIRouter(prefix="/api/files", tags=["wenjianguanli"])

UPLOAD_DIR = "uploads"
ALLOWED_EXTENSIONS = {".docx", ".md", ".zip"}


def generate_timestamp():
    return datetime.now().strftime('%Y%m%d%H%M%S')


def _convert_word_to_md(file_path: str, timestamp: str) -> tuple[str, str | None]:
    """Word 文档转 Markdown，返回 (MD文件路径, 图片提取目录路径)。"""
    extract_dir = os.path.join(UPLOAD_DIR, f"media_{timestamp}")
    os.makedirs(extract_dir, exist_ok=True)

    md_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.md")
    # --wrap=none: 禁用自动换行，避免表格单元格内的图片引用被列符/换行拆碎
    # （否则 imageN.tiff 的 path 会被打散到多行，_transfer_images_to_oss 无法识别）
    pypandoc.convert_file(file_path, "md", outputfile=md_path,
                          extra_args=[f"--extract-media={extract_dir}", "--wrap=none"])
    return md_path, extract_dir


def _transfer_images_to_oss(md_content: str, md_dir: str, timestamp: str, extract_dir: str | None = None) -> tuple[str, list[str]]:
    """将 MD 内容中的图片转存到 OSS，返回替换后的内容和 OSS URL 列表。"""
    oss_image_urls = []
    local_image_map: dict[str, str] = {}
    if extract_dir:
        for root, _, files in os.walk(extract_dir):
            for fname in files:
                local_image_map[fname] = os.path.join(root, fname)

    def _upload_local_image(local_img: str) -> str | None:
        """上传本地图片到 OSS；.tiff/.tif 先无损转 .png 再上传。返回 OSS URL。"""
        fname = os.path.basename(local_img)
        ext = os.path.splitext(fname)[1].lower()
        if ext in (".tiff", ".tif"):
            png_path = _convert_tiff_to_png(local_img)
            if png_path:
                try:
                    png_fname = os.path.basename(png_path)
                    oss_key = f"images/{timestamp}/{png_fname}"
                    result = upload_to_oss(png_path, oss_key)
                    oss_image_urls.append(result["url"])
                    return result["url"]
                finally:
                    if os.path.exists(png_path):
                        os.remove(png_path)
        # 非 tiff，或转换失败时回落上传原文件
        oss_key = f"images/{timestamp}/{fname}"
        result = upload_to_oss(local_img, oss_key)
        oss_image_urls.append(result["url"])
        return result["url"]

    def _try_upload(src: str) -> str | None:
        if src.startswith("http://") or src.startswith("https://"):
            try:
                fname = os.path.basename(src.split("?")[0])
                oss_key = f"images/{timestamp}/{uuid.uuid4().hex}_{fname}"
                result = upload_url_to_oss(src, oss_key)
                oss_image_urls.append(result["url"])
                return result["url"]
            except Exception:
                return None

        fname = os.path.basename(src)
        if fname in local_image_map:
            return _upload_local_image(local_image_map[fname])

        if os.path.isabs(src) or src.startswith("./") or src.startswith("../"):
            local_img = os.path.join(md_dir, src) if not os.path.isabs(src) else src
            if os.path.isfile(local_img):
                return _upload_local_image(local_img)

        return None

    def replace_md_image(match):
        oss_url = _try_upload(match.group(2))
        return f"![{match.group(1)}]({oss_url})" if oss_url else match.group(0)

    md_content = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?', replace_md_image, md_content)

    def replace_img_tag(match):
        src_match = re.search(r'src="([^"]*)"', match.group(0))
        alt_match = re.search(r'alt="([^"]*)"', match.group(0))
        if not src_match:
            return match.group(0)
        oss_url = _try_upload(src_match.group(1))
        if not oss_url:
            return match.group(0)
        alt = alt_match.group(1) if alt_match else ""
        return f"![{alt}]({oss_url})"

    md_content = re.sub(r'<img\s[^>]*/?>', replace_img_tag, md_content, flags=re.DOTALL)

    def replace_figure(match):
        tag = match.group(0)
        src_match = re.search(r'src="([^"]*)"', tag)
        caption_match = re.search(r'<figcaption[^>]*><p>([^<]*)</p></figcaption>', tag)
        if not src_match:
            return tag
        oss_url = _try_upload(src_match.group(1))
        if not oss_url:
            return tag
        alt = caption_match.group(1) if caption_match else ""
        return f"![{alt}]({oss_url})"

    md_content = re.sub(r'<figure>.*?</figure>', replace_figure, md_content, flags=re.DOTALL)
    md_content = re.sub(r'</?figure[^>]*>', '', md_content)
    md_content = re.sub(r'<figcaption[^>]*>.*?</figcaption>', '', md_content, flags=re.DOTALL)
    md_content = re.sub(r'\n{3,}', '\n\n', md_content)

    return md_content, oss_image_urls


def _save_upload_file(file: UploadFile, file_path: str) -> int:
    """分片保存上传文件，返回文件大小。"""
    total_size = 0
    with open(file_path, "wb") as f:
        while True:
            chunk = file.file.read(1024 * 1024)  # 1MB 分片
            if not chunk:
                break
            f.write(chunk)
            total_size += len(chunk)
    return total_size


def _process_docx_md(file_path: str, ext: str, original_name: str, base_name: str, timestamp: str, uid: str | None) -> dict:
    """同步处理 docx/md 文件上传，完成后清理本地临时文件。"""
    db = get_sync_db()
    md_path = file_path
    extract_dir = None
    file_size = 0

    try:
        file_size = os.path.getsize(file_path)

        # 1. 上传源文件到 OSS
        saved_name = os.path.basename(file_path)
        oss_source_key = f"files/{timestamp}/{saved_name}"
        oss_source_result = upload_to_oss(file_path, oss_source_key)
        oss_source_url = oss_source_result["url"]

        # 2. 按类型处理
        oss_md_url = None
        oss_word_url = None
        oss_images = None

        if ext in (".doc", ".docx"):
            md_path, extract_dir = _convert_word_to_md(file_path, timestamp)
            oss_word_url = oss_source_url
        else:
            with open(md_path, "r", encoding="utf-8") as f:
                raw_md_content = f.read()
            word_result = convert_md_to_docx(raw_md_content, f"{base_name}.docx")
            oss_word_url = word_result["url"]

        # 3. 图片转存 OSS + 替换引用
        with open(md_path, "r", encoding="utf-8") as f:
            md_content = f.read()

        md_content, oss_image_urls = _transfer_images_to_oss(md_content, os.path.dirname(md_path), timestamp, extract_dir)

        # 4. 上传处理后的 MD 到 OSS
        processed_md_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.md")
        with open(processed_md_path, "w", encoding="utf-8") as f:
            f.write(md_content)

        md_filename = f"{base_name}.md"
        oss_md_key = f"markdown/{timestamp}/{md_filename}"
        oss_md_result = upload_to_oss(processed_md_path, oss_md_key)
        oss_md_url = oss_md_result["url"]

        if processed_md_path != md_path and os.path.exists(processed_md_path):
            os.remove(processed_md_path)

        oss_images = ",".join(oss_image_urls) if oss_image_urls else None

        # 5. 写数据库
        record = crud.create_file_record(
            db=db,
            original_name=original_name,
            saved_name=saved_name,
            file_path=file_path,
            file_size=file_size,
            download_url=oss_md_url,
            uid=uid,
            md_file_path=md_path,
            md_download_url=oss_md_url,
            oss_md_url=oss_md_url,
            oss_word_url=oss_word_url,
            oss_images=oss_images,
        )

        return {
            "status": "ok",
            "data": {
                "id": record.id,
                "filename": md_filename,
                "uid": uid,
                "oss_word_url": oss_word_url,
                "oss_md_url": oss_md_url,
            },
        }

    except Exception:
        traceback.print_exc()
        return {"status": "error", "data": {"filename": original_name, "download_url": None}}

    finally:
        db.close()
        # 清理本地临时文件
        if os.path.exists(file_path):
            os.remove(file_path)
        if md_path and md_path != file_path and os.path.exists(md_path):
            os.remove(md_path)
        if extract_dir and os.path.exists(extract_dir):
            shutil.rmtree(extract_dir, ignore_errors=True)


@router.post("/upload", operation_id="uploadFileApiFilesUploadPost")
async def upload_file(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                      mock_token: str | None = Cookie(None)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext == ".doc":
        return {"status": "error", "data": {"filename": file.filename, "download_url": None},
                "errorMessage": "不支持 .doc 格式，请将文件另存为 .docx 后重新上传"}
    if ext not in ALLOWED_EXTENSIONS:
        return {"status": "error", "data": {"filename": file.filename, "download_url": None},
                "errorMessage": f"不支持的文件格式 {ext}，仅支持 .docx / .md / .zip"}

    # 获取登录用户 uid
    uid = None
    user_id = get_session_user_id(db, mock_token)
    if user_id is not None:
        user = db.query(User).filter_by(id=user_id).first()
        if user:
            uid = user.userid

    original_name = file.filename
    base_name = os.path.splitext(original_name)[0]
    timestamp = generate_timestamp()
    saved_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, saved_name)

    # 分片保存上传文件到本地
    try:
        file_size = _save_upload_file(file, file_path)
    except Exception:
        traceback.print_exc()
        return {"status": "error", "data": {"filename": original_name, "download_url": None}}

    # zip 文件处理分支
    if ext == ".zip":
        try:
            result = await asyncio.to_thread(process_knowledge_zip, file_path, original_name, uid, get_sync_db)
        finally:
            if os.path.exists(file_path):
                os.remove(file_path)
        return result

    # docx/md 分支：耗时操作放入线程池
    return await asyncio.to_thread(
        _process_docx_md, file_path, ext, original_name, base_name, timestamp, uid
    )


@router.get("", responses={401: {"model": ErrorResponse}}, operation_id="listFilesApiFilesGet")
def list_files(
    current: float = Query(1, description="当前的页码"),
    pageSize: float = Query(10, description="页面的容量"),
    original_name: str | None = Query(None, description="文件名称（模糊搜索）"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 只返回当前登录用户自己上传的文件（未登录由 get_current_user 抛 401）
    return crud.get_file_records(db, int(current), int(pageSize),
                                original_name=original_name,
                                uid_filter=current_user.userid)


@router.post("", responses={401: {"model": ErrorResponse}}, operation_id="handleFileApiFilesPost")
def handle_file(body: FileRequestBody, db: Session = Depends(get_db)):
    method = body.method
    data = body.data or {}

    if method == "update":
        file_id = data.get("id")
        if file_id is None:
            return {"success": False, "errorMessage": "缺少文件ID"}
        update_data = {}
        if "original_name" in data:
            update_data["original_name"] = data["original_name"]
        record = crud.update_file_record(db, int(file_id), FileUpdate(**update_data))
        if not record:
            return {"success": False, "errorMessage": "文件不存在"}
        return crud._to_dict(record)

    elif method == "delete":
        ids = data.get("id", data.get("key", []))
        if isinstance(ids, int):
            ids = [ids]
        crud.delete_file_records(db, [int(i) for i in ids])
        return {}

    return {}


@router.get("/download/{saved_name}")
def download_file(saved_name: str, db: Session = Depends(get_db)):
    record = db.query(FileRecord).filter(FileRecord.saved_name == saved_name).first()
    file_path = os.path.join(UPLOAD_DIR, saved_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    original_name = record.original_name if record else saved_name
    return FileResponse(file_path, filename=original_name)


@router.get("/download-md/{md_saved_name}")
def download_md_file(md_saved_name: str, db: Session = Depends(get_db)):
    record = db.query(FileRecord).filter(FileRecord.md_file_path.contains(md_saved_name)).first()
    md_path = os.path.join(UPLOAD_DIR, md_saved_name)
    if not os.path.exists(md_path):
        raise HTTPException(status_code=404, detail="Markdown文件不存在")
    original_name = os.path.splitext(record.original_name)[0] + ".md" if record else md_saved_name
    return FileResponse(md_path, filename=original_name)


# @router.get("/file/{file_id}/download")
# def get_download_url( file_id: int = Path(..., description="文件ID"), db: Session = Depends(get_db)):
#     record = crud.get_file_record(db, file_id)
#     if not record:
#         raise HTTPException(status_code=404, detail="文件不存在")
#     return {
#         "id": record.id,
#         "original_name": record.original_name,
#         "oss_word_url": record.oss_word_url,
#         "oss_md_url": record.oss_md_url,
#     }


# 1. 路径中的 {file_id} 改为 {fileId}
# 2. 加上 operation_id 锁定前端函数名
@router.get("/file/{fileId}/download", operation_id="getDownloadUrl")
def get_download_url( 
    # 3. 参数名改为 fileId
    fileId: int = Path(..., description="文件ID"), 
    db: Session = Depends(get_db)
):
    record = crud.get_file_record(db, fileId) # 4. 内部调用也同步修改
    if not record:
        raise HTTPException(status_code=404, detail="文件不存在")
    return {
        "id": record.id,
        "original_name": record.original_name,
        "oss_word_url": record.oss_word_url,
        "oss_md_url": record.oss_md_url,
    }


# ================= MinerU 上传接口 =================
MINERU_ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".md"}


def _process_mineru_upload(file_path: str, ext: str, original_name: str,
                           timestamp: str, uid: str | None) -> dict:
    """上传文件到 OSS → 提交 MinerU 任务 → 保存 FileRecord。"""
    from mineru.service import submit_task_to_mineru

    db = get_sync_db()
    try:
        file_size = os.path.getsize(file_path)
        saved_name = os.path.basename(file_path)

        # 1. 上传源文件到 OSS 获取公开 URL
        oss_key = f"mineru/{timestamp}/{saved_name}"
        oss_result = upload_to_oss(file_path, oss_key)
        oss_url = oss_result["url"]

        # 2. 提交 MinerU 任务
        mineru_result = submit_task_to_mineru(oss_url)
        task_id = mineru_result["task_id"]

        # 3. 保存 FileRecord
        record = crud.create_file_record(
            db=db,
            original_name=original_name,
            saved_name=saved_name,
            file_path=file_path,
            file_size=file_size,
            download_url=oss_url,
            uid=uid,
            mineru_task_id=task_id,
            mineru_state="submitted",
        )

        return {
            "status": "ok",
            "data": {
                "id": record.id,
                "filename": original_name,
                "uid": uid,
                "mineru_task_id": task_id,
                "mineru_state": "submitted",
                "oss_url": oss_url,
            },
        }

    except Exception:
        traceback.print_exc()
        return {"status": "error", "data": {"filename": original_name, "download_url": None}}
    finally:
        db.close()
        if os.path.exists(file_path):
            os.remove(file_path)


@router.post("/mineru/upload")
async def mineru_upload_file(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    mock_token: str | None = Cookie(None),
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in MINERU_ALLOWED_EXTENSIONS:
        return {
            "status": "error",
            "data": {"filename": file.filename, "download_url": None},
            "errorMessage": f"MinerU 不支持的文件格式 {ext}，仅支持 .pdf / .docx / .doc / .md",
        }

    uid = None
    user_id = get_session_user_id(db, mock_token)
    if user_id is not None:
        user = db.query(User).filter_by(id=user_id).first()
        if user:
            uid = user.userid

    original_name = file.filename
    timestamp = generate_timestamp()
    saved_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, saved_name)

    try:
        _save_upload_file(file, file_path)
    except Exception:
        traceback.print_exc()
        return {"status": "error", "data": {"filename": original_name, "download_url": None}}

    return await asyncio.to_thread(
        _process_mineru_upload, file_path, ext, original_name, timestamp, uid
    )
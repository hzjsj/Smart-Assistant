import math
import os
from datetime import datetime
from sqlalchemy.orm import Session
from documents.models import FileRecord
from documents.schemas import FileUpdate


def _format_date(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _to_dict(record: FileRecord) -> dict:
    return {
        "id": record.id,
        "original_name": record.original_name,
        "saved_name": record.saved_name,
        "file_path": record.file_path,
        "file_size": record.file_size,
        "download_url": record.download_url,
        "uid": record.uid,
        "md_file_path": record.md_file_path,
        "md_download_url": record.md_download_url,
        "oss_md_url": record.oss_md_url,
        "oss_word_url": record.oss_word_url,
        "oss_images": record.oss_images,
        "zip_source": record.zip_source,
        "mineru_task_id": record.mineru_task_id,
        "mineru_state": record.mineru_state,
        "mineru_zip_url": record.mineru_zip_url,
        "created_at": _format_date(record.created_at),
    }


def _to_file_list(items: list[FileRecord], total: int) -> dict:
    return {
        "data": [_to_dict(r) for r in items],
        "total": total,
        "success": True,
    }


def create_file_record(db: Session, original_name: str, saved_name: str,
                       file_path: str, file_size: int, download_url: str,
                       uid: str = None, md_file_path: str = None,
                       md_download_url: str = None, oss_md_url: str = None,
                       oss_word_url: str = None, oss_images: str = None,
                       zip_source: str = None, mineru_task_id: str = None,
                       mineru_state: str = None,
                       mineru_zip_url: str = None) -> FileRecord:
    record = FileRecord(
        original_name=original_name,
        saved_name=saved_name,
        file_path=file_path,
        file_size=file_size,
        download_url=download_url,
        uid=uid,
        md_file_path=md_file_path,
        md_download_url=md_download_url,
        oss_md_url=oss_md_url,
        oss_word_url=oss_word_url,
        oss_images=oss_images,
        zip_source=zip_source,
        mineru_task_id=mineru_task_id,
        mineru_state=mineru_state,
        mineru_zip_url=mineru_zip_url,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_file_record(db: Session, file_id: int) -> FileRecord | None:
    return db.query(FileRecord).filter(FileRecord.id == file_id).first()


def get_file_records(db: Session, page: int = 1, page_size: int = 10,
                     original_name: str | None = None,
                     uid: str | None = None,
                     uid_filter: str | None = None) -> dict:
    query = db.query(FileRecord)
    if original_name:
        query = query.filter(FileRecord.original_name.ilike(f"%{original_name}%"))
    if uid:
        query = query.filter(FileRecord.uid.ilike(f"%{uid}%"))
    if uid_filter:
        query = query.filter(FileRecord.uid == uid_filter)
    total = query.count()
    offset = (page - 1) * page_size
    items = query.order_by(FileRecord.id.desc()).offset(offset).limit(page_size).all()
    return _to_file_list(items, total)


def update_file_record(db: Session, file_id: int, data: FileUpdate) -> FileRecord | None:
    record = get_file_record(db, file_id)
    if not record:
        return None
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(record, field, value)
    db.commit()
    db.refresh(record)
    return record


def delete_file_records(db: Session, file_ids: list[int]) -> int:
    records = db.query(FileRecord).filter(FileRecord.id.in_(file_ids)).all()
    for record in records:
        if os.path.exists(record.file_path):
            os.remove(record.file_path)
        if record.md_file_path and os.path.exists(record.md_file_path):
            os.remove(record.md_file_path)
    count = db.query(FileRecord).filter(FileRecord.id.in_(file_ids)).delete(synchronize_session=False)
    db.commit()
    return count


def get_file_record_by_mineru_task_id(db: Session, task_id: str) -> FileRecord | None:
    return db.query(FileRecord).filter(FileRecord.mineru_task_id == task_id).first()


def update_file_record_mineru(db: Session, file_id: int, *,
                              mineru_state: str = None,
                              mineru_zip_url: str = None,
                              oss_md_url: str = None,
                              oss_word_url: str = None,
                              oss_images: str = None,
                              download_url: str = None,
                              md_download_url: str = None) -> FileRecord | None:
    record = db.query(FileRecord).filter(FileRecord.id == file_id).first()
    if not record:
        return None
    if mineru_state is not None:
        record.mineru_state = mineru_state
    if mineru_zip_url is not None:
        record.mineru_zip_url = mineru_zip_url
    if oss_md_url is not None:
        record.oss_md_url = oss_md_url
    if oss_word_url is not None:
        record.oss_word_url = oss_word_url
    if oss_images is not None:
        record.oss_images = oss_images
    if download_url is not None:
        record.download_url = download_url
    if md_download_url is not None:
        record.md_download_url = md_download_url
    db.commit()
    db.refresh(record)
    return record

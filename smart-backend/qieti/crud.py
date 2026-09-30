"""切题模块数据库操作。"""
import json

from sqlalchemy.orm import Session

from qieti.models import QietiSnapshot, QietiUploadRecord

SNAPSHOT_KEY_LATEST = "latest"


def create_upload_record(
    db: Session,
    file_name: str,
    file_type: str,
    file_size: int,
    uploaded_url: str,
) -> QietiUploadRecord:
    record = QietiUploadRecord(
        file_name=file_name,
        file_type=file_type,
        file_size=file_size,
        uploaded_url=uploaded_url,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_upload_records(db: Session, limit: int = 50, offset: int = 0) -> list[dict]:
    rows = (
        db.query(QietiUploadRecord)
        .order_by(QietiUploadRecord.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {
            "id": row.id,
            "fileName": row.file_name,
            "fileType": row.file_type,
            "fileSize": row.file_size,
            "uploadedUrl": row.uploaded_url,
            "createdAt": int(row.created_at.timestamp() * 1000) if row.created_at else None,
        }
        for row in rows
    ]


def upsert_snapshot(db: Session, snapshot: dict) -> QietiSnapshot:
    """按 snapshot_key='latest' 单行覆盖写入。"""
    row = (
        db.query(QietiSnapshot)
        .filter(QietiSnapshot.snapshot_key == SNAPSHOT_KEY_LATEST)
        .first()
    )
    payload_text = json.dumps(snapshot, ensure_ascii=False)
    if row:
        row.payload = payload_text
        row.total_pages = snapshot.get("totalPages", 0)
        row.total_questions = snapshot.get("totalQuestions", 0)
    else:
        row = QietiSnapshot(
            snapshot_key=SNAPSHOT_KEY_LATEST,
            payload=payload_text,
            total_pages=snapshot.get("totalPages", 0),
            total_questions=snapshot.get("totalQuestions", 0),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_latest_snapshot(db: Session) -> dict | None:
    row = (
        db.query(QietiSnapshot)
        .filter(QietiSnapshot.snapshot_key == SNAPSHOT_KEY_LATEST)
        .first()
    )
    if not row:
        return None
    try:
        return json.loads(row.payload)
    except (json.JSONDecodeError, TypeError):
        return None

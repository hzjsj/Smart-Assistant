"""切题模块数据库操作（数据按 uid 隔离，见 todo 第 4/19 条）。"""
import json

from sqlalchemy.orm import Session

from qieti.models import QietiSnapshot, QietiUploadRecord

# 历史遗留的全局快照键（新写入一律用 latest:<uid>，旧行不再读写）
SNAPSHOT_KEY_LATEST = "latest"


def snapshot_key_for(uid: str | None) -> str:
    """用户的快照键。uid 为空（不应发生，路由层强制登录）回落到历史键。"""
    return f"latest:{uid}" if uid else SNAPSHOT_KEY_LATEST


def create_upload_record(
    db: Session,
    file_name: str,
    file_type: str,
    file_size: int,
    uploaded_url: str,
    uid: str | None = None,
) -> QietiUploadRecord:
    record = QietiUploadRecord(
        uid=uid,
        file_name=file_name,
        file_type=file_type,
        file_size=file_size,
        uploaded_url=uploaded_url,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_upload_records(
    db: Session, limit: int = 50, offset: int = 0, uid: str | None = None
) -> list[dict]:
    """分页查询上传记录：传 uid 时仅返回该用户的记录（时间倒序）。"""
    query = db.query(QietiUploadRecord)
    if uid:
        query = query.filter(QietiUploadRecord.uid == uid)
    rows = (
        query.order_by(QietiUploadRecord.id.desc())
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


def upsert_snapshot(
    db: Session, snapshot: dict, snapshot_key: str, uid: str | None = None
) -> QietiSnapshot:
    """按 snapshot_key 单行覆盖写入（每个用户一个键）。"""
    row = (
        db.query(QietiSnapshot)
        .filter(QietiSnapshot.snapshot_key == snapshot_key)
        .first()
    )
    payload_text = json.dumps(snapshot, ensure_ascii=False)
    if row:
        row.payload = payload_text
        row.uid = uid
        row.total_pages = snapshot.get("totalPages", 0)
        row.total_questions = snapshot.get("totalQuestions", 0)
    else:
        row = QietiSnapshot(
            snapshot_key=snapshot_key,
            uid=uid,
            payload=payload_text,
            total_pages=snapshot.get("totalPages", 0),
            total_questions=snapshot.get("totalQuestions", 0),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_snapshot(db: Session, snapshot_key: str) -> dict | None:
    row = (
        db.query(QietiSnapshot)
        .filter(QietiSnapshot.snapshot_key == snapshot_key)
        .first()
    )
    if not row:
        return None
    try:
        return json.loads(row.payload)
    except (json.JSONDecodeError, TypeError):
        return None

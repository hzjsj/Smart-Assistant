"""documents 侧的 MinerU 上传处理管线（Phase D 从 router.py 下沉）。

依赖方向收敛为 documents → mineru（单向）：
- 本模块编排「OSS 上传 → 提交 MinerU 任务 → 保存 FileRecord」；
- mineru/proxy.py（Open WebUI 网关）改为引用本模块，不再依赖
  documents.router 内部函数，解除 documents ↔ mineru 的模块级循环依赖。
"""

import os
import traceback

from database import get_sync_db
from documents import crud
from mineru import batch as mineru_batch
from mineru.service import submit_task_to_mineru
from utils.oss_upload import upload_to_oss


def process_mineru_upload(file_path: str, ext: str, original_name: str,
                          timestamp: str, uid: str | None) -> dict:
    """上传文件到 OSS → 提交 MinerU 任务 → 保存 FileRecord。"""
    db = get_sync_db()
    try:
        file_size = os.path.getsize(file_path)
        saved_name = os.path.basename(file_path)

        # 0. 超限（>200MB 或 >200 页）PDF：拆分后走批量上传流程，对外行为不变
        if mineru_batch.needs_split(file_path, ext):
            parts_dir = os.path.join(os.path.dirname(file_path), f"parts_{timestamp}")
            parts = mineru_batch.split_pdf(file_path, parts_dir)
            batch_id, upload_urls = mineru_batch.create_batch_upload_task(
                [os.path.basename(p) for p in parts]
            )
            for upload_url, part in zip(upload_urls, parts):
                mineru_batch.upload_part(upload_url, part)
            record = crud.create_file_record(
                db=db,
                original_name=original_name,
                saved_name=saved_name,
                file_path=file_path,
                file_size=file_size,
                download_url="",
                uid=uid,
                mineru_batch_id=batch_id,
                mineru_state="submitted",
            )
            print(f"[MinerU] 超限文件已拆分为 {len(parts)} 片批量提交, batch_id={batch_id}")
            return {
                "status": "ok",
                "data": {
                    "id": record.id,
                    "filename": original_name,
                    "uid": uid,
                    "mineru_batch_id": batch_id,
                    "mineru_state": "submitted",
                    "oss_url": None,
                },
            }

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

    except Exception as e:
        traceback.print_exc()
        return {"status": "error", "data": {"filename": original_name, "download_url": None}, "errorMessage": str(e)}
    finally:
        db.close()
        if os.path.exists(file_path):
            os.remove(file_path)

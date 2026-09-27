"""切题模块外部服务：阿里云 OSS 题图存储 + 阿里云 EduTutor 切题识别。

切题识别移植自参考项目 20260820project_GfrGj（timu/cut_questions.py），
AK/SK 从硬编码改为环境变量注入；题图存储复用本项目 utils/oss_upload.py
（读 OSS_* 环境变量，公共读桶直接拼公网 URL）。
"""
import asyncio
import json
import os
from datetime import datetime

from fastapi import HTTPException


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key) or default).strip()


# ─── 阿里云 OSS（题图对象存储，桶 kdsa / cn-shanghai，公共读）────────────

def is_oss_configured() -> bool:
    return bool(_env("OSS_BUCKET") and _env("OSS_ACCESS_KEY_ID") and _env("OSS_ACCESS_KEY_SECRET"))


def _build_object_key(filename: str) -> str:
    """对象键：qieti/<YYYYMMDDHHMMSS>/<原文件名>（kdsa 为多功能共享桶，qieti 前缀区分归属）。"""
    safe_name = os.path.basename(filename or "upload.jpg").replace("\\", "/").strip() or "upload.jpg"
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"qieti/{timestamp}/{safe_name}"


def upload_image_to_oss(content: bytes, filename: str, content_type: str = "") -> dict:
    """上传图片字节流到 OSS，返回 {success, filename, content_type, size, message, url}。

    同步实现（复用 utils/oss_upload 的 v2 客户端），由 router 用 asyncio.to_thread 调用。
    """
    if not is_oss_configured():
        raise HTTPException(
            status_code=500,
            detail="OSS 未配置。请设置 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET 环境变量",
        )

    from utils.oss_upload import upload_bytes_to_oss

    object_key = _build_object_key(filename)
    try:
        result = upload_bytes_to_oss(content, object_key)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OSS 上传失败: {e}")

    return {
        "success": True,
        "filename": filename,
        "content_type": content_type,
        "size": len(content),
        "message": "File uploaded successfully",
        "url": result["url"],
    }


# ─── 阿里云 EduTutor（切题识别）────────────────────────────────────────

def is_edututor_configured() -> bool:
    return bool(
        _env("ALIBABA_CLOUD_ACCESS_KEY_ID") and _env("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
    )


async def cut_questions(question_image_url: str) -> dict:
    """调用 EduTutor 切题接口，返回 {questions_data: {...}}。

    请求/响应结构与参考项目 /api/service/cutApi 保持一致：
    入参 image=url，struct=True + extract_images=True，read_timeout=100s；
    resp.body.code == 'SUCCESS' 时解析 body.data（JSON 字符串）。
    """
    if not is_edututor_configured():
        raise HTTPException(
            status_code=500,
            detail="EduTutor 未配置。请设置 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET 环境变量",
        )

    from alibabacloud_edututor20250707.client import Client as EduTutorClient
    from alibabacloud_edututor20250707 import models as edu_models
    from alibabacloud_tea_openapi import models as open_api_models
    from alibabacloud_tea_util import models as util_models

    config = open_api_models.Config(
        access_key_id=_env("ALIBABA_CLOUD_ACCESS_KEY_ID"),
        access_key_secret=_env("ALIBABA_CLOUD_ACCESS_KEY_SECRET"),
    )
    config.endpoint = _env("EDUTUTOR_ENDPOINT", "edututor.cn-hangzhou.aliyuncs.com")
    workspace_id = _env("EDUTUTOR_WORKSPACE_ID", "llm-5tl2i6iigxxczoc1")

    client = EduTutorClient(config)
    request = edu_models.CutQuestionsRequest(
        image=question_image_url,
        parameters=edu_models.CutQuestionsRequestParameters(
            struct=True,       # 返回结构化信息（题干/选项/小题/插图）
            extract_images=True,  # 返回子题临时图片链接
        ),
        workspace_id=workspace_id,
    )
    runtime = util_models.RuntimeOptions(read_timeout=1000 * 100)

    try:
        resp = await client.cut_questions_with_options_async(request, {}, runtime)
    except Exception as e:
        message = getattr(e, "message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"切题识别失败: {message}")

    if resp.body is None or resp.body.code != "SUCCESS":
        code = getattr(resp.body, "code", None) or "UNKNOWN"
        raise HTTPException(status_code=502, detail=f"切题识别返回失败: {code}")

    try:
        questions_data = json.loads(resp.body.data)
    except (json.JSONDecodeError, TypeError) as e:
        raise HTTPException(status_code=502, detail=f"切题识别结果解析失败: {e}")

    return {"questions_data": questions_data}

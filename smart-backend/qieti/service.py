"""切题模块外部服务：火山引擎 TOS 上传 + 阿里云 EduTutor 切题识别。

移植自参考项目 20260820project_GfrGj（volcengine/upload_file_tos.py 与
timu/cut_questions.py），AK/SK 从硬编码改为环境变量注入。
"""
import asyncio
import json
import os
from datetime import datetime

from fastapi import HTTPException


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key) or default).strip()


# ─── 火山引擎 TOS（题图对象存储）────────────────────────────────────────

def is_tos_configured() -> bool:
    return bool(_env("TOS_AK") and _env("TOS_SK"))


def _build_object_key(filename: str) -> str:
    """对象键：uploads/<YYYYMMDDHHMMSS>/<原文件名>（参考项目的时间戳目录约定）。"""
    safe_name = os.path.basename(filename or "upload.jpg").replace("\\", "/").strip() or "upload.jpg"
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"uploads/{timestamp}/{safe_name}"


def upload_image_to_tos(content: bytes, filename: str, content_type: str = "") -> dict:
    """上传图片字节流到 TOS，返回 {success, filename, content_type, size, message, url}。

    同步实现（TOS SDK 为同步客户端），由 router 用 asyncio.to_thread 调用。
    """
    if not is_tos_configured():
        raise HTTPException(
            status_code=500,
            detail="TOS 未配置。请设置 TOS_AK / TOS_SK 环境变量",
        )

    import tos  # 延迟导入：未安装/未配置不影响其他模块启动

    ak = _env("TOS_AK")
    sk = _env("TOS_SK")
    endpoint = _env("TOS_ENDPOINT", "tos-cn-beijing.volces.com")
    region = _env("TOS_REGION", "cn-beijing")
    bucket = _env("TOS_BUCKET", "hwwh")
    bucket_domain = _env("TOS_BUCKET_DOMAIN", f"https://{bucket}.{endpoint}")

    object_key = _build_object_key(filename)
    try:
        client = tos.TosClientV2(ak, sk, endpoint, region)
        client.put_object(bucket, object_key, content=content)
    except tos.exceptions.TosServerError as e:
        raise HTTPException(status_code=502, detail=f"TOS 服务端错误: {e.message} (request_id={e.request_id})")
    except tos.exceptions.TosClientError as e:
        raise HTTPException(status_code=502, detail=f"TOS 客户端错误: {e.message}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TOS 上传失败: {e}")

    return {
        "success": True,
        "filename": filename,
        "content_type": content_type,
        "size": len(content),
        "message": "File uploaded successfully",
        "url": f"{bucket_domain}/{object_key}",
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

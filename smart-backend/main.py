import os
import sys
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from users.models import User, UserSession
from chat.models import ChatSession, ChatMessage
from documents.models import FileRecord
from generate_test_paper.models import Exam, CourseType, KnowledgePoint, QuestionType
from qieti.models import QietiUploadRecord, QietiSnapshot
from users.router import router as users_router
from chat.router import router as chat_router
from documents.router import router as documents_router
from oss.router import router as oss_router
from mineru.router import router as mineru_router
from generate_test_paper.router import router as generate_test_paper_router
from qieti.router import router as qieti_router
from shuban.router import router as shuban_router
from mineru.proxy import router as mineru_proxy_router
# hermes 页面迁移：会话持久化 + 四模型对话代理
from conversations.models import Conversation, ConversationMessage
from hermes.models import HermesQuestionBank, HermesPaper, HermesExport
from conversations.router import router as conversations_router
from hermes.router import router as hermes_router
from deepseek.router import router as deepseek_router
from dify.router import router as dify_router
from bailian.router import router as bailian_router
from langchain_agent.router import router as langchain_agent_router
from openclaw.router import router as openclaw_router
from wecom.router import router as wecom_router
from utils.schema_upgrade import ensure_column, ensure_index

Base.metadata.create_all(bind=engine)

# 轻量幂等结构升级（无 Alembic 阶段兜底，见 ARCHITECTURE.md 路线图 Phase B / todo 4+7+19）：
# qieti 两表补 uid 列 + 上传记录表补 (uid, created_at) 复合索引
ensure_column(
    engine, "qieti_upload_records", "uid",
    "ALTER TABLE qieti_upload_records ADD COLUMN uid VARCHAR(50) NULL COMMENT '上传用户 userid（历史遗留行为 NULL）'",
)
ensure_index(
    engine, "qieti_upload_records", "ix_qieti_upload_uid_created",
    "ALTER TABLE qieti_upload_records ADD INDEX ix_qieti_upload_uid_created (uid, created_at)",
)
ensure_column(
    engine, "qieti_snapshots", "uid",
    "ALTER TABLE qieti_snapshots ADD COLUMN uid VARCHAR(50) NULL COMMENT '快照属主 userid（历史遗留行为 NULL）'",
)

# 上传文件临时目录（转换前的本地暂存）
os.makedirs("uploads", exist_ok=True)

# 首次启动自动写入默认账号（幂等：已有用户则跳过）。
try:
    from seed import seed

    seed()
except Exception as e:  # pragma: no cover - 启动期不阻断
    print(f"[startup] seed failed: {e}")

# 清理过期会话僵尸行（todo 第 13 条：不活跃用户的过期行在登录时不会被顺带清理）
try:
    from database import SessionLocal
    from users.sessions import cleanup_expired_sessions

    _db = SessionLocal()
    try:
        _removed = cleanup_expired_sessions(_db)
        if _removed:
            print(f"[startup] 清理过期会话 {_removed} 条")
    finally:
        _db.close()
except Exception as e:  # pragma: no cover - 启动期不阻断
    print(f"[startup] cleanup sessions failed: {e}")

# OpenAPI 文档门禁：默认开启（开发/联调依赖 /docs 与 /openapi.json），
# 生产部署设 API_DOCS_ENABLED=false 同时关闭 docs/redoc/openapi 三个入口（todo 第 12 条）
_api_docs_enabled = os.getenv("API_DOCS_ENABLED", "true").lower() == "true"

app = FastAPI(
    title="智能助手接口文档",
    version="1.0.0",
    docs_url="/docs" if _api_docs_enabled else None,
    redoc_url="/redoc" if _api_docs_enabled else None,
    openapi_url="/openapi.json" if _api_docs_enabled else None,
)

# CORS 白名单：显式列出来源。禁止 allow_origins=["*"] 与 allow_credentials=True
# 同时使用（Starlette 会回显任意 Origin，任何网站都能携带 Cookie 调用 API）。
# 开发默认放行本机前端；生产通过 env CORS_ALLOW_ORIGINS 配置正式域名（逗号分隔）。
_cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOW_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router)
app.include_router(chat_router)
app.include_router(documents_router)
app.include_router(oss_router)
app.include_router(mineru_router)
app.include_router(generate_test_paper_router)
app.include_router(qieti_router)
app.include_router(shuban_router)
app.include_router(mineru_proxy_router)
app.include_router(conversations_router)
app.include_router(hermes_router)
app.include_router(deepseek_router)
app.include_router(dify_router)
app.include_router(bailian_router)
app.include_router(langchain_agent_router)
app.include_router(openclaw_router)
app.include_router(wecom_router)

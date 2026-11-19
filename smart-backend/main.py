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

Base.metadata.create_all(bind=engine)

# 上传文件临时目录（转换前的本地暂存）
os.makedirs("uploads", exist_ok=True)

# 首次启动自动写入默认账号（幂等：已有用户则跳过）。
try:
    from seed import seed

    seed()
except Exception as e:  # pragma: no cover - 启动期不阻断
    print(f"[startup] seed failed: {e}")

app = FastAPI(title="智能助手接口文档", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

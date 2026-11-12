"""Local integration fixture: isolated SQLite and simulated upstream, never production auth."""

import asyncio
import json
import os
from pathlib import Path
from types import SimpleNamespace

PORT = int(os.getenv("HERMES_TEST_PORT", "6061"))
os.environ["HERMES_AGENT_BASE_URL"] = f"http://127.0.0.1:{PORT}/v1"
os.environ["HERMES_AGENT_API_KEY"] = "workspace-integration-test"
os.environ["HERMES_ARTIFACT_ALLOWED_HOSTS"] = "127.0.0.1"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from auth import get_current_user
from database import get_db
from hermes import export_service
from hermes.models import HermesQuestionBank, HermesPaper, HermesExport
from hermes.router import router
from hermes.tests.test_workspace import DOCUMENT

ROOT = Path(__file__).parent / ".artifacts"
ROOT.mkdir(exist_ok=True)
export_service.STORAGE_DIR = ROOT / "exports"
engine = create_engine(f"sqlite:///{ROOT / 'integration.db'}", connect_args={"check_same_thread": False})
for model in (HermesQuestionBank, HermesPaper, HermesExport):
    model.__table__.create(engine, checkfirst=True)
sessions = sessionmaker(bind=engine)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:8002", "http://localhost:8000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
UPSTREAM_REQUESTS = []

def session():
    with sessions() as db:
        yield db

app.dependency_overrides[get_db] = session


@app.get("/api/currentUser")
def current_user():
    return {"data": {"userid": "workspace-fixture", "name": "组卷集成验证", "access": "admin"}}


@app.get("/artifacts/bank.json")
def bank_document():
    return DOCUMENT


@app.post("/v1/chat/completions")
async def simulated_upstream(payload: dict):
    UPSTREAM_REQUESTS.append(payload)
    is_paper = any(message["role"] == "system" and "question-bank" in message["content"] for message in payload["messages"])
    card = {"type": "question_bank", "version": 1, "id": "math-bank", "name": "数学练习题库.json", "url": f"http://127.0.0.1:{PORT}/artifacts/bank.json", "question_count": 2, "subject": "数学", "grade": "初中一年级"}
    content = ('已生成数学题库，共 2 题。点击下方卡片查看题目并组卷。\n\n```question-bank\n' + json.dumps(card, ensure_ascii=False) + '\n```') if is_paper else f"普通回答：{payload['messages'][-1]['content']}"
    async def stream():
        if is_paper:
            yield 'event: hermes.tool.progress\ndata: {"tool":"题库生成与校验","toolCallId":"fixture-1","status":"completed","percent":100}\n\n'
        for offset in range(0, len(content), 40):
            yield f"data: {json.dumps({'choices': [{'delta': {'content': content[offset:offset+40]}, 'finish_reason': None}]}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.02)
        yield 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/tests/upstream-requests")
def upstream_requests():
    """Only available in this isolated fixture, never in the production app."""
    return UPSTREAM_REQUESTS

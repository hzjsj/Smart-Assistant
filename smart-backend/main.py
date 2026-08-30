import os
import sys
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from users.models import User, UserSession
from users.router import router as users_router

Base.metadata.create_all(bind=engine)

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

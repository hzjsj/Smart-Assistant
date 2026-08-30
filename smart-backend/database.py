import os

from dotenv import load_dotenv
from sqlalchemy import Column, DateTime, create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.sql import func

# 在模块级加载 .env，使直接 import database 的入口（脚本、迁移工具）也能读到 DB_* 等配置；
# main.py 中的 load_dotenv() 调用幂等，重复执行无害。
load_dotenv()


def _build_database_url() -> str:
    """构建 MySQL 连接 URL，由 ``.env`` 分项拼装。

    优先级：
    1. ``DATABASE_URL``（完整 URL，强制覆盖一切）—— 想精确指定时用（逃生口）。
    2. ``DB_HOST`` / ``DB_PORT`` / ``DB_USER`` / ``DB_PASSWORD`` / ``DB_NAME``
       分项拼装（默认 127.0.0.1:3306，库名 smart_assistant）。
    """
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    db_host = os.getenv("DB_HOST", "127.0.0.1")
    db_port = os.getenv("DB_PORT", "3306")
    db_user = os.getenv("DB_USER", "root")
    db_password = os.getenv("DB_PASSWORD", "")
    db_name = os.getenv("DB_NAME", "smart_assistant")
    return f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?charset=utf8mb4"


def _ensure_database() -> None:
    """库名不存在时自动 CREATE DATABASE（幂等）。

    连接 MySQL 服务器（不带库名）执行建库，字符集 utf8mb4。MySQL 暂不可达时
    仅打印警告不阻断导入，让后续 create_all 抛出更明确的连接错误。
    """
    url = os.getenv("DATABASE_URL")
    if url:
        # DATABASE_URL 形如 mysql+pymysql://user:pass@host:port/dbname?...
        server_url = "/".join(url.split("/", 3)[:3]) + "/?charset=utf8mb4"
    else:
        db_host = os.getenv("DB_HOST", "127.0.0.1")
        db_port = os.getenv("DB_PORT", "3306")
        db_user = os.getenv("DB_USER", "root")
        db_password = os.getenv("DB_PASSWORD", "")
        server_url = f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/?charset=utf8mb4"
    db_name = os.getenv("DB_NAME", "smart_assistant")
    try:
        tmp_engine = create_engine(server_url, pool_pre_ping=True)
        with tmp_engine.connect() as conn:
            conn.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                    "DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci"
                )
            )
            conn.commit()
        tmp_engine.dispose()
    except Exception as e:
        print(f"[database] 自动建库失败（MySQL 不可达？）：{e}")


_ensure_database()

SQLALCHEMY_DATABASE_URL = _build_database_url()

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    # 连接池参数：pool_recycle 应对 MySQL wait_timeout，避免拿到已被服务端关闭的连接
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
    pool_pre_ping=True,
    pool_timeout=30,
    future=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


class TimestampMixin:
    """统一时间戳字段，所有新表必须继承。

    - 列名固定为 ``created_at`` / ``updated_at``（snake_case）
    - 默认值与 onupdate 走 SQL 层 ``func.now()``，避免 Python 端时区/进程时间漂移
    """

    created_at = Column(
        DateTime, server_default=func.now(), nullable=False, comment="创建时间"
    )
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间",
    )


def get_db():
    """FastAPI 路由依赖：在请求结束后自动关闭 Session。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

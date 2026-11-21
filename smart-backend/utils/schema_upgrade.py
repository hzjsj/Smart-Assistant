"""幂等的轻量结构升级：`create_all` 只建缺失表，不补已有表的新列/新索引。

无 Alembic 阶段的兜底手段（见 ARCHITECTURE.md 路线图 / todo 第 10 条最低成本方案）。
仅支持两类小 DDL：加列、加索引。探测到已存在则跳过，重复启动是 no-op；
复杂结构变更（改列类型/删列）仍需手动 SQL 或引入 Alembic。
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_column(engine: Engine, table: str, column_name: str, add_column_ddl: str) -> None:
    """若无则给表加列。add_column_ddl 形如
    "ALTER TABLE qieti_upload_records ADD COLUMN uid VARCHAR(50) NULL"。
    """
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return  # 表尚不存在：create_all 会按模型建出完整结构
    if column_name in [c["name"] for c in inspector.get_columns(table)]:
        return
    with engine.begin() as conn:
        conn.execute(text(add_column_ddl))
    print(f"[schema-upgrade] {table}: 已补列 {column_name}")


def ensure_index(engine: Engine, table: str, index_name: str, add_index_ddl: str) -> None:
    """若无则给表加索引。add_index_ddl 形如
    "ALTER TABLE qieti_upload_records ADD INDEX ix_xxx (uid, created_at)"。
    """
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    if index_name in [i["name"] for i in inspector.get_indexes(table)]:
        return
    with engine.begin() as conn:
        conn.execute(text(add_index_ddl))
    print(f"[schema-upgrade] {table}: 已补索引 {index_name}")

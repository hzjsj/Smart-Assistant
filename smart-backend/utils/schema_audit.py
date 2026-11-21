"""启动自检：模型 metadata 与实际库结构 diff 告警（todo 第 10 条最低成本兜底）。

create_all 只建缺失表、补不了已有表的新列；模型漂移时在此打警告，
避免「进程带旧结构启动」静默出错（login_tables 事故）。
复杂结构变更仍应走 ensure_column（utils/schema_upgrade.py）或引入 Alembic。
"""
from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.sql.schema import MetaData


def audit_schema_drift(engine: Engine, metadata: MetaData) -> list[str]:
    """返回「模型已定义但库中缺失」的列清单（缺表由 create_all 创建，不算漂移）。"""
    problems: list[str] = []
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table_name, table in metadata.tables.items():
        if table_name not in existing_tables:
            continue
        db_columns = {c["name"] for c in inspector.get_columns(table_name)}
        for column in table.columns:
            if column.name not in db_columns:
                problems.append(
                    f"表 {table_name}.{column.name} 模型已定义但库中缺失"
                    "（请通过 utils.schema_upgrade.ensure_column 补列或手动 ALTER）"
                )
    return problems

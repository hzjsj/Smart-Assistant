# smart-backend

智能助手后端（FastAPI + SQLAlchemy + MySQL），与 hwwh-manage-backend 同样的分层风格。

## 结构

```
main.py              # 入口：加载 .env → 建表 → 种子数据 → CORS → 路由
database.py          # MySQL 连接、Base/TimestampMixin、自动建库
auth.py              # Cookie 鉴权依赖：get_current_user / get_current_userid / require_admin
seed.py              # 默认账号：admin / ant.design（admin）、user / ant.design（user）
users/
  models.py          # users、user_sessions 表
  schemas.py         # Pydantic 请求/响应模型
  crud.py            # 用户查询 + bcrypt 密码
  router.py          # /api/login/account、/api/login/outLogin、/api/currentUser、/api/login/captcha
  sessions.py        # 会话 token 生成/校验（存库，TTL 7 天，Cookie 名 mock_token）
```

## 启动

```bash
# 1. 配置数据库连接（默认 127.0.0.1:3307，见 .env）
cp .env.example .env   # 按需修改 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME

# 2. 安装依赖
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 3. 启动（首次启动自动建库建表并写入默认账号）
.venv/bin/uvicorn main:app --port 5000 --reload
```

接口文档：<http://localhost:5000/docs>

## 本地 MySQL 开发实例（无需 sudo）

系统 MySQL（3306）需要管理员启动。如无权限，可用当前用户起一个独立实例（端口 3307）：

```bash
DATA_DIR="$HOME/.mysql-smart-assistant/data"
mkdir -p "$DATA_DIR"
# 仅首次：初始化数据目录（root 空密码）
/usr/local/mysql/bin/mysqld --no-defaults --initialize-insecure --datadir="$DATA_DIR" --user=$(whoami)
# 启动（后台）
nohup /usr/local/mysql/bin/mysqld --no-defaults --datadir="$DATA_DIR" \
  --port=3307 --socket=/tmp/mysql-smart-assistant.sock --mysqlx=OFF \
  --log-error="$HOME/.mysql-smart-assistant/mysqld.log" --user=$(whoami) &
```

对应 `.env`：`DB_PORT=3307`、`DB_USER=root`、`DB_PASSWORD=`（当前 `.env` 已是此配置）。

## 前端联调

smart-frontend 开发代理已指向 `http://localhost:5000`（见 `config/proxy.ts` 的 dev 段），
登录态由 Cookie（`mock_token`）承载，前端 `withCredentials: true`。

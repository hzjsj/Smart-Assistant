#!/usr/bin/env bash
# ============================================================
# 智能助手（smart-assistant）前后端一键启动脚本
# 适用：Linux（Debian/Ubuntu/CentOS 等），macOS 亦可运行
#
# 用法：
#   ./run.sh              后台启动前后端（默认）
#   ./run.sh start        同默认
#   ./run.sh dev          前台启动（Ctrl+C 同时停止两个服务）
#   ./run.sh stop         停止前后端
#   ./run.sh restart      重启前后端
#   ./run.sh status       查看运行状态
#   ./run.sh logs [backend|frontend]   跟踪日志（默认两个都跟踪）
#   ./run.sh install      安装/更新前后端依赖
#
# 可覆盖的环境变量：
#   BACKEND_PORT=5000  FRONTEND_PORT=8000  HOST=0.0.0.0
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/smart-backend"
FRONTEND_DIR="$ROOT_DIR/smart-frontend"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"

BACKEND_PORT="${BACKEND_PORT:-5000}"
FRONTEND_PORT="${FRONTEND_PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

BACKEND_PID="$RUN_DIR/backend.pid"
FRONTEND_PID="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

mkdir -p "$RUN_DIR" "$LOG_DIR"

# ---------- 通用工具 ----------
info()  { printf '\033[32m[run]\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m[run]\033[0m %s\n' "$*"; }
error() { printf '\033[31m[run]\033[0m %s\n' "$*" >&2; }

# 端口是否可连接
port_open() {
  local host="$1" port="$2"
  (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null && exec 3>&- && exec 3<&-
}

# 读取 smart-backend/.env 中的 DB_HOST / DB_PORT（不导出密钥）
db_endpoint() {
  local env_file="$BACKEND_DIR/.env" host="127.0.0.1" port="3306"
  if [ -f "$env_file" ]; then
    host="$(grep -E '^DB_HOST=' "$env_file" | tail -1 | cut -d= -f2- | tr -d '\r')" || true
    port="$(grep -E '^DB_PORT=' "$env_file" | tail -1 | cut -d= -f2- | tr -d '\r')" || true
    host="${host:-127.0.0.1}"
    port="${port:-3306}"
  fi
  echo "$host $port"
}

pid_alive() {
  local pidfile="$1"
  [ -f "$pidfile" ] || return 1
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# 无 setsid 时（如 macOS）按进程树自底向上结束
kill_tree() {
  local pid="$1" sig="$2" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# ---------- 依赖检查 ----------
check_prereqs() {
  command -v python3 >/dev/null 2>&1 || { error "缺少 python3，请先安装（apt install python3 python3-venv）"; exit 1; }
  command -v npm >/dev/null 2>&1     || { error "缺少 npm，请先安装 Node.js >= 22"; exit 1; }
  [ -f "$BACKEND_DIR/.env" ] || { error "缺少 $BACKEND_DIR/.env，请先执行：cp smart-backend/.env.example smart-backend/.env 并填写密钥"; exit 1; }
}

ensure_venv() {
  if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
    info "创建后端虚拟环境 .venv ..."
    python3 -m venv "$BACKEND_DIR/.venv"
  fi
}

install_deps() {
  info "安装后端依赖 ..."
  ensure_venv
  "$BACKEND_DIR/.venv/bin/pip" install -q --upgrade pip
  "$BACKEND_DIR/.venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
  info "安装前端依赖 ..."
  ( cd "$FRONTEND_DIR" && npm install )
  info "依赖安装完成"
}

# 首次启动时自动补依赖（node_modules / venv 缺失）
ensure_deps() {
  ensure_venv
  if ! "$BACKEND_DIR/.venv/bin/python" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
    warn "后端依赖不完整，自动安装 ..."
    "$BACKEND_DIR/.venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
  fi
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    warn "前端 node_modules 缺失，自动执行 npm install ..."
    ( cd "$FRONTEND_DIR" && npm install )
  fi
}

check_mysql() {
  local endpoint host port
  endpoint="$(db_endpoint)"
  host="${endpoint% *}"
  port="${endpoint#* }"
  if port_open "$host" "$port"; then
    info "MySQL 连接正常（$host:${port}）"
  else
    warn "MySQL 不可达（$host:${port}），后端启动后可能报数据库连接错误"
    warn "请先启动 MySQL / Docker（docker compose up -d mysql），或检查 smart-backend/.env"
  fi
}

# ---------- 启动/停止 ----------
wait_port() {
  local host="$1" port="$2" timeout="${3:-60}" name="$4"
  local i=0
  while [ "$i" -lt "$timeout" ]; do
    port_open "$host" "$port" && { info "$name 已就绪：http://localhost:$port"; return 0; }
    sleep 1
    i=$((i + 1))
  done
  warn "$name 在 ${timeout}s 内未监听端口 ${port}，请查看日志：$LOG_DIR"
  return 1
}

start_backend() {
  if pid_alive "$BACKEND_PID"; then
    info "后端已在运行（PID $(cat "$BACKEND_PID")），跳过"
    return 0
  fi
  if port_open 127.0.0.1 "$BACKEND_PORT"; then
    warn "端口 $BACKEND_PORT 已被其他进程占用，跳过后端启动"
    return 0
  fi

  info "启动后端 uvicorn（端口 ${BACKEND_PORT}）..."
  (
    cd "$BACKEND_DIR"
    if command -v setsid >/dev/null 2>&1; then
      # setsid：让子进程成为独立会话/进程组组长，便于整组停止
      setsid nohup .venv/bin/uvicorn main:app --host "$HOST" --port "$BACKEND_PORT" --reload \
        >>"$BACKEND_LOG" 2>&1 </dev/null &
    else
      nohup .venv/bin/uvicorn main:app --host "$HOST" --port "$BACKEND_PORT" --reload \
        >>"$BACKEND_LOG" 2>&1 </dev/null &
    fi
    echo $! >"$BACKEND_PID"
  )
  wait_port 127.0.0.1 "$BACKEND_PORT" 60 "后端"
}

start_frontend() {
  if pid_alive "$FRONTEND_PID"; then
    info "前端已在运行（PID $(cat "$FRONTEND_PID")），跳过"
    return 0
  fi
  if port_open 127.0.0.1 "$FRONTEND_PORT"; then
    warn "端口 $FRONTEND_PORT 已被其他进程占用，跳过前端启动"
    return 0
  fi

  info "启动前端 Umi Dev Server（端口 ${FRONTEND_PORT}）..."
  (
    cd "$FRONTEND_DIR"
    if command -v setsid >/dev/null 2>&1; then
      setsid nohup env PORT="$FRONTEND_PORT" HOST="$HOST" npm run dev \
        >>"$FRONTEND_LOG" 2>&1 </dev/null &
    else
      nohup env PORT="$FRONTEND_PORT" HOST="$HOST" npm run dev \
        >>"$FRONTEND_LOG" 2>&1 </dev/null &
    fi
    echo $! >"$FRONTEND_PID"
  )
  wait_port 127.0.0.1 "$FRONTEND_PORT" 120 "前端"
}

stop_one() {
  local name="$1" pidfile="$2" port="$3"
  if ! pid_alive "$pidfile"; then
    # 清理可能存在的残留进程（端口仍被占用但 pid 文件失效）
    if port_open 127.0.0.1 "$port"; then
      warn "$name 未记录运行 PID，但端口 $port 被占用；请手动确认（lsof -i:${port}）"
    else
      info "$name 未运行"
    fi
    rm -f "$pidfile"
    return 0
  fi
  local pid pgid
  pid="$(cat "$pidfile")"
  info "停止${name}（PID ${pid}）..."
  # 若该进程是进程组组长（setsid 启动），整组结束以覆盖 uvicorn --reload / npm+umi 子进程；
  # 否则按进程树自底向上结束（macOS 无 setsid 的回退路径）
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [ -n "$pgid" ] && [ "$pgid" = "$pid" ]; then
    kill -TERM -- "-$pid" 2>/dev/null || kill_tree "$pid" TERM
  else
    kill_tree "$pid" TERM
  fi
  local i=0
  while [ "$i" -lt 10 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "$name 未在 10s 内退出，强制结束"
    if ! kill -KILL -- "-$pid" 2>/dev/null; then
      kill_tree "$pid" KILL
    fi
  fi
  rm -f "$pidfile"
  info "$name 已停止"
}

stop_all() {
  stop_one "前端" "$FRONTEND_PID" "$FRONTEND_PORT"
  stop_one "后端" "$BACKEND_PID" "$BACKEND_PORT"
}

status_one() {
  local name="$1" pidfile="$2" port="$3" url="$4"
  if pid_alive "$pidfile"; then
    printf '  %-6s 运行中  PID %-7s  %s\n' "$name" "$(cat "$pidfile")" "$url"
  elif port_open 127.0.0.1 "$port"; then
    printf '  %-6s 端口占用（非本脚本启动）  %s\n' "$name" "$url"
  else
    printf '  %-6s 未运行\n' "$name"
  fi
}

show_status() {
  info "服务状态："
  status_one "后端" "$BACKEND_PID" "$BACKEND_PORT" "http://localhost:$BACKEND_PORT/docs"
  status_one "前端" "$FRONTEND_PID" "$FRONTEND_PORT" "http://localhost:$FRONTEND_PORT"
  printf '\n  日志：%s\n' "$LOG_DIR"
}

show_logs() {
  local target="${1:-all}"
  case "$target" in
    backend)  tail -n 100 -f "$BACKEND_LOG" ;;
    frontend) tail -n 100 -f "$FRONTEND_LOG" ;;
    all)      tail -n 50 -f "$BACKEND_LOG" "$FRONTEND_LOG" ;;
    *)        error "用法：./run.sh logs [backend|frontend]"; exit 1 ;;
  esac
}

# ---------- 前台模式 ----------
run_dev() {
  ensure_deps
  check_mysql
  info "前台启动（Ctrl+C 停止全部服务）..."
  (
    cd "$BACKEND_DIR"
    exec .venv/bin/uvicorn main:app --host "$HOST" --port "$BACKEND_PORT" --reload
  ) &
  local backend_job=$!
  # 退出/中断时一并停止后端
  trap 'kill "$backend_job" 2>/dev/null || true' EXIT INT TERM

  cd "$FRONTEND_DIR"
  PORT="$FRONTEND_PORT" HOST="$HOST" npm run dev
}

# ---------- 命令入口 ----------
cmd="${1:-start}"
case "$cmd" in
  start)
    check_prereqs
    ensure_deps
    check_mysql
    start_backend
    start_frontend
    show_status
    info "启动完成。停止：./run.sh stop    日志：./run.sh logs"
    ;;
  dev)
    check_prereqs
    run_dev
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    check_prereqs
    ensure_deps
    check_mysql
    start_backend
    start_frontend
    show_status
    ;;
  status)
    show_status
    ;;
  logs)
    shift || true
    show_logs "${1:-all}"
    ;;
  install)
    check_prereqs
    install_deps
    ;;
  -h|--help|help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    error "未知命令：$cmd"
    echo "用法：./run.sh [start|dev|stop|restart|status|logs|install]"
    exit 1
    ;;
esac

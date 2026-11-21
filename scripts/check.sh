#!/usr/bin/env bash
# 本地全量检查（CI 等价命令，todo 第 25 条）
# 用法：./scripts/check.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "── 后端测试（需本地 MySQL 3307 或按 .env 配置）──"
cd "$ROOT/smart-backend"
.venv/bin/python -m unittest \
  bailian.tests.test_agent_adapter \
  openclaw.tests.test_openclaw_payload \
  hermes.tests.test_chat_requests \
  hermes.tests.test_workspace \
  dify.tests.test_chat_adapter \
  langchain_agent.tests.test_agent_adapter \
  conversations.tests.test_recording \
  shuban.tests.test_storage

echo "── 前端 lint / 类型 / 单测 ──"
cd "$ROOT/smart-frontend"
npx biome lint src/
npx tsc --noEmit
npx vitest run

echo "── 全部通过 ✓ ──"

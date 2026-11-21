# Smart Assistant 前端

「智能助手」AI 辅助教育平台的前端（对应后端见 [../smart-backend](../smart-backend)，整体架构见 [../ARCHITECTURE.md](../ARCHITECTURE.md)）。

## 技术栈

- [UmiJS Max](https://umijs.org/) 4（utoopack）+ React 19 + antd 6（Ant Design Pro v6 脚手架演进）
- AI 对话 UI：[@ant-design/x](https://x.ant.design/) / `@ant-design/x-sdk`（useXChat + XRequest）/ `@ant-design/x-markdown`（含 Latex 插件）
- 服务端状态：[@tanstack/react-query](https://tanstack.com/query)（umi reactQuery 插件注入 Provider）
- 样式：Tailwind CSS v4 + antd-style（createStyles）；Lint/格式化：Biome 2.5；测试：Vitest（happy-dom）+ Playwright（hermes e2e）

## 快速开始

```bash
npm ci            # 安装依赖（Node >= 22，只用 npm）
npm run dev       # 开发服务 MOCK=none，http://localhost:8000，/api 代理到后端 5000
npm run lint      # Biome lint + tsc --noEmit
npm run test      # Vitest 单测
npm run build     # 生产构建
npm run openapi   # 从后端 openapi.json 重新生成 src/services/fast-api-manage/*
```

一键启停前后端与 MySQL 见仓库根目录 `run.sh` / `docker-compose.yml`；本地全量检查用 `../scripts/check.sh`，CI 配置见 `../.github/workflows/check.yml`。

## 目录速览

```
config/            构建配置（config.ts / routes.ts / proxy.ts）
src/app.tsx        运行时配置枢纽（getInitialState / layout / request / rootContainer）
src/pages/         页面自治目录（hermes、qieti 为结构范本：service.ts + hooks + components 子目录）
src/components/    共享组件；chat-kit/ 为 chat/chatbot/copilot 三页共享的聊天件
src/services/      手写服务（user.ts / chat.ts / ant-design-pro/）+ OpenAPI 生成的 fast-api-manage/
src/utils/         apiBase（SSE 端点基地址）等共享工具
```

## 注意事项

- **SSE 流式请求不走 dev 代理**（HPM 会缓冲流式响应）：统一用 `src/utils/apiBase.ts` 的
  `API_BASE` 派生端点（开发按当前主机直连 5000，生产走同源 nginx `proxy_buffering off`），
  禁止硬编码 `http://localhost:5000`
- `src/services/fast-api-manage/` 是 OpenAPI 生成代码，用 `npm run openapi` 再生，勿手改
- 会话鉴权基于 HttpOnly cookie（`sa_session_token`），前端无需（也不能）用 JS 读它
- localStorage 键带项目前缀（如 qieti 的 `smart-assistant-question-bank-data`），避免多项目冲突
- macOS 若 5000 端口被 AirPlay 占用，见根 README 的处理办法

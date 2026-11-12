# Hermes 页面迁移进度（hwzs → smart-assistant）

源：`/Users/xiulong/Desktop/jetbrains/hwzs`（分支 `feat/bailian-agent`，后端 HEAD 5c1fa28、前端 HEAD 4025f69，以工作区为准）。
目标：本仓库 `smart-backend/` + `smart-frontend/`（master）。
方式：**复制**（hwzs 不删除代码）。定时任务每小时巡检推进，完成全部项后暂停。

## 后端（1-12）

| # | 事项 | 状态 |
|---|------|------|
| 1 | `conversations/` 六文件整目录复制（含 `upstream_conversation_id`） | ✅ |
| 2 | `hermes/` 整目录复制（排除 `storage/` 运行时产物） | ✅ |
| 3 | `deepseek/` 四文件复制 | ✅ |
| 4 | `dify/` 六文件复制（含 tests） | ✅ |
| 5 | `bailian/` agent 端点提取（agent_service/router/schemas/__init__/tests，不含 kb_chat） | ✅ |
| 6 | `mineru/models.py` 新建 `MineruAttachment` 表 | ✅ |
| 7 | `mineru/attachment_service.py` 复制 | ✅ |
| 8 | `mineru/schemas.py` 追加 ChatAttachment/AttachmentChatMessage/AttachmentChatRequest/AttachmentUploaded | ✅ |
| 9 | `mineru/router.py` 追加附件三端点 + `chat/completions` 带附件聊天 | ✅ |
| 10 | `main.py` 接线：models 注册 + conversations/hermes/deepseek/dify/bailian 五个 include_router | ✅ |
| 11 | `requirements.txt`（httpx、PyMuPDF）+ `.env.example`（HERMES_AGENT_*/DEEPSEEK_*/DIFY_*/DASHSCOPE/BAILIAN_APP_ID/MINERU_CALLBACK_URL） | ✅ |
| 12 | 后端启动 + curl 验证（登录 → conversations / hermes / 四模型 chat / mineru attachments） | ✅ |

后端迁移已提交：`45a69ad feat(assistant-migration): 迁移 hermes 对话后端（conversations/hermes/deepseek/dify/bailian agent/mineru 附件）`

## 前端（13-19）

| # | 事项 | 状态 |
|---|------|------|
| 13 | 复制 `src/pages/hermes/` 全部源码（含 assistant/ 快捷助手模块，65 文件） | ✅ |
| 14 | jest 测试适配 vitest：`jest.`→`vi.`、补 vitest 导入、`vi.Mock`→`Mock` 类型、PaperForm 测试加 `@vitest-environment jsdom`（antd Select 可访问名称在 happy-dom 下不稳定）；13 文件 87 用例全过 | ✅ |
| 15 | `config/routes.ts` 加 `/hermes`（layout: false，icon robot） | ✅ |
| 16 | `index.tsx` 补 `katex/dist/katex.min.css`（smart 已有 katex 依赖；hwzs 由出卷页顺带加载，独立路由需自引入） | ✅ |
| 17 | SSE 端点直连：service.ts 五个 chat/completions 前缀 `http://localhost:5000` + `credentials: 'include'`（与 src/pages/chat 惯例一致）；REST（附件/会话/题库）保持相对路径走代理 | ✅ |
| 18 | AlibabaSans 字体：smart `global.less` 已有同名 @font-face，无需复制 | ✅ |
| 19 | `npm run lint`（biome + tsc）通过；vitest 87/87 通过；浏览器实测：登录→/hermes 渲染、DeepSeek 流式对话（思考链+回复）、刷新持久化恢复、四模型菜单、作文助手（静态欢迎语+自动建会话+8 指令） | ✅ |

## 已知差异与说明

- smart-backend 无 DB_TYPE/sqlite，MySQL-only（3307），启动自动 `_ensure_database()`；迁移模块建表随 `Base.metadata.create_all` 生效。
- `documents/` = hwzs `files/` 改名版；mineru/ 为任务管理版（无聊天附件，迁移时已补）。
- hwzs 仓库代码**保留不删**。

## env 配置复制（2026-11-13 追加）

按用户要求把 hwzs 后端 `.env` 中迁移模块所需的变量复制到 `smart-backend/.env`（`.env` 已 gitignore，密钥不入库）：

- 新增 11 个：`HERMES_AGENT_API_KEY/_BASE_URL/_CONNECT_TIMEOUT/_MODEL/_READ_TIMEOUT`、`DIFY_API_KEY/_BASE_URL/_CONNECT_TIMEOUT/_READ_TIMEOUT`、`DASHSCOPE_API_KEY`、`BAILIAN_APP_ID`
- smart 已有无需复制：`DEEPSEEK_API_KEY/_BASE_URL`（chat 模块共用，迁移模块用默认值兼容）、`OSS_*`、`MINERU_*`
- 连通性验证：Dify ✓（/api/dify/info 返回真实应用）、DeepSeek ✓（流式回复）、百炼 ✓（Agent 流式回复 OK）、Hermes ✗——上游 `101.96.197.17:8642` 主机可达但端口未监听（服务未运行，与配置无关，待上游启动即通）

## 浏览器实测记录（2026-11-13）

- 登录 admin/ant.design → 跳转 /hermes，页面完整渲染（侧栏三入口 + 会话列表 + 输入区）
- 发送「你好，请用一句话介绍你自己」→ DeepSeek 流式回复 + 思考链「思考完成」+ 会话列表自动新建并同步标题
- 刷新页面 → 用户消息、思考链、助手回复全部从后端恢复
- 「选择对话模型」菜单四项：Hermes Agent / DeepSeek / Dify / 百炼
- 点击「作文助手」→ 本地静态欢迎语 + 示例链接 + 8 个快捷指令（作文批改/作文评分/范文生成/范文讲解/作文润色/作文素材/好词好句生成/结构调整建议），自动新建「作文助手」会话且入口高亮
- 已知限制：IAB 不支持文件选择器，附件上传未在浏览器实测（后端端点已 curl 验证）；未配 key 的模型走后端干净配置错误

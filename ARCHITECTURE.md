# 架构分析与优化路线图（ARCHITECTURE.md）

> 生成日期：2026-11-21 · 依据：2026-11-20/21 两轮全量代码盘点（目录结构 + 依赖关系专项）
> 配套待办清单见 [todo.md](todo.md)，本文档负责「结构设计」，todo 负责「条目追踪」。
> 状态标记：本文档描述的是**目标态**，随阶段落地在下方路线图中勾选进度。

---

## 1. 项目概览

「智能助手」= AI 辅助教育平台 monorepo：

| | 后端 `smart-backend/` | 前端 `smart-frontend/` |
|---|---|---|
| 技术栈 | FastAPI + SQLAlchemy 2 + MySQL，cookie 会话，无迁移框架 | UmiJS Max + React 19 + antd 6，AI UI 基于 @ant-design/x 全家桶 |
| 规模 | 125 个 py 文件 / 约 21,100 行 | 290 个 ts/tsx / 约 38,700 行 |
| 模块 | 17 个路由模块挂载于 `main.py` | 15 个一级路由，9 个业务页面 + 模板残留 |
| 测试 | 7 个模块有 tests/，9 个为零 | 24 个 vitest 文件（hermes 最完备）+ 3 个 Playwright e2e 脚本 |

业务线：AI 对话（chat/chatbot/copilot/hermes + 6 后端适配器）、文档管理（MinerU 解析）、AI 组卷（chujuanji）、切题（qieti）、书版预览（shuban）、企微登录（wecom）。

---

## 2. 后端现状分析

### 2.1 模块形态三分类（无边界约束，三种并存）

| 形态 | 模块 | 特征 |
|---|---|---|
| 标准 CRUD 型 `models/crud/schemas/router` | users, chat, documents, conversations, qieti, generate_test_paper | AGENTS.md 约定形态，质量中等 |
| 适配器型 `router + service + schemas`（无 models） | deepseek, dify, bailian, openclaw, langchain_agent, hermes | 6 个聊天代理，结构一致，质量最高 |
| 自治型（自成一体） | mineru（双路由 + proxy + batch，539 行 service）、shuban（router 599 行 + fbdview 子包 13 文件） | 内部自洽，对外耦合最多 |

### 2.2 依赖耦合图

**枢纽模块**（被全员依赖）：`database.py`（每个模块）、`auth.py`（每个路由）、`conversations`（全部 6 个聊天适配器 + mineru）、`users`（auth/chat/documents/gtp/shuban/wecom）、`utils/oss_upload`（documents/mineru/oss）。

```mermaid
graph LR
    subgraph 顶层枢纽
        AUTH[auth.py] --> DB[database.py]
        SEED[seed.py] --> DB
    end
    subgraph 标准CRUD模块
        USERS[users 独立叶子]
        CHAT[chat]
        DOCS[documents]
        GTP[generate_test_paper]
        QIETI[qieti 近叶子]
        CONV[conversations ★事实核心域]
    end
    subgraph 聊天适配器（router+service）
        HERMES[hermes]
        DEEP[deepseek]
        DIFY[dify]
        BAIL[bailian]
        CLAW[openclaw]
        LAGENT[langchain_agent]
    end
    subgraph 自治模块
        MINERU[mineru 耦合最多]
        SHUBAN[shuban]
        WECOM[wecom]
        OSS[oss 薄壳]
    end
    HERMES --> CONV
    DEEP --> CONV
    DIFY --> CONV
    BAIL --> CONV
    CLAW --> CONV
    LAGENT --> CONV
    LAGENT -.->|跨模块依赖唯一例| CHATLLM[chat/llm.py 注册表]
    CHAT --> USERS
    DOCS --> USERS
    DOCS --> OSSU[utils/oss_upload]
    MINERU --> OSSU
    MINERU --> CONV
    MINERU --> HERMES
    MINERU -.->|循环·惰性| DOCS
    DOCS -.->|循环·惰性| MINERU
    WECOM --> USERS
    OSS --> OSSU
```

**三个结构性问题（按危害排序）**：

1. **`conversations` 核心域 API 未收口**：6 个适配器 + mineru 依赖其 `crud`/`service`，连私有函数 `_accumulate`/`_parse_sse_events`（`conversations/service.py`）都被各适配器测试直接 import——核心域内部实现成了公共契约。
2. **documents ↔ mineru 真循环依赖**：`documents/router.py:391,399`（函数内惰性 import `mineru.service`/`mineru.batch`）↔ `mineru/proxy.py:31`（模块级 import `documents.router._process_mineru_upload`）。后者是**依赖路由器内部函数**，方向颠倒。
3. **5 份复制的 SSE 代理骨架**：deepseek/hermes/openclaw/dify/bailian 各持一份 `upstream_error_detail`/`open_chat_stream`/headers 构造（约 500 行重复）；SSE 帧构造另有 3 份；附件注入 prompt 3 份；图片 URL→OSS 改写正则 4 处。`langchain_agent` 还跨模块伸进 `chat/llm.py` 拿 provider 注册表——是唯一不限于 conversations+auth 的适配器。

### 2.3 路由挂载与命名

`main.py` 裸挂 17 个路由；tags 命名混乱（`wenjianguanli`、`osSwenjianshangchuan` 拼音 vs 中文 vs 英文混用）；前缀风格不一（`/api/chujuanji` 拼音 vs `/api/generate-test-paper` 英文）；鉴权方式不一（聊天类路由器级 `dependencies=[Depends(get_current_user)]`，其余端点级分散声明）。

### 2.4 死重与仓库卫生

- `agent/` 孤儿目录：仅剩 11 个陈旧 `.pyc`（已删除的 RAG 模块）
- `db/smart_assistant.sql`：2.4MB 全量 dump（含 bcrypt 哈希用户数据）入库
- `uploads/`、`__pycache__/` 入库
- `mineru/` 与 `documents/` 各自构造 OSS 客户端（`utils/oss_upload.py` 与 `mineru/attachment_service.py`）
- 测试空白：users、chat、documents、generate_test_paper、mineru、oss、qieti、deepseek、wecom 九个模块零测试

### 2.5 部署约束（文档化，不改造）

- **必须单 worker**：`mineru/proxy.py` 的 `_BATCHES`、`mineru/service.py` 的 `_syncing_ids`/`_sync_executor`、conversations 的进程内流注册表均为进程内状态，`--workers >1` 即失效
- **userid 类型混杂**：`chat_sessions.user_id` String(50) / `exams.user_id` Integer / `file_records.uid` String(36) / `user_sessions.user_id` Integer——**新表一律 String(50) 存 userid**，老表择机迁移

---

## 3. 前端现状分析

### 3.1 服务访问碎片化（四种模式并存）

| 模式 | 位置 | 现状 |
|---|---|---|
| OpenAPI 生成代码 | `services/fast-api-manage/`（16 模块 + 1006 行 typings） | **14/16 无人引用**，仅 wenjianguanli、osSwenjianshangchuan 在用 |
| 手写全局服务 | `services/user.ts`、`services/chat.ts`、`services/ant-design-pro/` | user.ts 质量好；chat.ts 与 chatbot/api.ts 近重复 |
| 页面级 service.ts | qieti / hermes / shuban / mineru / chat / chatbot / generate-test-paper | qieti 最规范（skipErrorHandler + 相对路径）；chat/chatbot/generate-test-paper 硬编码 `http://localhost:5000` |
| 组件内直连 | copilot、document-list | 散落在页面里 |

### 3.2 共享层名存实亡 + 页面复制地图

- `components/`：4 个模板残留无人引用（ArticleListContent、AvatarList、StandardFormRow、TagSelect）；实际在用的只有 ChatSkeleton、LottieThinkingIcon、ErrorBoundary、Footer、RightContent
- `utils/`：4 文件中 format.ts 零引用、chinaDivision.ts 仅测试引用（应用内已死）
- `hooks/`：仅 useDelayedLoading.ts 一个文件
- **复制地图**：MODEL_ABBR ×3（chat:236 / chatbot:134 / copilot:91）、createChatProvider 工厂 ×2.5、withErrorDetail ×2（shuban:39 / qieti:14）、下载 helper ×4、数学渲染方案 ×3（react-katex / x-markdown Latex / 自研 MathText）、Typewriter 欢迎组件 ×2

### 3.3 页面质量两极分化

- **hermes 是事实范本**：1542 行主页面 + 20 个附属文件（hooks/components 子目录、13 个测试文件、自定义 Provider）——功能最全、唯一有完整测试
- qieti 次之（service.ts 规范 + questionUtils 323 行测试）
- 其余页面（chat 870 行、generate-test-paper 1256 行、copilot 896 行）零测试、复制多、含硬编码 URL 与流式中止缺失

### 3.4 杂项死代码

`pages/list/`（孤儿模板页）、`hermes/.artifacts/`（性能 JSON 入库）、`LangDropdown`（i18n 删除后空壳仍被渲染）、`generateQuestionsSync`（调试残留）、3 处 `localhost:5000` 硬编码（todo 第 3 条）、双 QueryClientProvider（`app.tsx:205-212` 与 umi 插件重复注入）、无效 `invalidateQueries`（ProTable 非 react-query 数据源）。

---

## 4. 目标架构设计

### 4.1 设计原则

1. **渐进式，不做大搬迁**：`auth.py`/`database.py` 保持顶层枢纽地位（全员 import，改名 = 全库机械改动 + 活跃分支合并冲突代价，收益仅美学）
2. **收口核心域**：conversations 对外只暴露稳定 API，内部实现细节转正为导出函数
3. **新代码向 hermes/qieti 范本看齐**：页面自治（service.ts + hooks + components 子目录 + 测试），跨页共享进 chat-kit/utils
4. **生成的代码要么用要么删**：fast-api-manage 不保留「占着 typings 的死模块」

### 4.2 后端目标结构

```
smart-backend/
├── main.py                 # 路由挂载收拢为 ROUTERS 注册表（模块, 前缀, tags）统一声明
├── auth.py database.py seed.py   # 顶层枢纽【保持不动】
├── core/                   # （可选二期）统一响应封装、分页 helper、save_upload 校验 helper
├── conversations/          # 核心域收口：_accumulate/_parse_sse_events 转正导出 + __all__ 声明
├── chat_proxy/             # 【新增】聊天适配器公共层
│   ├── providers.py        #   ← chat/llm.py 的 PROVIDERS/MODELS 注册表迁入（解除 langchain_agent→chat 依赖）
│   ├── http.py             #   upstream settings/headers/错误清洗（合并 5 份复制）
│   └── sse.py              #   SSE 帧构造（合并 3 份复制）
├── documents/              # 与 mineru 解耦：共享处理逻辑全部在 knowledge.py，router 只做 HTTP 编排
├── mineru/                 # proxy.py 不再 import documents.router
└── users/ chat/ qieti/ generate_test_paper/ shuban/ oss/ wecom/   # 形态不变，按 todo 逐项加固
```

### 4.3 前端目标结构

```
smart-frontend/src/
├── services/
│   ├── fast-api-manage/    # 瘦身 16→2（删 14 个未用模块），openapi 生成配置保留
│   ├── user.ts chat.ts ant-design-pro/   # 手写层保留，chatbot/api.ts 并入 chat.ts
├── components/chat-kit/    # 【新增】跨页聊天共享件
│   ├── provider.ts         #   createChatProvider 工厂（统一 SSE_API_BASE，消灭 3 处硬编码）
│   ├── modelRegistry.ts    #   MODEL_ABBR/modelAbbr/formatContext（三合一）
│   ├── ModelMenu.tsx       #   分组模型菜单 + 思考开关 Sender footer
│   └── Think.tsx           #   ThinkComponent + 历史恢复（reasoning→<think>）
├── utils/
│   ├── download.ts         # 合并 4 种下载实现
│   ├── apiError.ts         # 合并 withErrorDetail ×2
│   └── answerToDocx.ts uuid.ts   # 保留
├── hooks/                  # 扩充（useDelayedLoading 先例）
└── pages/                  # 页面自治；删除 list/、4 个未用组件、.artifacts/
```

### 4.4 统一约定（新代码必须遵守）

1. **后端新模块**：标准型走 `models/crud/schemas/router`；代理适配器走 `router+service+schemas` 并依赖 `chat_proxy` + `conversations` 公共 API，禁止 import 其他适配器内部
2. **前端新页面**：`service.ts` 用相对路径 + `skipErrorHandler: true`（qieti 范本）；SSE 一律走 `chat-kit` 的 SSE_API_BASE；禁止页面内复制共享 helper，缺什么进 utils/chat-kit
3. **userid 列**：新表一律 `String(50)` 存 userid
4. **鉴权**：路由器级 `dependencies=[Depends(get_current_user)]` 为默认，属主校验 admin 放行

---

## 5. 分阶段实施路线图（结合 todo.md 全量条目）

| 阶段 | 内容 | 覆盖 todo | 状态 |
|---|---|---|---|
| **0** | 本文档 | 8、11 文档化 | ✅ |
| **A** | P0 安全包：documents 6 端点鉴权+属主、SSRF 收口、试卷属主、CORS 白名单、httponly×3、db dump 出库 | 1、2、16、17、18、20 | ⬜ |
| **B** | qieti 数据隔离 + 索引（幂等启动迁移）+ 统一 save_upload helper | 4、7、19、21 | ⬜ |
| **C** | 生产可用：SSE_API_BASE 统一、/docs 生产关闭、过期 session 清理、双 QueryClientProvider 合并 | 3、12、13、27 | ⬜ |
| **D** | 后端重构：chat_proxy 公共层合并 5 份骨架、conversations 收口、打断 documents↔mineru 循环；性能：mineru 阻塞点、documents 连接池、知识点树 N+1、chat 查询限额、auth JOIN | 29(后端)、5、6、22、23、14、10(自检) | ⬜ |
| **E** | 前端重构：chat-kit 统一三页、流式中止与竞态修复、utils 统一、bundle 清理、死代码删除 | 29(前端)、28、24、30(代码部分) | ⬜ |
| **F** | 工程化：CI（Gitee Go/Actions）、biome 规则渐进开启、文档漂移修正 | 25、26、30(文档部分) | ⬜ |

**不在开发范围内（运维/手动）**：

- todo 9 MySQL 参数调优（`long_query_time`、buffer pool）——DBA 操作
- todo 15 `DROP TABLE ppt_convert_tasks`——确认后手动执行：`DROP TABLE ppt_convert_tasks;`
- todo 10 的完整 Alembic 引入——先用启动自检兜底，Alembic 列为二期

每阶段独立提交（conventional 中文提交信息），验证标准：后端 `py_compile` + unittest 套件、前端 biome + `tsc --noEmit` + vitest、GUI 阶段浏览器回归关键路径。

# 简历项目模块 · 智能助手平台（Smart Assistant）

> 用途：简历「项目经历」模块可直接粘贴的浓缩版 + 面试展开的详细版 + 高频追问准备。
> 数据均来自仓库实测（2026-11-16 核对）：后端 105 条测试用例 / 前端 137 条 / 94 个接口 / 18 张表 / 约 5 万行代码。

---

## 一、简历浓缩版（可直接粘贴）

**项目名称**：智能助手平台 Smart Assistant（个人全栈项目）
**项目时间**：2026.xx – 至今（按实际填写）
**技术栈**：Python / FastAPI / SQLAlchemy / MySQL / LangChain 1.x / MCP / httpx(SSE) / React 19 / UmiJS Max / Ant Design 6 / @ant-design/x / Docker Compose / Nginx / Vitest / Playwright

**项目描述**：
面向教育场景的多模型 AI 助手平台。后端统一接入 6 种 LLM 对话后端（DeepSeek、Dify、阿里百炼、Hermes Agent、自研 LangChain Agent、OpenClaw），共享一套会话持久化与 SSE 流式转发架构；集成 MinerU 文档解析、大模型试卷切题、智能组卷等能力；前端基于 @ant-design/x 实现一套 UI 覆盖全部后端，支持移动端响应式。

**核心工作**：
- 设计**三种 LLM 集成模式**（OpenAI 兼容直通 / 事件流翻译适配器 / 自研工具循环），统一接入 6 种对话后端，新增后端前端零改动
- 自研**统一会话持久化层**（SSE 采集转发器）：0.8s 节流落库、断线续播、手动中止落库 aborted 态、多租户越权拦截，4 个后端复用同一条链路
- 基于 LangChain 1.x **手动 tool-calling 循环**实现可观测 Agent（非 LangGraph）：集成 DeepSeek 联网搜索（Search/Fetch 计费 API）、MinerU MCP 文档解析（streamable_http / stdio 双 transport 故障自动降级）、防 SSRF URL 抓取、AST 白名单计算器，并硬编码工具路由规则保证解析失败不降级抓二进制
- 实现文档解析**三链路统一状态机**：回调 SHA-256 签名校验 + 轮询自愈双路径，>200MB 大文件自动拆分-合并还原，产物图片转存自有 OSS 获得永久外链
- 前端用 useXChat / XRequest / ThoughtChain 等自研 **ChatProvider 流式协议适配层**，一套 UI 切换 6 种模型；修复移动端 ProLayout 抽屉失效、局域网非安全上下文 `crypto.randomUUID` 崩溃等真机问题
- **工程化**：Docker Compose 三服务一键启动（MySQL 健康检查编排 + nginx SSE 反代 `proxy_buffering off`），242 条自动化测试（后端 105 + 前端 137）+ Playwright 跨端 e2e

---

## 二、详细版（面试展开）

### 2.1 多后端适配架构（为什么这么设计）

6 个上游形态各异：deepseek/openclaw 是标准 OpenAI 协议；dify/百炼是自家事件流格式；hermes 是带技能系统的 agent 网关；langchain_agent 是本地自研循环。若逐个在前端写适配，UI 层会被协议细节污染。

做法：**在服务端完成协议归一**，全部输出 OpenAI 兼容 SSE；前端只有一个 ChatProvider 工厂，按模型 ID 路由到对应后端。三种集成模式：

| 模式 | 后端 | 关键点 |
|------|------|--------|
| OpenAI 兼容直通 | deepseek / hermes / openclaw | 零适配器，透传事件流 |
| 事件流翻译适配器 | dify / 百炼 | 上游 message 事件 → OpenAI delta 格式，逐段翻译 |
| 自研工具循环 | langchain_agent | 服务端循环执行工具，中间过程以自定义事件推送前端「执行过程」面板 |

收益：新增后端只写一个 router + 注册一行，前端零改动；测试上每个适配器独立可测。

### 2.2 统一会话持久化层（采集/转发解耦）

- 流式响应不能只透传：要落库、要可续播、要支持中止。设计上把「SSE 采集器」做成独立编排层，4 个后端（hermes/deepseek/langchain_agent/openclaw）共用
- **节流落库 0.8s**：不是每 delta 写库（MySQL 写放大），也不是结束时一次性写（断线丢全程）；节流窗口内合并刷新
- **断线续播**：会话按消息 ID 记录已推送偏移，前端重连携带消息 ID 从断点续拉
- **abort 语义**：用户手动中止 → 任务取消 → 状态落库 aborted(3) 并 aclose 上游连接；上游异常 → 落库已生成部分（status=2），不留半截脏数据
- **越权防护**：abort 注册表按会话归属校验，跨用户操作直接拒绝
- 边界用例进了测试：跨 TCP 包的半截 SSE 事件重组、非 JSON 事件透传不崩溃

### 2.3 自研 LangChain Agent（第五种后端）

- 选型对比后**不用 LangGraph**：教学场景工具数少、链路需完全可控可调试，且要直出 OpenAI 兼容 SSE 复用现有采集器。手动 tool-calling 循环 ~200 行拿到同构能力
- 工具集：`current_time` / `calculator`（AST 白名单解析，拒绝 `eval`）/ `fetch_url`（四层 SSRF 防护：协议白名单 → DNS 解析私网/链路本地段拦截 → 重定向逐跳复检 → 超时+最大字节数限制）/ `web_search` + `fetch_page`（DeepSeek 官方计费 API，错误码转模型可读文本不中断循环）/ MinerU MCP（langchain-mcp-adapters 接入 3 个工具）
- **工具路由硬规则**：文档类附件（PDF/Office/图片）只允许走 MinerU 解析，失败如实报告——严禁模型自作主张降级用 fetch_url 抓二进制（曾实测出现乱码输出，改为规则约束后消除）
- **MCP 双 transport**：托管端点 streamable_http 优先，故障时自动降级本地 stdio（uvx）；托管端鉴权实测为自定义头 `MINERU_API_TOKEN`（标准 Bearer 被网关 scope 拦截）——排查后写死适配

### 2.4 MinerU 文档解析（三链路统一状态机）

PDF/Word/PPT/图片/网页链接 → Markdown + HTML 预览 + 模板化 Word 三件产物：

- 三条入口（文档管理 / 智能解析页 / Open WebUI 兼容网关）共享同一状态机：submitted → running → completed/failed
- **双路径推进**：正常走回调（SHA-256 签名校验防伪造）；回调不可达（本机开发无公网）时轮询主动拉取状态自愈，任务不会永久卡死
- **大文件拆分**：>200MB / >200 页自动拆批量任务，完成后 python-docx 合并还原
- 踩坑修复：MinerU 返回 docx 图片 bbox 缩放 bug——解包后自行按 bbox 重绘修复

### 2.5 前端工程

- @ant-design/x 全家桶：useXChat（消息流编排）+ XRequest（SSE 请求）+ ThoughtChain（工具过程可视化）+ Conversations + Bubble
- 自定义 ChatProvider 工厂统一 6 后端；SSE 接口**绕过 Umi dev 代理**（HPM 会缓冲流式响应导致"卡一下全出来"），生产 nginx 用 `proxy_buffering off` 对齐
- **移动端适配**：实测定位桌面 CSS hack（负边距隐藏侧栏）泄漏到 ProLayout 移动端 inline Drawer 导致内容移出屏幕、抽屉无法关闭——改为 <768px 由 ProLayout 原生抽屉驱动，桌面专属样式全部加 `@media (min-width:768px)` 限定；Playwright 390×844 视口 e2e 回归
- **非安全上下文兼容**：局域网 IP 的 HTTP 访问下 `crypto.randomUUID` 不存在（仅 HTTPS/localhost 提供），页面初始化即崩——封装三级降级（randomUUID → getRandomValues 构造 v4 → 时间戳兜底）

### 2.6 工程化与质量

- Docker Compose：MySQL 健康检查 → 后端 env_file 注入密钥 → 前端 nginx 静态托管 + /api 反代，一键 `docker compose up -d --build`
- 依赖治理实例：接入 MCP 时连带升级 starlette 1.x，破坏 FastAPI Router API——以 `starlette<0.42` 版本护栏 + `pydantic>=2.11` 组合锁定兼容区间
- 测试：后端 unittest 105 条（覆盖各适配器 + 采集器编排核心路径）/ 前端 vitest 137 条 / Playwright e2e 跨桌面+移动双端
- 鉴权从 `mock_token` 重构为常量化 `sa_session_token`（8 文件零残留），命名对齐生产习惯

---

## 三、面试 STAR 口述脚本（挑 2~3 个讲）

### 故事 1：SSE 会话持久化采集器
- **S**：多后端对话都要求刷新/断线后能恢复，且中途可中止；各家事件流格式不同
- **T**：做一层统一持久化，不侵入各后端适配器
- **A**：采集/转发解耦；0.8s 节流落库平衡写放大与断线损失；abort 落 aborted 态；异常落已生成部分；越权按会话归属拦截
- **R**：4 个后端复用同一条链路；核心路径 7 条测试用例（含跨包半截 SSE 重组）全过

### 故事 2：MCP 文档解析集成踩坑
- **S**：需求要求文档解析走 MinerU MCP，托管端点持续 404
- **T**：不能让上游故障阻断对话
- **A**：逐层排查发现鉴权要用自定义头 `MINERU_API_TOKEN`（Bearer 被 scope 拦）；404 属上游 staging 故障（4 个来源复现）——实现 streamable_http/stdio 双 transport 自动降级；期间 mcp 依赖拖升 starlette 破坏 FastAPI，用版本护栏锁住
- **R**：上游故障时本地兜底不受影响；依赖冲突有护栏防回归

### 故事 3：移动端整屏移出的 bug 定位
- **S**：手机端 hermes 页主内容区整体移出屏幕、抽屉点不开关不掉
- **T**：定位并修复，同时不能影响桌面端行为
- **A**：390×844 视口实测 + 溯源，发现桌面侧栏 CSS hack（margin-inline-start:-280px）作用于 ProLayout 移动端 Drawer 结构；`collapsed={false}` 被强制注入导致抽屉卡死。改为 useIsMobile 断点分支 + 原生抽屉驱动 + 桌面样式 @media 限定
- **R**：移动端全部交互恢复，桌面停靠/窥视行为零变化；沉淀 e2e 脚本防回归

---

## 四、高频追问与回答要点

| 追问 | 要点 |
|------|------|
| 为什么不用 LangGraph/LangChain Agent 原生抽象？ | 场景工具少、链路要可控可调试、需直出 OpenAI 兼容 SSE 复用现有采集器；手动循环 ~200 行，依赖面小，升级 langchain 1.5 核验过覆写钩子仍有效 |
| 断线续播具体怎么实现？ | 服务端按消息维度记录内容与状态；前端重连携消息 ID，已结束回放全文、进行中从断点续推（采集器节流窗口保证不重不漏粒度） |
| 如何防止 Agent 乱用工具？ | 工具描述写清边界 + 系统提示词硬规则（文档只走 MinerU、搜索仅在需要实时信息时）+ 服务端校验（URL 防护、calculator AST 白名单）；失败输出转模型可读文本供其自行纠偏 |
| SSE 为什么不走 dev proxy？ | HPM（http-proxy-middleware）默认缓冲响应体，流式变"攒一坨"；生产 nginx 对应配置 `proxy_buffering off` + `chunked_transfer_encoding on` |
| 上下文超长怎么办？ | langchain_agent 多轮采用消息全量携带 + 上下文截断策略；各模型 context_tokens 注册表化，支持 env 按模型覆写 |
| 多租户数据隔离？ | 所有会话/消息/文件接口按 userid 过滤；abort 注册表同样校验归属；测试覆盖跨用户拒绝路径 |
| 项目最难的点？ | 不是单个技术点，而是"6 个上游 × 一套 UI"的协议归一：三种模式分层、事件流翻译保持语义、持久化层对上层透明——最终新增后端成本降到"一个 router 文件" |

---

## 五、数字卡片（面试随口引用）

| 指标 | 数值 |
|------|------|
| 代码规模 | ~5 万行（前后端） |
| 对话后端 | 6 种 / 3 种集成模式 |
| REST 接口 | 94 个 |
| 数据表 | 18 张 |
| 自动化测试 | 242 条（后端 105 + 前端 137）+ Playwright e2e |
| LLM Agent 工具 | 8 个（时间/计算器/URL 抓取/搜索/网页抓取/MCP 解析×3） |
| 文档解析产物 | Markdown + HTML + Word 三件套，三链路共享状态机 |

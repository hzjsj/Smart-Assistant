# 开发会话总结（2026-11-13 ~ 2026-11-16）

> 本文档记录本轮 AI 辅助开发会话中提出的需求、解决的问题与最终交付状态。
> 分支：`feature/project-polish`（含全部历史提交，已推送 gitee）。

## 一、会话总览

| 维度 | 数据 |
|------|------|
| 提出需求 | 12 项（运行部署 / 功能开发 / 缺陷修复 / 分析评估 / 文档输出） |
| 产出提交 | 6 个（`dc9d852` → `cf7d475`，约 1900 行新增） |
| 分支 | `feature/assistant-migration` → `feature/langchain-agent` → `feature/project-polish`（均已推送 gitee） |
| 测试 | 后端 **105 用例全过**（新增 15+7）· 前端 **137 用例全过** |

## 二、需求与解决问题清单（按时间序）

### 1. 运行前后端项目 ✅
- 多次拉起/重启后端（FastAPI :5000，`--host 0.0.0.0` 支持局域网真机）与前端（UmiJS :8000）
- 排障：AirPlay 端口占用风险确认、MySQL 连接配置核实（实际 3306）、服务意外终止后自动恢复

### 2. 功能总结与分支提交 ✅
- 总结 assistant-migration（hermes 迁移）提交内容；创建 `feature/assistant-migration` 分支推送 gitee

### 3. 修复 hermes 移动端样式与点击失效（核心缺陷）✅
- **实测定位**（390×844 视口）：主内容区被 CSS 负边距整体移出屏幕、侧栏抽屉卡死无法关闭、「收起侧栏」按钮失效、「展开导航」被遮挡
- **根因**：桌面侧栏隐藏方案（负边距 + translateX）作用到 ProLayout 移动端 inline Drawer 结构上
- **修复**：新增 `useIsMobile` 断点钩子；`<768px` 改由 ProLayout 原生抽屉驱动开合（遮罩/Esc/选会话均可关闭）；桌面专属 CSS 全部加 `@media (min-width:768px)` 限定；移动端选会话自动收起抽屉
- **回归**：桌面端停靠侧栏 / 收起动画 / 豆包式 hover 窥视行为完全不变

### 4. 修复局域网访问崩溃 `crypto.randomUUID is not a function` ✅
- **根因**：`crypto.randomUUID` 仅存在于安全上下文（HTTPS/localhost），局域网 IP 的 HTTP 访问为非安全上下文，页面初始化即崩
- **修复**：新增 `utils/uuid.ts` 三级降级（randomUUID → getRandomValues 构造 v4 → 时间戳兜底）
- 顺带修复：SPA 内部跳转进入时移动端抽屉默认展开的不一致

### 5. LangChain 技能（Skill）支持分析（两次，仅分析）✅
- 结论：langchain 核心无技能概念，官方方案在 `deepagents`（SKILL.md 渐进披露，绑定 LangGraph 架构）；自研手动循环可用约 30 行实现同构机制（目录注入 + load_skill 工具）；本机已有 8 个业务 SKILL.md 可复用

### 6. langchain 1.5.0 / core 1.8.0 / openai 1.8.0 升级分析 ✅
- 版本链自洽（langgraph 1.2.22 / protocol 0.0.21）；唯一破坏性变更为 Python ≥3.11（不影响）
- 逐一核对源码确认 `ReasoningChatOpenAI` 覆写钩子在 1.8.0 仍存在且必要（第三方 reasoning_content 仍不被原生提取）
- `requirements.txt` 固化版本

### 7. 自研 LangChain Agent 对话后端（第五种模型）✅
- 新增 `langchain_agent/` 模块：手动 tool-calling 循环（非 LangGraph）产出 OpenAI 兼容 SSE，接入 conversations 采集器（落库/续播/abort 全复用）
- 工具注册表：current_time / calculator（AST 白名单）/ fetch_url（SSRF 四层防护）/ web_search / fetch_page / MinerU MCP（parse_documents 等 3 工具）
- 前端第五种模型「LangChain Agent」6 处接入，Provider 解析层零改动
- 实测：工具循环（时间+计算器）→ 过程面板实时展示 → 正确回答

### 8. DeepSeek 联网搜索集成 ✅
- `web_search` / `fetch_page` 工具对接 DeepSeek 官方 Search/Fetch 计费 API（0.005 元/次成功请求）
- `LANGCHAIN_ENABLE_WEB_TOOLS` 开关（默认跟随 DEEPSEEK_API_KEY）；错误码转模型可读文本不中断循环
- 实测：答对训练数据之外的实时问题（DeepSeek V4 发布时间）

### 9. MinerU MCP 文档解析接入 ✅
- `langchain-mcp-adapters` 双 transport：streamable_http（托管）/ stdio（本地 uvx，生产 API v4 兜底）
- **排障记录**：托管端点鉴权头实测为同名自定义头 `MINERU_API_TOKEN`（Bearer 被网关 scope 拦截）；托管 staging 解析后端 404 属上游故障（4 个不同来源复现），本地 stdio 模式不受影响
- **依赖治理**：mcp 连带升级 starlette 1.x 破坏 fastapi Router API——以 `starlette<0.42` 护栏 + pydantic≥2.11 组合解决

### 10. 工具路由硬性规则 ✅
- 文档（PDF/Office/图片）解析只使用 MinerU parse_documents，失败如实告知、严禁降级 fetch_url/fetch_page 抓二进制
- 附件按扩展名分流引导；web_search 仅在用户要求搜索或需要实时信息时使用
- 行为实测：解析失败时如实报告，不再出现二进制乱码输出

### 11. OpenClaw Gateway 对话后端（第六种模型）✅
- `openclaw/` 模块：OpenAI 兼容直通透传（deepseek 同款，零适配器）
- 多轮会话：`user` 字段 = conversations 表 ID（同值复用上游 agent 会话），带会话 ID 只发末条用户消息
- **端到端实测三层记忆**：会话内多轮召回（王小明/42）、跨会话 USER.md 持久记忆、UI 多轮上下文复述
- ⚠️ 成本特性：每次调用 ≈15K prompt tokens（完整 agent 系统提示）

### 12. P0 工程化优化（简历竞争力）✅
- **根 README 重写**：定位/亮点/Mermaid 架构图/六后端对比表/双启动指南/16 模块清单/量化数据（5 万行 · 94 接口 · 207 测试）
- **Docker 一键启动**：compose 三服务编排（MySQL 健康检查 + 后端 env_file + 前端 nginx 反代）；SSE 关键配置 `proxy_buffering off`
- **鉴权命名专业化**：`mock_token`/`mock-` → `sa_session_token`/`sa-`（常量统一提取，8 文件零残留，登录实测生效）
- **采集器核心路径测试**（7 用例）：正常流/跨包半截 SSE 重组/abort 落库/异常落库/注册表越权/非 JSON 透传
- **核心 AI 功能文档**：README 补充切题（EduTutor）与 MinerU 三链路状态机章节
- 顺带修复预存问题：hermes 测试鉴权 override 缺 userid、shuban macOS /tmp 路径比较、PyMuPDF 补装

## 三、遗留事项

| 事项 | 说明 |
|------|------|
| Docker 镜像构建验证 | 本机未装 Docker，compose 语法已校验；待有 Docker 环境执行 `docker compose up -d --build` |
| MinerU 托管端点故障 | staging 解析接口 404（上游问题），期间用本地 stdio 模式兜底；恢复后无需改代码 |
| hermes 网关未启动 | 远端 8642 未监听，智能组卷（question_bank）依赖它 |
| dify `DIFY_AGENT_ID` 缺失 | `.env` 补配即修复 /api/dify/info 500 |
| SKILL.md 技能机制 | 已完成方案分析（自研 L2 渐进披露），待排期实施 |
| 密钥轮换 | MinerU token 与 OpenClaw key 曾在对话中明文出现，建议平台侧轮换 |
| 待推送/合并 | `feature/project-polish` 领先 master 多个提交，可发起 PR 或合并 |

## 四、会话期间 gitee 提交记录

```
cf7d475 chore(project): P0 工程化优化（README 重写/Docker 一键启动/鉴权命名/采集器测试）
995c203 feat(openclaw): 新增 OpenClaw Gateway 对话后端（第六种模型）
35b94a5 feat(langchain): 接入 DeepSeek 联网搜索与 MinerU MCP 文档解析
ec6125e feat(langchain): 新增自研 LangChain Agent 对话后端（第五种模型）
b53898d fix(hermes): 移动端适配与局域网真机访问修复
dc9d852 chore(qieti): 格式化 questions.json 测试数据（内容不变）
```

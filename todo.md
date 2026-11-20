# 优化待办清单

> 来源：2026-10-26 前后端项目与数据库连接分析（FastAPI 后端 + UmiJS 前端 + MySQL）
> 2026-11-20 补充：全量代码评估新增第 16–30 条，并复核第 1–15 条进展（均仍未完成，个别有部分进展）
> 状态标记：`[ ]` 待处理 / `[x]` 已完成

## P1 安全与部署阻塞（上生产前必须处理）

- [ ] **1. CORS 通配符 + 凭据组合**
  - 位置：`smart-backend/main.py:53-59`
  - 问题：`allow_origins=["*"]` 与 `allow_credentials=True` 同时开启，Starlette 会回显任意 Origin，任何网站都能携带用户 Cookie 调用 API 并读取响应；目前仅靠 Cookie 的 `SameSite=Lax` 兜底
  - 建议：改为显式白名单，从 env `CORS_ALLOW_ORIGINS` 读取（逗号分隔），开发默认 `["http://localhost:8000", "http://127.0.0.1:8000"]`（覆盖 umi dev 端口与 chat/chatbot SSE 跨域直连），生产加正式域名

- [ ] **2. 会话 Cookie 未设 HttpOnly（现共 3 处）**
  - 位置：`smart-backend/users/router.py:87`（账号登录）、`:121`（ticket 登录）、`wecom/router.py:95`（企微登录——11 月新增代码复制了同一缺陷）
  - 问题：`httponly=False` 使 7 天有效期的会话 token 可被任意 XSS 脚本读取
  - 建议：改 `httponly=True`（改完回归验证前端无 JS 读 cookie，先 `grep document.cookie`），生产再按 env `COOKIE_SECURE` 加 `secure=True`

- [ ] **3. 前端硬编码 `http://localhost:5000`（剩 3 处）**
  - 进展（2026-11-20）：copilot 与 hermes 已改为环境判断/同源模式，剩 `chat/service.ts:7`、`chatbot/service.ts:4`、`generate-test-paper/service.ts:5`（后者 7 个函数全部使用该常量）
  - 问题：SSE 流式请求绕过 dev 代理直连写死的地址，局域网 IP 访问（如 192.168.x.x:8000）时 AI 对话/组卷全部失败；生产部署浏览器会请求自己的 localhost，直接坏
  - 建议：收敛为共享常量，参照 `copilot/index.tsx:211-215`、`hermes/service.ts:11-14` 的现成模式（开发取 hostname、生产同源）；nginx `proxy_buffering off` 已配好

- [ ] **4. 切题上传记录无用户隔离**
  - 位置：`smart-backend/qieti/models.py`（`QietiUploadRecord` 无 uid 列）、`qieti/router.py` 的 `/records` 端点不按用户过滤
  - 问题：任何登录用户可看到所有人的上传记录，与项目其他模块（file_records.uid、chat_sessions.user_id）的隔离做法不一致
  - 建议：加 `uid` 列（注意需手动 ALTER TABLE），写入与查询均按当前用户过滤；与第 7、19 条合并实施

- [ ] **16. documents 模块 6 个端点完全无鉴权（本清单最高优先级）**
  - 位置：`smart-backend/documents/router.py:246`（upload，uid 仅可选提取）、`:305`（handle_file，无鉴权无属主校验）、`:332` / `:342`（download / download-md 公开下载）、`:478`（mineru_upload，同样匿名可调）
  - 问题：匿名用户可触发 MinerU 任务与 OSS 转存（费用与存储滥用）；handle_file 的 401 只在 `responses=` 里声明从未实际执行，任何人可重命名/删除任意用户的文件记录
  - 建议：6 处全部加 `Depends(get_current_user)`，uid 直接取 `current_user.userid`；handle_file 与下载加属主校验（admin 放行，uid 为 NULL 的历史遗留记录下载放行并注释）；顺带把 download_md_file 的 `.contains()` 子串匹配改为精确匹配

- [ ] **17. markdown 图片转存存在 SSRF**
  - 位置：`smart-backend/documents/router.py:78-87`（_try_upload 抓取 markdown 内任意 http URL）→ `utils/oss_upload.py:90-129`（upload_url_to_oss 服务器端下载后转存公开 OSS）；另 `mineru/router.py:62-70`（extract/submit 的 pdf_url 未校验）
  - 问题：攻击者上传含 `![x](http://169.254.169.254/latest/meta-data/...)` 的文档，可通过 OSS URL 读回内网响应；`utils/url_guard.validate_public_url` 已存在但未用在此处（chat、qieti 已在用）
  - 建议：在 `upload_url_to_oss` 入口统一过 `validate_public_url`（一处收口覆盖所有调用方），mineru pdf_url 同样处理

- [ ] **18. 试卷数据无属主隔离**
  - 位置：`smart-backend/generate_test_paper/router.py:236-247`（list_exams 不过滤 user_id，`crud.get_exam_list` 已支持）、`:250-256`（detail）、`:259-265`（remove）
  - 问题：任何登录用户可读取/删除他人试卷
  - 建议：list 按 user 过滤，detail/remove 属主校验（admin 放行），非属主返回 404/403

- [ ] **19. qieti snapshot 全局单行互相覆盖**
  - 位置：`smart-backend/qieti/models.py:31`（`snapshot_key='latest'` 全局单行）、`qieti/crud.py:51-73`
  - 问题：所有用户共享一行云快照，互相覆盖；本地 localStorage 副本虽在，云端备份语义失效
  - 建议：与第 4、7 条合并——两张表加 uid 列 + `(uid, created_at)` 索引，snapshot 键改 `latest:<uid>`，旧 `'latest'` 行做一次只读回退（避免现有用户云备份"消失"）

- [ ] **20. 敏感信息已提交进仓库**
  - 位置：`smart-backend/db/smart_assistant.sql`（2.4MB 全量 dump，含 2 条 bcrypt 密码哈希的用户数据）；`docker-compose.yml:17,25`（MySQL root 密码明文提交）
  - 建议：git rm + .gitignore 补充；仓库将来公开前需重写历史；compose 密码改 env 变量

## P2 性能与扩展性

- [ ] **5. async 端点内事件循环阻塞**
  - 位置：`smart-backend/mineru/proxy.py:211`（`async def download_zip` 内同步 `_requests.get(..., timeout=60)`）
  - 问题：最坏情况整个后端（单 worker）所有请求卡住 60 秒；确认点仅此一处，proxy 透传已是 httpx.AsyncClient 正确写法
  - 建议：改 `asyncio.to_thread` 或 httpx 异步
  - 附带：大量 `async def` 端点直接跑 pymysql ORM（qieti、generate_test_paper 等），纯 DB 端点建议改用 `def` 让 FastAPI 自动进线程池

- [ ] **6. 长 IO 期间占用连接池连接（部分进展）**
  - 位置：`smart-backend/documents/router.py` `upload_file` / `mineru_upload_file`（246、478 行起）
  - 进展（2026-11-20）：zip 分支已把 `get_sync_db` 传入线程（:279），但 `Depends(get_db)` 会话仍贯穿整个 `asyncio.to_thread` 重活（分钟级 pandoc + OSS 转存），并发上传超 30 仍会触发 `pool_timeout`
  - 建议：先查完 uid 提交关闭会话再进线程，线程内用 `get_sync_db`

- [ ] **7. 缺索引**
  - `qieti_upload_records`：除主键外零索引，且为高频按时间倒序查询的增长表 → 建议 `(uid, created_at)` 复合索引（随第 4 项一起做）
  - `exams.user_id`：无索引，但 `generate_test_paper/crud.py:55` 按 user_id 过滤 → 建议加 `index=True`

- [ ] **8. "用户 ID" 列类型不统一**
  - `chat_sessions.user_id` String(50) / `exams.user_id` Integer / `file_records.uid` String(36) / `user_sessions.user_id` Integer
  - 当前无跨表 JOIN 不影响正确性，新表统一即可，老表择机迁移

- [ ] **9. MySQL 运行参数调优**
  - `long_query_time=10s` 太宽松 → 建议 1s
  - `innodb_buffer_pool_size=128MB`（默认值），`knowledge_point` 已 7MB/1.4 万行 → 生产前调 512MB+
  - 连接池本身（database.py:68-77）配置已完备，无需改

- [ ] **21. 上传大小无上限**
  - 位置：`smart-backend/documents/router.py:139-149`（分片落盘但无 cap）、`qieti/router.py:140-158`（`await file.read()` 全量读进内存后才处理，无类型/大小校验）
  - 问题：大文件可打满磁盘/内存（资源滥用面）
  - 建议：参照已有实现抽统一 save_upload helper——`mineru/attachment_service.py:25-74`（扩展名 + 50MB cap）、`shuban/router.py:373-377,464-469`（流式 500MB cap）

- [ ] **22. 知识点树 N+1 查询（全库最差 N+1）**
  - 位置：`smart-backend/generate_test_paper/router.py:329-348、393-414`（build_tree 每个节点查一次 KnowledgePoint，一棵课程树可达数百次查询）
  - 建议：一次取整棵子树后在 Python 按 parent_id 组装

- [ ] **23. chat 查询无上限**
  - 位置：`smart-backend/chat/crud.py:26-51`（list_sessions_grouped 全量加载该用户所有会话）、`:135-151`（build_context 拉 500 条含全文的消息只为了拼上下文）、`:118-127`（get_messages 单次 500 条 MEDIUMTEXT）
  - 建议：参照 `conversations/crud.py:73-90` 的单查询分组 + 限额模式

- [ ] **24. 前端生产 bundle 夹带 swagger-ui-dist 与 sourcemap**
  - 位置：`smart-frontend/dist`（3.0MB `swagger-ui-dist` async chunk + 全部 .map 随部署公开，dist 总量约 300MB）
  - 建议：排除 swagger-ui-dist 与 .map 出生产产物；顺带清理 package.json 脚手架残留依赖（mockjs、express、@umijs/request-record、gh-pages、react-doctor 等）

## P3 工程健壮性（择机处理）

- [ ] **10. 无迁移框架的兜底自检**
  - 昨日 `login_tables` 漏建表实例：`create_all` 只建缺失表不补列，进程带旧代码启动时连缺失表也不建
  - 建议引入 Alembic；最低成本：将「模型 metadata vs 库结构 diff」脚本固化为启动自检，漂移时打警告（`conversations/models.py:60-67` 已有一个从未执行的 MIGRATIONS 列表，是这一问题的症候）

- [ ] **11. 部署约束：必须单 worker**
  - `mineru/proxy.py` 的 `_BATCHES`、`mineru/service.py` 的 `_syncing_ids`/`_sync_executor` 为进程内状态，多 worker 即失效

- [ ] **12. /docs 公开无门禁**
  - 生产建议 `FastAPI(docs_url=None)` 或加 IP 白名单/鉴权

- [ ] **13. user_sessions 僵尸行**
  - 过期会话仅在所属用户下次登录时清理，不活跃用户的过期行永久残留（量小，加定期清理即可）

- [ ] **14. 每请求两次用户查询**
  - `auth.py:18-21` 先查 user_sessions 再查 users，可 JOIN 合并（量大后再做）

- [ ] **15. 删除遗留表 `ppt_convert_tasks`**
  - 库中存在但模型未定义，确认无用后 `DROP TABLE`（需手动执行，无迁移框架）

- [ ] **25. 无 CI**
  - 现状：后端 8 个 unittest 模块 + 前端 24 个 vitest 文件只能手动跑（README 里是手工粘贴的长命令）
  - 建议：加 GitHub Actions / Gitee 工作流：后端 unittest + 前端 `npm run test && npm run lint`；其余各项的修复都需要这张回归网兜底

- [ ] **26. biome 关闭了 noExplicitAny 与 useExhaustiveDependencies**
  - 位置：`biome.json:37-44`；src 内 246 处 any
  - 问题：直接催生大量 ref workaround（`chat/index.tsx:358` activeKeyRef、qieti cut autoDetectRef 等）
  - 建议：重新开启并渐进清理（从 useXChat 泛型与 provider 转型处开始）

- [ ] **27. 双 QueryClientProvider**
  - 位置：umi reactQuery 插件注入一个（`config/config.ts:157` 开启）+ `src/app.tsx:205-212` 手动又包一个
  - 问题：两个嵌套缓存，`invalidateQueries` 可能打到内层 client，页面的失效调用是空操作（`chat/index.tsx:451`、`document-list/index.tsx:47`、`table-list/*` 等）
  - 建议：去掉手动 provider（或关插件），清理无效 invalidateQueries；顺带给 react-query 配 staleTime/retry 默认值

- [ ] **28. 流式中止与竞态**
  - 位置：chat/chatbot/copilot 切会话不 abort 在途 XRequest（仅 Sender 停止按钮会）；`generate-test-paper/service.ts:42-154` 无 AbortSignal、卸载后 setState 仍触发；`chat/index.tsx:366` 刷新会话列表会覆盖本地草稿对话（`chatbot/index.tsx:250-253` 已正确保留，chat 未修）；`copilot/index.tsx:507` `catch(() => {})` 吞错
  - 建议：统一 AbortController 传递 + 修 chat 草稿竞态 + 历史加载失败给出提示

- [ ] **29. 重复代码收敛**
  - 后端：SSE 代理骨架（settings/headers/错误处理/SSE 帧构造）在 deepseek/hermes/openclaw/dify/bailian 各复制一份（约 500 行）；OSS 客户端构造两处（`utils/oss_upload.py:29-38`、`mineru/attachment_service.py:36-46`）；附件注入 prompt 3 份；图片 URL→OSS 改写正则 4 处
  - 前端：`createChatProvider` 工厂 4 份、模型注册表/思考开关/历史恢复在 chat、chatbot、copilot 三页各一份（约 1000 行）；`chatbot/api.ts` 与 `services/chat.ts` 端点重复；同一个 `POST /api/files` 两处请求体不一致（`document-list/index.tsx:43` 传 key、`mineru/service.ts:96` 传 id）
  - 建议：抽共享模块；`fast-api-manage` 16 个生成模块中 14 个无人引用（含 1006 行 typings），删除或全面采用

- [ ] **30. 死代码与文档漂移清理**
  - 死代码：`RightContent/LangDropdown.tsx`（i18n 移除后空壳仍被渲染）、`generate-test-paper/service.ts:425-453`（调试用 generateQuestionsSync）、模板 demo 页与 mock、后端 `documents/router.py:352-364` 注释端点、空 `agent/` 目录
  - 文档漂移：`smart-frontend/README.md` 仍是 ant-design-pro 模板、`CLAUDE.md` 仍写 Jest/i18n（实际 vitest/无 i18n）、`AGENTS.md` 说后端无测试（实际 8 个 unittest 模块）、Dockerfile 用 python:3.13 与 AGENTS.md 的 3.10+ 不一致
  - 卫生：前端 login 页残留 23 处 `[wecom-login]` console 调试日志、`?username=&password=` URL 自动登录功能（明文凭据进历史记录，代码注释已自知风险）

## 建议处理顺序（2026-11-20 更新）

1. 第 **16、17、18** 条一次提交收口（documents 鉴权 + SSRF + 试卷属主，主题同源、改动集中在 documents/router.py）
2. 第 **1、2、3** 条（几行级改动：CORS 白名单、httponly×3、localhost 收敛——上生产的最后一块硬门槛）
3. 第 **4、7、19** 条一起做（qieti 一次 ALTER：加 uid 列 + 索引 + snapshot 按 uid 键）；顺带第 20 条（git rm dump、compose 密码改 env）
4. 第 **5、6、21、22** 条（部署并发上来之前完成）
5. 第 **25** 条（CI）宜早不宜迟——后面每一项修复都需要它兜底
6. 其余择机

# 优化待办清单

> 来源：2026-10-26 前后端项目与数据库连接分析（FastAPI 后端 + UmiJS 前端 + MySQL）
> 2026-11-20 补充：全量代码评估新增第 16–30 条
> **2026-11-21：分阶段优化落地完成（路线见 ARCHITECTURE.md），多数条目已勾选**；剩余项为运维/手动/渐进清理
> 状态标记：`[ ]` 待处理 / `[x]` 已完成

## P1 安全与部署阻塞（上生产前必须处理）

- [x] **1. CORS 通配符 + 凭据组合**（2026-11-21 ✅ Phase A）
  - `main.py` 改为 env `CORS_ALLOW_ORIGINS` 白名单（默认放行本机前端），evil.com 已验证不回显
- [x] **2. 会话 Cookie 未设 HttpOnly（3 处）**（2026-11-21 ✅ Phase A）
  - 三处登录统一走 `users.sessions.set_session_cookie`（`httponly=True`，`secure` 由 env `COOKIE_SECURE` 控制）
- [x] **3. 前端硬编码 `http://localhost:5000`**（2026-11-21 ✅ Phase C）
  - 收敛到 `src/utils/apiBase.ts` 的 `API_BASE`（开发按主机直连 5000 / 生产同源），chat/chatbot/组卷全部接入并浏览器实测流式
- [x] **4. 切题上传记录无用户隔离**（2026-11-21 ✅ Phase B）
  - 两表加 `uid` 列 + `(uid, created_at)` 索引（幂等迁移 `utils/schema_upgrade.py`），records/snapshot 全部按用户过滤
- [x] **16. documents 模块 6 个端点完全无鉴权**（2026-11-21 ✅ Phase A）
  - 6 端点全部 `Depends(get_current_user)` + 属主校验（admin 放行 / uid=NULL 遗留记录下载放行）；`download-md` 补文件名精确复核
- [x] **17. markdown 图片转存存在 SSRF**（2026-11-21 ✅ Phase A）
  - `upload_url_to_oss` 入口统一过 `validate_public_url`；mineru `pdf_url` 同样校验（内网/元数据/file:// 均已实测拦截）
- [x] **18. 试卷数据无属主隔离**（2026-11-21 ✅ Phase A）
  - list 按 user 过滤（admin 全量）、detail/remove 属主校验
- [x] **19. qieti snapshot 全局单行互相覆盖**（2026-11-21 ✅ Phase B）
  - 快照键改 `latest:<uid>`；旧 `'latest'` 行不回退读取（避免跨用户泄漏，本地 localStorage 副本不受影响）
- [x] **20. 敏感信息已提交进仓库**（2026-11-21 ✅ Phase A）
  - `db/smart_assistant.sql` 已 git rm + .gitignore；compose 的 MySQL 密码改 `${MYSQL_ROOT_PASSWORD:?}` 强制注入

## P2 性能与扩展性

- [x] **5. async 端点内事件循环阻塞**（2026-11-21 ✅ Phase D）
  - `mineru/proxy.py download_zip` 改 httpx 异步
- [x] **6. 长 IO 期间占用连接池连接**（2026-11-21 ✅ Phase D）
  - `auth.get_current_user` 校验后即断开会话；documents 上传端点不再注入 `get_db`
- [x] **7. 缺索引**（2026-11-21 ✅ Phase B）
  - `qieti_upload_records (uid, created_at)` 复合索引；`exams.user_id` 暂无索引（低频，择机）
- [x] **8. "用户 ID" 列类型不统一**（2026-11-21 文档化 ✅）
  - 新表统一 String(50) 的约定已写入 ARCHITECTURE.md；老表迁移择机
- [ ] **9. MySQL 运行参数调优**（运维项，不动代码）
  - `long_query_time` → 1s；`innodb_buffer_pool_size` 生产前调 512MB+
- [x] **21. 上传大小无上限**（2026-11-21 ✅ Phase B）
  - `utils/upload_guard.py`：documents 100MB / mineru 200MB / qieti 50MB（env 可覆盖），qieti 扩展名白名单
- [x] **22. 知识点树 N+1 查询**（2026-11-21 ✅ Phase D）
  - `_build_knowledge_tree` 单次查询 + 内存组装，两处树端点共用
- [x] **23. chat 查询无上限**（2026-11-21 ✅ Phase D）
  - `list_sessions_grouped` 限 200 条；`build_context` 回看限 200 条
- [ ] **24. 前端生产 bundle 夹带 swagger-ui-dist 与 sourcemap**
  - 未动：待一次 `npm run build` 分析 chunk 来源后排除（swagger-ui-dist 在 package.json 模板残留依赖里）

## P3 工程健壮性（择机处理）

- [x] **10. 无迁移框架的兜底自检**（2026-11-21 ✅ Phase D，最低成本方案）
  - `utils/schema_upgrade.py`（幂等加列/索引）+ `utils/schema_audit.py`（启动漂移告警）；完整 Alembic 列二期
- [x] **11. 部署约束：必须单 worker**（2026-11-21 文档化 ✅）
  - 已写入 ARCHITECTURE.md §2.5，不做改造
- [x] **12. /docs 公开无门禁**（2026-11-21 ✅ Phase C）
  - env `API_DOCS_ENABLED=false` 时 docs/redoc/openapi 三入口全关（默认开启，dev 不受影响）
- [x] **13. user_sessions 僵尸行**（2026-11-21 ✅ Phase C）
  - `cleanup_expired_sessions` 启动全量清理 + 登录时按用户顺带清理
- [x] **14. 每请求两次用户查询**（2026-11-21 ✅ Phase D）
  - `auth.get_current_user` 改单次 JOIN
- [ ] **15. 删除遗留表 `ppt_convert_tasks`**（需手动执行）
  - 确认无用后执行：`DROP TABLE ppt_convert_tasks;`
- [x] **25. 无 CI**（2026-11-21 ✅ Phase F）
  - `.github/workflows/check.yml`（后端 unittest + MySQL 服务容器 / 前端 lint+tsc+vitest）+ 本地等价 `scripts/check.sh`；Gitee 端可按语义迁 Gitee Go
- [ ] **26. biome 规则渐进开启**（2026-11-21 部分完成）
  - `noExplicitAny` 与 `useExhaustiveDependencies` 已开为 **warn** 级（不阻断，可见化）；纠错为 error 级需先清零 246 处 any，渐进进行
- [x] **27. 双 QueryClientProvider**（2026-11-21 ✅ Phase C）
  - 移除 `app.tsx` 手动 Provider（umi 插件统一注入），5 处无效 `invalidateQueries` 一并清理
- [x] **28. 流式中止与竞态**（2026-11-21 ✅ Phase E）
  - chat/chatbot/copilot 切会话 `abort()`；组卷流加 AbortSignal（卸载/重生成中止）；chat 草稿竞态修复（对齐 chatbot）；copilot 吞错改为用户可见提示
- [x] **29. 重复代码收敛**（2026-11-21 ✅ 主体完成）
  - 后端：`chat_proxy/http.py` 合并 5 份代理骨架 + providers 迁移 + conversations 收口（`8452d49`）
  - 前端：`@/components/chat-kit`（provider 工厂/模型注册表/ChatKitThink）三页接入；chatbot/api.ts 并入 services/chat（`60f3ba9`）
  - 残留：4 种下载 helper 合并（`utils/download.ts` 待做）、组卷页模型菜单抽取、hermes attachments/answerToDocx 内部改用 downloadBlob
- [x] **30. 死代码与文档漂移清理**（2026-11-21 ✅ 主体完成）
  - 已删：`pages/list/`、4 个未用共享组件、LangDropdown、`utils/format.ts`、`hermes/.artifacts/`、README.zh-CN.md；前端 README/CLAUDE.md/AGENTS.md 漂移已修正
  - 残留：login 页 23 处 `[wecom-login]` console 调试日志、`?username=&password=` URL 自动登录功能（需产品决策）

## 建议处理顺序（已执行）

1. ~~第 16、17、18 条~~ → Phase A（`fac7c01`）
2. ~~第 1、2、3 条~~ → Phase A / C（`fac7c01` / `03f64af`）
3. ~~第 4、7、19 条 + 第 20 条~~ → Phase B / A（`9f3b083` / `fac7c01`）
4. ~~第 5、6、21、22、23 条~~ → Phase D / B
5. ~~第 25 条 CI~~ → Phase F（`cab8651`）
6. ~~第 26、27、28、29、30 条~~ → Phase C / E / F（主体完成，残留项见上方标注）

**剩余**：第 24 条（构建分析）、26/29/30 的残留子项、运维项 9/15。

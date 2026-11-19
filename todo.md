# 优化待办清单

> 来源：2026-10-26 前后端项目与数据库连接分析（FastAPI 后端 + UmiJS 前端 + MySQL）
> 状态标记：`[ ]` 待处理 / `[x]` 已完成

## P1 安全与部署阻塞（上生产前必须处理）

- [ ] **1. CORS 通配符 + 凭据组合**
  - 位置：`smart-backend/main.py:42-48`
  - 问题：`allow_origins=["*"]` 与 `allow_credentials=True` 同时开启，Starlette 会回显任意 Origin，任何网站都能携带用户 Cookie 调用 API 并读取响应；目前仅靠 Cookie 的 `SameSite=Lax` 兜底
  - 建议：改为显式白名单，开发环境 `["http://localhost:8000"]`，生产加正式域名

- [ ] **2. 会话 Cookie 未设 HttpOnly**
  - 位置：`smart-backend/users/router.py:86,120`（`/api/login/account` 与 `/api/login/ticket` 两处 `set_cookie`）
  - 问题：`httponly=False` 使 7 天有效期的 `mock_token` 可被任意 XSS 脚本读取
  - 建议：改 `httponly=True`（改完回归验证前端无 JS 读 cookie 的地方），生产再加 `secure=True`

- [ ] **3. 前端 4 处硬编码 `http://localhost:5000`**
  - 位置：`smart-frontend/src/pages/chat/service.ts:7`、`chatbot/service.ts:4`、`copilot/index.tsx:309`、`generate-test-paper/service.ts:5`
  - 问题：SSE 流式请求绕过 dev 代理直连写死的地址，局域网 IP 访问（如 192.168.x.x:8000）时 AI 对话/组卷全部失败；生产部署同样受影响
  - 建议：收敛为统一常量/环境变量，生产走相对路径 + nginx（`proxy_buffering off`）

- [ ] **4. 切题上传记录无用户隔离**
  - 位置：`smart-backend/qieti/models.py`（`QietiUploadRecord` 无 uid 列）、`qieti/router.py` 的 `/records` 端点不按用户过滤
  - 问题：任何登录用户可看到所有人的上传记录，与项目其他模块（file_records.uid、chat_sessions.user_id）的隔离做法不一致
  - 建议：加 `uid` 列（注意需手动 ALTER TABLE），写入与查询均按当前用户过滤

## P2 性能与扩展性

- [ ] **5. async 端点内事件循环阻塞**
  - 位置：`smart-backend/mineru/proxy.py:211`（`async def download_zip` 内同步 `_requests.get(..., timeout=60)`）
  - 问题：最坏情况整个后端（单 worker）所有请求卡住 60 秒；确认点仅此一处，proxy 透传已是 httpx.AsyncClient 正确写法
  - 建议：改 `asyncio.to_thread` 或 httpx 异步
  - 附带：大量 `async def` 端点直接跑 pymysql ORM（qieti、generate_test_paper 等），纯 DB 端点建议改用 `def` 让 FastAPI 自动进线程池

- [ ] **6. 长 IO 期间占用连接池连接**
  - 位置：`smart-backend/documents/router.py` `upload_file` / `mineru_upload_file`（246、478 行起）
  - 问题：`Depends(get_db)` 会话贯穿整个 `asyncio.to_thread` 重活（pandoc 转换 + OSS 图片转存，分钟级），连接空占；并发上传超 30 触发 `pool_timeout`
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

## P3 工程健壮性（择机处理）

- [ ] **10. 无迁移框架的兜底自检**
  - 昨日 `login_tables` 漏建表实例：`create_all` 只建缺失表不补列，进程带旧代码启动时连缺失表也不建
  - 建议引入 Alembic；最低成本：将「模型 metadata vs 库结构 diff」脚本固化为启动自检，漂移时打警告

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

## 建议处理顺序

1. 第 1、2、3 项（决定能否安全上生产，改动都很小）
2. 第 4、7 项一起做（同一张表：加 uid 列 + 索引，一次 ALTER）
3. 第 5、6 项（部署并发上来之前完成即可）
4. 其余择机

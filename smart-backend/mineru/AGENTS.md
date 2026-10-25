# mineru 模块 Agent 指南

> 供 AI Agent / 开发者快速熟悉 mineru 模块的功能、数据流、数据库结构与注意事项。
> 最后更新：2026-10-25（本会话实现的功能均已提交 master 分支，截至 70e711f）

## 一、模块全景

mineru 模块提供**三条并行的文档解析链路**，共享同一套状态推进与产物处理机制：

| 链路 | 入口 | 场景 |
|---|---|---|
| 文档管理页 | `POST /api/files/mineru/upload`（documents/router.py） | 系统内文档解析（同步上传） |
| /mineru 页面 | 同上接口 + `POST /api/mineru/extract/submit`（网页链接） | 前端"智能解析"页（文件/网页双入口） |
| Open WebUI 网关 | `/api/mineru/proxy/*`（proxy.py，MinerU Cloud API 兼容形态） | 外部系统接入（超限大文件自动拆分） |

所有链路的产物统一为三件：**Markdown（oss_md_url）/ HTML 预览（oss_html_url）/ Word（oss_word_url）**，
全部转存到项目自己的阿里云 OSS（kdsa 公读桶），图片为永久外链。

前端页面 `/mineru`（smart-frontend/src/pages/mineru/）：智能解析首页（默认视图，上传文件/
网页链接双按钮）+ 任务管理（真实数据/三态/收藏/搜索筛选）+ 我的收藏，全屏独立路由（layout:false）。

## 二、文件地图

```
mineru/
├── router.py        路由：extract/submit（网页链接）、extract/status/{id}（状态查询）、
│                    callback（MinerU 回调，SHA256 签名校验）、tasks（任务列表/分页/搜索/
│                    状态/收藏筛选）、tasks/{id}/favorite（收藏切换）
├── service.py       核心：submit_task_to_mineru（提交，带 extra_formats=[docx,html] 与
│                    模型参数）、process_mineru_zip（结果 zip 处理：下载→解压→修图片路径→
│                    MD/Word/HTML 转存 OSS→落库）、handle_mineru_done（回调/轮询共用的
│                    完成入口）、sync_submitted_tasks（轮询自愈：单任务+批量两分支）、
│                    ensure_html_preview（历史任务 HTML 惰性补齐）、_download_zip_robust
│                    （CDN 下载，代理 fake-ip 劫持时经阿里 DoH 解析真实 IP 直连）
├── batch.py         超限文件（>200MB 或 >200 页）批量流程：split_pdf（平分+超限份对半
│                    再拆，写出校验实际字节数）、批量申请/上传/查状态、merge_docx
│                    （python-docx 拼接分片原生 docx）、process_mineru_batch（合并落库）
├── fix_docx.py      docx 工具：fix_docx_image_sizes（按 layout.json 的 bbox 修复 MinerU
│                    原生 docx 图片"放大 2.8 倍"的 bug，EMU = pt × 12700）、
│                    apply_template（套用 utils/template.docx：styles 模板为底+分片样式
│                    补齐、sectPr 换 A4 版式、theme1.xml 换模板字体）、TEMPLATE_DOCX 常量
├── proxy.py         Open WebUI 兼容网关（MinerU Cloud API 兼容形态，详见第七节）
├── schemas.py       SubmitRequest（pdf_url + 模型参数）/ CallbackRequest
└── DESIGN.md        早期设计文档（部分内容已过时，以本文件为准）
```

关联文件：`documents/router.py` 的 `_process_mineru_upload`（上传→OSS→提交/拆分分流，
proxy.py 复用它）、`documents/models.py` 的 `FileRecord`、`utils/oss_upload.py`（OSS 上传
与 pandoc 转 Word，`convert_md_file_to_docx` 自带 `--reference-doc=template.docx`）。

## 三、解析状态机与两条推进路径

```
上传/提交 → submitted ──┬── 回调（callback，部署环境公网可达时）──→
                        └── 轮询自愈（sync_submitted_tasks，任何环境）──→
                              单任务：查 /extract/task/{id} → done 则 handle_mineru_done
                              批量：  查 /extract-results/batch/{id}
                                      全部 done → handle_mineru_batch_done（合并）
                                      任一 failed → error
                        → 下载结果 zip → MD/图片/HTML/Word 转存 OSS → done
                        → 任一环节失败 → error（原因写 mineru_error，前端可见）
```

- **轮询自愈是主推路径**：前端任务页每 8 秒拉 `/api/mineru/tasks` 时触发后台 sync
  （`_syncing_ids` 进程内去重，fire-and-forget 不阻塞响应）。本机开发回调不可达也正常流转。
- **回调**（`POST /api/mineru/callback`）：校验 sha256(uid+seed+content)，与轮询互为冗余。
  `.env` 的 `MINERU_CALLBACK_URL` 须指向公网可达地址（如 cloudstudio 域名）；本机 dev
  收不到属正常，可用构造签名请求到 localhost 的方式测试回调处理逻辑。
- **历史任务 HTML 补齐**（ensure_html_preview）：done 且有 MD 无 HTML 的旧记录，拉列表时
  后台用 pandoc 补生成（注意 `resp.encoding = "utf-8"`：OSS 的 .md 响应无 charset，
  requests 默认 ISO-8859-1 解码会中文乱码）。
- **失败原因记录**：四处落库点（单任务轮询失败/批量分片失败/结果处理异常/回调失败），
  `mineru_error` 前端失败状态下直接展示 + hover 全文。

## 四、数据库结构（file_records 本会话新增列，部署环境需手动 ALTER TABLE）

| 列 | 类型 | 用途 |
|---|---|---|
| oss_html_url | VARCHAR(500) NULL | HTML 预览地址（extra_formats 原生生成或 pandoc 补齐） |
| favorite | TINYINT(1) NOT NULL DEFAULT 0 | 收藏标记 |
| mineru_batch_id | VARCHAR(100) NULL | 批量任务 ID（超限拆分场景；单任务为 NULL） |
| mineru_error | VARCHAR(1000) NULL | 解析失败原因（error 时有值，其他状态自动清空） |

任务列表查询条件是 `mineru_task_id IS NOT NULL OR mineru_batch_id IS NOT NULL`
（两类任务都算 MinerU 任务，改 crud.get_mineru_tasks 时注意别丢 OR 分支）。

部署环境统一执行：
```sql
ALTER TABLE file_records ADD COLUMN oss_html_url VARCHAR(500) NULL;
ALTER TABLE file_records ADD COLUMN favorite TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE file_records ADD COLUMN mineru_batch_id VARCHAR(100) NULL;
ALTER TABLE file_records ADD COLUMN mineru_error VARCHAR(1000) NULL;
```

## 五、大文件批量拆分（超 200MB 或 200 页自动触发，对外接口不变）

1. **判断**：仅 PDF（needs_split）。
2. **平分**：按页数（≤190/份）与体积（≤190MB/份）双限制算最少份数 N，总页数等分（页数差 ≤1）。
3. **超限份局部对半再拆**：每份写出后校验**实际字节数**（页面资源分布不均时估算不可靠，
   实测教材 31 页插图占 189MB），仍超 200MB 的份对半重写直至达标，已达标份不动。
4. **批量提交**：`POST /api/v4/file-urls/batch`（data_id="part-N" 编码顺序）→ PUT 逐片上传
   （平台自动提交解析）。
5. **合并**（process_mineru_batch）：按 data_id 排序下载各片 zip → full.md 按序拼接 →
   图片 hash 名汇总去重上传 OSS → pandoc 生成 HTML；**Word 优先 docx 级拼接**（各片原生
   docx 先修图片尺寸，python-docx 合并：image part 用 get_or_add_image 防 media 重名丢图、
   rId 三种引用重映射、分片间分页符），再套模板；分片无原生 docx 才回退 pandoc。
6. 单批上限 50 片；**批量任务不走回调**（回调按单文件 task_id 无法匹配 batch 记录），
   完全靠轮询自愈。

## 六、Word 产物格式化（utils/template.docx，三条路径全覆盖）

1. 单任务原生 docx：`fix_docx_image_sizes`（修图片尺寸）→ `apply_template`
2. 批量合并：`merge_docx`（拼接）→ `apply_template`
3. pandoc 兜底：`convert_md_file_to_docx` 自带 `--reference-doc=template.docx`（项目原有）

**apply_template 三个动作**（zip 级操作；python-docx 无跨文档样式迁移能力，官方文档确认）：
- styles.xml：模板为底（样式 ID 体系 1,2,3... 与 MinerU docx 同源）+ 追加分片缺失样式
  （判重按 styleId——元素按 ID 引用样式；同名不同 ID 打警告）
- sectPr：替换为模板 A4 版式（上 2.5 / 左右 3.2cm）
- **theme1.xml：整体替换——关键！**样式表字体是主题引用（minorHanssi/minorEastAsia），
  不换主题则实际字体仍是 MinerU 的（Aptos/等线），模板字体（Calibri/宋体）不生效。
- numbering 不动（保留列表编号）；模板文件缺失时跳过格式化不阻断（日志有"已套用模板"）。

**已知边界**：纯文本文档（layout.json 无图片块）是正常场景，fix_docx_image_sizes 原样
复制返回空列表，不要当异常抛（曾导致"结果包处理失败"）。修复前生成的历史产物仍是旧
格式（等线字体），把 mineru_state 重置为 submitted 可触发重处理刷新产物。

## 七、Open WebUI 兼容网关（proxy.py）

Open WebUI 配置 `MINERU_API_URL={MINERU_PROXY_PUBLIC_BASE}/api/mineru/proxy`、
`MINERU_API_KEY=原 MINERU_TOKEN` 即接入。五条路由：

| 路由 | 作用 |
|---|---|
| POST /file-urls/batch | 生成内部 batch_id，file_urls 指向本服务（使文件经手我们 → 启用拆分能力） |
| PUT /upload/{batch_id}/{index} | 接收文件字节 → 复用 `_process_mineru_upload`（自动分流） |
| GET /extract-results/batch/{id} | 按 MinerU 格式聚合状态（顺带触发 sync 自愈）；state 映射 submitted→running |
| GET /zip/{record_id} | 取 oss_md_url 打包（图片已 OSS 外链）；异常 302 回退原始 zip |
| 其余路径 | 透传 mineru.net/api/v4/*（归一化去 api/v4 前缀，Authorization 透传） |

- 鉴权：仅申请上传 URL 和透传接口要求 `Authorization: Bearer` == MINERU_TOKEN；预签名上传、轮询、结果下载不鉴权（Open WebUI 这些请求不携带 API Key）
- batch↔记录关联存内存 `_BATCHES`（重启丢失仅导致 Open WebUI 重新上传，可接受）
- 配置 `MINERU_PROXY_PUBLIC_BASE`：Open WebUI 可达的本服务地址（.env）

## 八、验证方法（Agent 排障/回归用）

```bash
# 登录拿 cookie（本机 dev）
TOKEN=$(curl -s -X POST http://localhost:5000/api/login/account -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ant.design"}' -c - | grep mock_token | awk '{print $NF}')

# 拉任务列表（同时触发轮询自愈，最常用的推进方式）
curl -s "http://localhost:5000/api/mineru/tasks?current=1&pageSize=10" -b "mock_token=$TOKEN"

# 模拟回调（本机测试）：checksum = sha256(MINERU_UID + MINERU_SEED + content)
# content = {"task_id": "...", "state": "done", "full_zip_url": "..."}

# Word 模板验证：下载 oss_word_url 解包，查 sectPr 边距（模板特征 3.2cm）+ theme1.xml 字体（Calibri/宋体）

# 批量拆分日志：grep "拆分校验\|平分\|批量拆分\|已套用模板" 后端日志
```

- 本机 dev 数据库：127.0.0.1:3306（系统 MySQL，root 密码见 .env），库名 smart_assistant
- 测试素材：`~/Downloads/mineru/mineru-api/`（高考数学卷 4 页）、
  `~/Downloads/ccc5598afa864064b94d971b83dc7bfc.pdf`（291 页/133MB）、
  `~/Downloads/（根据2022年版课程标准修订）...英语 九年级全一册.pdf`（222 页/227.9MB
  插图密集，拆分算法压测专用）
- 构造多页测试 PDF：pypdf 循环 add_page 复制高考卷页面

## 九、已知限制与注意事项

1. **MinerU 平台限制**：≤200MB/≤200 页（超限走拆分）；.md 文件不支持（error 预期）；
   html 源必须 model_version=MinerU-HTML——前端按 URL 扩展名白名单自动选模型
   （文档扩展名 pdf/docx/ppt/xls/图片→vlm，其余→MinerU-HTML）；VLM 处理 html 会报
   "cannot process html files"。
2. **MinerU 偶发 401**（平台瞬时故障）：重试即恢复；频繁 401 需更换 .env 的 MINERU_TOKEN。
3. **CDN 下载 SSL 失败**：本机代理 fake-ip 劫持 DNS 所致，`_download_zip_robust` 已内置
   DoH 兜底，不要"简化"掉它。
4. **extra_formats=[docx,html]**：markdown/json 默认导出无须设置；对 html 源文件无效
   （该场景 Word 自动回退 pandoc）。
5. **本机环境**：MySQL 3306（系统服务开机自启）；后端 5000 `--reload` 热重载；前端 8000。
   数据库列变更需手动 ALTER TABLE（无迁移框架）。
6. **前端**：/mineru 页面为全屏路由（layout:false），默认视图=智能解析页；任务页 8s 轮询；
   biome + tsc 检查（biome.json 对 task.css 有局部规则豁免：!important/重复属性/媒体查询）。
7. **git**：本会话功能已全部提交 master 分支（ac0e3a3...70e711f 共 7 个提交），未推送远端。

# Hermes 题库接口

所有新增后端逻辑限于本目录。router.py 引入本模块的模型，注册在现有 main.py 启动 create_all 之前，因此不需修改 main.py、database.py 或其他业务模块。运行时数据表为 hermes_question_banks、hermes_papers、hermes_exports；均绑定 user_id。表模型继承现有 TimestampMixin。

## API

全部沿用 get_current_user 鉴权，其他用户的资源统一返回 404。

| 方法 | 路径（前缀 /api/hermes/v1） | 行为 |
| --- | --- | --- |
| POST | /question-banks/import | url 或 document 二选一导入，规范化并持久化 |
| GET | /question-banks/{id} | 获取当前用户已校验题库 |
| GET | /question-banks/{id}/download | JSON attachment 下载 |
| POST | /papers | bank_id、selected_ids、title、include_answers 创建选题快照 |
| GET | /papers/{id} | 获取快照 |
| POST | /papers/{id}/exports | format=docx/xlsx/json，生成文件 |
| POST | /papers/{id}/exports/pdf | 接收当前试卷预览生成的 PDF，限 30MB，校验真实 PDF 后保存 |
| GET | /exports/{id} | 获取生成状态和文件元信息 |
| GET | /exports/{id}/download | 所属用户下载已生成文件 |

POST 文件生成运行于工作线程，不阻塞 SSE 事件循环；结果为 ready 或错误，生成中记录可通过状态接口查询。不是独立的持久化任务队列，服务中断时需要重试导出。

## 远程文件源站

默认允许 HERMES_AGENT_BASE_URL 的主机，以及现有 OSS_BUCKET + OSS_ENDPOINT 对应的对象存储主机。其他可信文件域名可通过进程环境 HERMES_ARTIFACT_ALLOWED_HOSTS 追加，逗号分隔纯主机名；此功能不修改目录外的 .env。

也可直接编辑本目录的 `artifact_hosts.json`，`allowed_hosts` 数组支持多个域名，例如：

```json
{
  "allowed_hosts": [
    "kdsa.oss-cn-shanghai.aliyuncs.com",
    "files.example.com"
  ]
}
```

示例中的 `files.example.com` 需替换为实际可信源站。已预置用户提供的 kdsa OSS 域名。配置文件、环境变量和默认主机取并集，均为精确主机名匹配；不填协议、端口、路径或通配符，子域名需要单独加入。文件在导入校验时读取，修改后下次导入即可生效；环境变量更改需要重启后端。配置文件损坏时明确报错，不放宽校验。

只允许 HTTP/HTTPS，拒绝含用户名/密码、link-local、multicast、无效地址，所有重定向再次验证主机。最多 3 次跳转，连接超时 10 秒、读取超时 30 秒，JSON 最多 5MB / 500 题。不转发 Hermes API Key 或用户 Cookie 到文件源站；不提供任意 URL 的开放代理。配置为可信源站的服务应自行保证其域名解析可信。

已导入的同一用户题库按源地址/内容复用快照，即使外部签名 URL 过期也可继续读取已保存题目。不同用户仍分别授权、存储和读取。新 URL 内容更新会形成新快照；相同 URL 的重复导入默认沿用已保存版本。

## 生成文件

目录 storage 在首次导出时创建，文件使用内部随机 id 命名，通过接口返回中文下载名；该目录在本模块内的 .gitignore 中忽略。文件丢失时返回明确错误并允许重新导出。

Word 使用现有 pypandoc，并启用 sandbox 禁止任意资源读取；数学公式转 OMML，答案按用户选择另起一页。xlsx 使用标准库 zipfile/XML，不增加 openpyxl 依赖；题目明细逐题对应快照，知识点汇总按首个知识点归类（完整知识点列表在明细中保留），每个统计维度独立合计 100%。分值未完整标注时不编造分值占比。

PDF 复用前端已有浏览器排版链路，经接口验证文件头、页面和大小后保存。后端没有静默安装 LibreOffice 或新增目录外依赖配置。

Word 中题号与题干为同一段落，按题型显示中文大题编号，并以快照实际题数、每题分值和总分生成大题说明。混合分值不假定同分，缺失分值不编造总分，与前端预览约定一致。

## 执行步骤与能力边界

聊天接口继续透传现有真实工具、状态和确认事件。只有用户提交组卷表单的请求使用 `task="question_bank"` 和结构化 `paper_config`；后端校验后注入工作台协议，将当前用户消息重建为规范化表单要求。普通请求默认 `task="chat"`，保留历史消息且不注入题库规则。同一会话的后续提问也不会自动继续组卷。

组卷配置字段为 subject、grade、knowledge_points、question_types、quantity、difficulty、exam_type、remarks。数量 1～50、难度 1～10，均为整数；知识点与题型去重，备注最多 4000 字。组卷缺失配置、普通聊天混入配置、题数少于已选题型数均返回 422。未给各题型数量时默认均分，余数按已选顺序分配；用户备注有明确分配时由上游按备注执行且总数必须一致。

task 和 paper_config 是本地接口扩展，在请求上游前移除；上游地址、模型及密钥继续由服务端配置。模板仅用于本次表单请求，不写回历史。提示词不能替代上游的文件生成/发布工具，不能代替数学正确性检查，也不伪造执行事件；现有导入校验不因本次请求改造而变成逐份生成任务的题数验收。

## 验证

```powershell
venv/Scripts/python.exe -m unittest hermes.tests.test_workspace -v
venv/Scripts/python.exe -m unittest hermes.tests.test_chat_requests -v
```

测试使用内存 SQLite、独立用户身份、模块内临时文件；覆盖校验、去重、用户隔离、快照顺序/分值、真实 docx 原生公式、xlsx 两个工作表、PDF 校验和下载。serve_workspace 是单独的集成测试入口，不能作为正式服务启动。

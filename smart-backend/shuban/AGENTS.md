# 书版工作台与 Word 转 FBD

本目录实现方正书版文件导入、结构检查、浏览器近似预览，以及 Word 文档按模板转换为 FBD。

## 两种上传流程

前端入口位于 `smart-frontend/src/pages/shuban/index.tsx`。上传组件接受 `.docx`、`.zip`、`.fbd`、`.pro` 及预览图片格式；`.docx` 会在 `beforeUpload` 中拦截，不会走普通文件上传 API。

### FBD、配套文件和 ZIP

普通文件走 `POST /api/shuban/upload`，保存到 `smart-backend/uploads/shuban/{userid}/`。支持：

- `.fbd`、`.pro`、`.zip`
- `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.svg`、`.tif`、`.tiff`、`.bmp`、`.eps`、`.ps`

单个上传文件最大 500 MB。ZIP 上传包最多 1000 个文件，解压后总量最多 512 MB，包内单个可导入文件最大 50 MB。ZIP 会拒绝重复路径（忽略大小写）、加密文件、符号链接和非法路径；不支持的扩展名会跳过。

FBD 文件须位于 ZIP 根目录。若所有条目统一放在一个外层目录，服务会去掉该层；FBD 旁边的图片子目录会保留。去掉外层目录后仍嵌套在子目录中的 FBD 会被拒绝。图片目录和图片相对路径应按 FBD 注解实际引用关系组织。

导入后，`GET /api/shuban/files` 返回当前用户根目录中的 FBD 清单。选中文件后，前端调用 `/files/{filename}/report`、`/tokens`、`/ast`、`/text` 和 `/preview` 获取结构报告、注解、语法树、文本及 HTML 近似预览；`/word` 可导出 Word。所有接口使用当前用户会话，文件按用户目录隔离。

### Word 转 FBD

仅接受 `.docx`，不接受 `.doc` 或 `.docm`。前端先请求 `GET /api/shuban/word-templates`，展示模板选择弹窗，再以 multipart 表单调用 `POST /api/shuban/word-conversions`，字段为 `file` 和 `template_id`。Word 文件最大 500 MB。

服务端会校验 DOCX 容器：最多 2000 个 ZIP 条目、单条目最大 100 MB、解包总量最大 512 MB，并要求包含 `word/document.xml`。转换中间文件位于当前用户的 `word-conversions/{conversion_id}/` 子目录；成功后删除临时源 DOCX。

成功响应包含 `fileName`、`templateName`、`contentVerified`、`warnings`、`geometry`、`previewUrl` 和 `downloadUrl`。前端展示转换告警和内容核对状态，并提供打开预览及下载 ZIP 的操作。预览和 ZIP 分别通过 `GET /api/shuban/word-conversions/{id}/preview` 与 `GET /api/shuban/word-conversions/{id}/download` 获取。

## 可选模板

模板定义在 `word_templates.py`，FBD/PRO 和模板图片位于 `templates/word_fbd/`。

| 模板 ID | 用途 | 页面与版心 | 分栏 |
| --- | --- | --- | --- |
| `math-main-3col` | 大联考数学正文（三栏 A3） | 页面 426×303 mm；版心 380×265 mm | 3 栏，栏距 10 mm |
| `math-booklet-2col` | 大联考数学小夹册 | 页面 206×296 mm；成品 200×290 mm；版心 170×260 mm | 2 栏，栏距 8.4 mm |

模板查询只返回 `header.fbd` 与 `template.PRO` 均存在的模板。新增模板时，同时登记尺寸、栏数、间距和模式，并提供匹配的 FBD/PRO 基底及所需 EPS 素材。

## DOCX 转换步骤

1. `word_conversion.py` 校验 DOCX，生成安全文件名，并通过 UTF-8 子进程调用 `tools/docx_to_series_fbd.py`。
2. `parse_body()` 读取 Word 段落、表格、样式、OMML 公式和图片关系；表格按单元格保留段落边界，图片按原 DPI 提取为 TIFF。
3. 转换器按模板组装书眉版头、正文注解、表格和配套素材。正文模板只使用首个 `FL` 开栏前的版头字节；夹册按配置的版头行区间取模板，不能把带示例正文的整份模板复制进新文件。
4. Word 字体、字号、答案样式、上下标、圈码、制表符、表格和图片分别映射到 FBD 字体注解、`AC/AD`、`A1/A3`、`KG`、`BG/BH`、`XC` 等结构。数学符号使用显式映射；不要对全文盲目执行 NFKC，以免改动公式语义。
5. FBD 与配套 PRO 写出后运行 `fbdgen.validate()`，并将 Word 文本与 FBD 可见文本逐字符核对。转换器同时检查 FL 开闭顺序；FL 嵌套或多余闭栏会作为告警返回。
6. 生成浏览器近似预览、`转换核对.json`、`转换问题说明.txt` 和 ZIP。浏览器预览用于检查内容与结构，最终分页和发排效果以方正书版实际发排为准。

正文模板的版头提取、夹册版头区间、每份文档末尾的 FL 闭合必须保持一致。修改 FL 生成逻辑时，注意同一分栏未关闭前不能再次开栏，文件尾不能重复输出闭栏。

## 字符错误与告警

已知 GBK 不支持但可安全近似的字符放在 `SYMBOL_MAP` 中显式映射；内容核对使用 `CONTENT_SYMBOL_MAP` 将格式控制符归一为可比较文本。新增映射前应检查源文档上下文，尤其是全等、约等于、上下标和自定义运算符，禁止静默丢字符。

生成阶段仍遇到无法编码的字符时，会以可见占位符 `□` 写入 FBD，并将原字符、码位、出现次数和最多 5 个小样段落位置记录到 `转换核对.json` 与 `转换问题说明.txt`。该结果会继续生成预览和 ZIP，但内容核对会失败并在前端显示告警；占位符未替换前不得视为可直接发排的最终稿。

结构告警、内容核对差异和已知模板字节告警会显示在 Word 排版结果弹窗，并记录到 ZIP 内的 `转换问题说明.txt`。ZIP 还包括 FBD、PRO、预览、核对 JSON 和生成 FBD 实际引用的 TIFF/EPS 文件。原始 DOCX 不放入结果 ZIP。

无效或损坏的 DOCX、超出大小限制、模板/转换器缺失，以及未生成 FBD/PRO 等致命错误会通过 API `detail` 返回并清理该次临时转换目录；此时不会有可下载的转换结果 ZIP。

## 维护入口

- `router.py`：普通 FBD/ZIP 上传、Word 模板与转换 API、预览和 ZIP 下载。
- `word_templates.py`：模板登记和模板元数据。
- `word_conversion.py`：DOCX 安全校验、子进程执行、FBD 结构检查、预览生成和结果打包。
- `tools/docx_to_series_fbd.py`：Word/XML 解析、样式/公式/表格/图片映射与 FBD 生成。
- `tools/fbdgen.py`：GBK/控制符编码、FBD 校验和预览辅助。
- `smart-frontend/src/pages/shuban/service.ts`：Word 模板与转换 API 客户端。
- `smart-frontend/src/pages/shuban/index.tsx`：文件选择、模板弹窗、结果预览、告警和 ZIP 下载交互。

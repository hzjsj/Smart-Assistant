// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Oss Md Text To Docx Markdown 文本 → Word（.docx）→ 上传 OSS，返回下载地址。

供 copilot / generate-test-paper 页面导出 Word 使用。 POST /api/oss/convert-md-text-to-docx */
export async function ossMdTextToDocxApiOssConvertMdTextToDocxPost(
  body: API.OssMdTextToDocxRequest,
  options?: { [key: string]: any }
) {
  return request<API.OssMdToDocxResponse>("/api/oss/convert-md-text-to-docx", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

// 回答内容转 Word 并触发浏览器下载（chat / copilot 页面共用）
import { ossMdTextToDocxApiOssConvertMdTextToDocxPost } from '@/services/fast-api-manage/osSwenjianshangchuan';

/** 清理文件名：去掉 .md/.markdown 后缀与路径非法字符 */
export const sanitizeDocName = (name: string) =>
  name
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();

/** 把 Markdown 回答转成 docx 并下载；失败抛错由调用方提示 */
export async function downloadAnswerAsDocx(content: string, baseName: string) {
  const safeName = sanitizeDocName(baseName) || '文档';
  const result = await ossMdTextToDocxApiOssConvertMdTextToDocxPost({
    md_content: content,
    filename: safeName,
  });
  if (!result?.url) throw new Error('转换服务未返回下载地址');
  const response = await fetch(result.url);
  if (!response.ok) throw new Error('下载失败');
  const fileBlob = await response.blob();
  const blob = new Blob([fileBlob], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `${safeName}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

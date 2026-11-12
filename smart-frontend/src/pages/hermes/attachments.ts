export interface MessageAttachment {
  url: string;
  name: string;
  extension: string;
  label: string;
  icon: 'word' | 'pdf' | 'excel' | 'markdown' | 'zip' | 'ppt' | 'default';
}

const fileTypes: Record<string, Pick<MessageAttachment, 'label' | 'icon'>> = {
  doc: { label: 'Word 文档', icon: 'word' },
  docx: { label: 'Word 文档', icon: 'word' },
  pdf: { label: 'PDF 文档', icon: 'pdf' },
  xls: { label: 'Excel 表格', icon: 'excel' },
  xlsx: { label: 'Excel 表格', icon: 'excel' },
  xlsm: { label: 'Excel 表格', icon: 'excel' },
  csv: { label: 'CSV 表格', icon: 'excel' },
  tsv: { label: 'TSV 表格', icon: 'excel' },
  md: { label: 'Markdown 文档', icon: 'markdown' },
  markdown: { label: 'Markdown 文档', icon: 'markdown' },
  zip: { label: 'ZIP 压缩包', icon: 'zip' },
  rar: { label: 'RAR 压缩包', icon: 'zip' },
  '7z': { label: '7Z 压缩包', icon: 'zip' },
  ppt: { label: 'PowerPoint 演示文稿', icon: 'ppt' },
  pptx: { label: 'PowerPoint 演示文稿', icon: 'ppt' },
  txt: { label: '文本文件', icon: 'default' },
  json: { label: 'JSON 文件', icon: 'default' },
};

const decodeName = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function getMessageAttachment(
  href: string,
  linkText = '',
  baseUrl = window.location.href,
): MessageAttachment | null {
  try {
    const url = new URL(href, baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const pathName = decodeName(url.pathname.split('/').pop() || '');
    // An explicit HTML page stays a webpage even when its link label mentions
    // a filename (for example a readme.md documentation page).
    if (/\.x?html?$/i.test(pathName)) return null;
    const candidates = [
      pathName,
      url.searchParams.get('filename') ||
        url.searchParams.get('fileName') ||
        '',
      linkText.trim(),
    ];
    for (const candidate of candidates) {
      const extension = candidate.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
      if (!extension || !fileTypes[extension]) continue;
      const name = candidate.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_');
      return { url: url.href, name, extension, ...fileTypes[extension] };
    }
  } catch {
    // Invalid or incomplete streamed URLs are not downloadable attachments.
  }
  return null;
}

/** Use parsed anchors so Markdown references, punctuation and URL parentheses work. */
export function collectMessageAttachments(
  root: HTMLElement,
): MessageAttachment[] {
  const files = new Map<string, MessageAttachment>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.closest('pre, code')) continue;
    const attachment = getMessageAttachment(
      link.getAttribute('href') || '',
      link.textContent || '',
    );
    if (!attachment) continue;
    const key = new URL(attachment.url);
    key.hash = '';
    if (!files.has(key.href)) files.set(key.href, attachment);
  }
  return [...files.values()];
}

export async function downloadMessageAttachment(
  attachment: MessageAttachment,
): Promise<void> {
  const response = await fetch(attachment.url, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`下载失败（${response.status}）`);
  if (response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('文件地址返回了网页，请检查下载地址或登录状态');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = attachment.name;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Keep the object URL alive until the browser has started the download.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

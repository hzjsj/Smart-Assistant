/** 简易请求限速器：保证请求按固定间隔发出，避免打爆外部识别接口 */
export function createRequestScheduler(requestsPerSecond = 5) {
  const interval = Math.ceil(1000 / Math.max(1, requestsPerSecond));
  let nextStartTime = Date.now();

  return async <T>(task: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const scheduledTime = Math.max(now, nextStartTime);
    nextStartTime = scheduledTime + interval;

    const waitMs = scheduledTime - now;
    if (waitMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    }
    return await task();
  };
}

/** 下载文本内容为文件 */
export function downloadTextFile(
  content: string,
  filename: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

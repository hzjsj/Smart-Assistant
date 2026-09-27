import type { UploadApiResponse } from '../data';

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function getImageSize(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

export async function dataUrlToFile(
  dataUrl: string,
  filename: string,
): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

/** 从上传响应中提取远程图片 URL（兼容多种字段位置） */
export function extractUploadedImageUrl(
  payload: UploadApiResponse | null | undefined,
): string | null {
  const candidates = [payload?.url];
  return (
    candidates.find(
      (item) => typeof item === 'string' && /^https?:\/\//.test(item),
    ) || null
  );
}

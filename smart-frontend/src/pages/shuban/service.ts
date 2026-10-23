import { request } from '@umijs/max';
import type { ShubanAst, ShubanFile, ShubanReport, ShubanToken } from './data';

const API_BASE = '/api/shuban';

export type WordTemplate = {
  id: string;
  name: string;
  description: string;
  pageWidth: number;
  pageHeight: number;
  columns: number;
  columnGap: number;
};

export type WordConversionResult = {
  id: string;
  templateId: string;
  templateName: string;
  fileName: string;
  previewFile: string;
  zipFile: string;
  contentVerified: boolean;
  warnings: string[];
  geometry?: { page?: number[]; columns?: number; column_w?: number; column_gap?: number };
  previewUrl: string;
  downloadUrl: string;
};

export type SaveWordConversionResult = {
  document: ShubanFile;
  success: boolean;
  fbdFileName: string;
  savedFiles: string[];
  unchangedFiles: string[];
  unchanged: boolean;
};

async function withErrorDetail<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const err = error as {
      response?: { data?: { detail?: string } };
      data?: { detail?: string };
      message?: string;
    };
    throw new Error(
      String(err.response?.data?.detail || err.data?.detail || err.message || '请求失败'),
    );
  }
}

export type ImportResult = {
  documents: ShubanFile[];
  files: string[];
  ignoredCount: number;
  unchanged: boolean;
};

export async function listFiles(signal?: AbortSignal): Promise<{ files: ShubanFile[] }> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files`, { method: 'GET', skipErrorHandler: true, signal }),
  );
}

export async function getReport(filename: string, signal?: AbortSignal): Promise<ShubanReport> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/report`, {
      method: 'GET',
      skipErrorHandler: true,
      signal,
    }),
  );
}

export async function getTokens(filename: string, signal?: AbortSignal): Promise<ShubanToken[]> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/tokens`, {
      method: 'GET',
      skipErrorHandler: true,
      signal,
    }),
  );
}

export async function getAst(filename: string, signal?: AbortSignal): Promise<ShubanAst> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/ast`, {
      method: 'GET',
      skipErrorHandler: true,
      signal,
    }),
  );
}

export async function getText(
  filename: string,
  plain = false,
  signal?: AbortSignal,
): Promise<{ text: string }> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/text`, {
      method: 'GET',
      params: { plain },
      skipErrorHandler: true,
      signal,
    }),
  );
}

export async function getPreview(filename: string, signal?: AbortSignal): Promise<string> {
  return withErrorDetail(async () => {
    const response = await fetch(
      `${API_BASE}/files/${encodeURIComponent(filename)}/preview`,
      { credentials: 'same-origin', cache: 'no-store', signal },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      throw new Error(body.detail || '排版预览加载失败');
    }
    return response.text();
  });
}

export async function importFiles(
  files: File[],
  documentId: string | undefined,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<ImportResult> {
  return withErrorDetail(() => new Promise<ImportResult>((resolve, reject) => {
    const form = new FormData();
    files.forEach((file) => { form.append('files', file); });
    if (documentId) form.append('document_id', documentId);
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open('POST', `${API_BASE}/imports`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded * 100 / event.total));
    };
    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(payload.detail || '导入失败');
        resolve(payload);
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => reject(new Error('上传连接失败，请检查网络后重试'));
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) { reject(new DOMException('上传已取消', 'AbortError')); return; }
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(form);
  }));
}

export async function getWordTemplates(): Promise<{ templates: WordTemplate[] }> {
  return withErrorDetail(() =>
    request(`${API_BASE}/word-templates`, { method: 'GET', skipErrorHandler: true }),
  );
}

export async function convertWord(file: File, templateId: string): Promise<WordConversionResult> {
  return withErrorDetail(async () => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('template_id', templateId);
    const response = await fetch(`${API_BASE}/word-conversions`, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({})) as WordConversionResult & { detail?: string };
    if (!response.ok) throw new Error(payload.detail || 'Word 排版失败');
    return payload;
  });
}

export async function saveWordConversion(id: string): Promise<SaveWordConversionResult> {
  return withErrorDetail(async () => {
    const response = await fetch(`${API_BASE}/word-conversions/${encodeURIComponent(id)}/save`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({})) as SaveWordConversionResult & { detail?: string };
    if (!response.ok) throw new Error(payload.detail || '保存排版失败');
    return payload;
  });
}

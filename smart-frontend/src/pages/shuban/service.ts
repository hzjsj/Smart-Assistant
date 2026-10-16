import { request } from '@umijs/max';
import type { ShubanAst, ShubanFile, ShubanReport, ShubanToken } from './data';

const API_BASE = '/api/shuban';

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

export async function listFiles(): Promise<{ files: ShubanFile[] }> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files`, { method: 'GET', skipErrorHandler: true }),
  );
}

export async function getReport(filename: string): Promise<ShubanReport> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/report`, {
      method: 'GET',
      skipErrorHandler: true,
    }),
  );
}

export async function getTokens(filename: string): Promise<ShubanToken[]> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/tokens`, {
      method: 'GET',
      skipErrorHandler: true,
    }),
  );
}

export async function getAst(filename: string): Promise<ShubanAst> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/ast`, {
      method: 'GET',
      skipErrorHandler: true,
    }),
  );
}

export async function getText(
  filename: string,
  plain = false,
): Promise<{ text: string }> {
  return withErrorDetail(() =>
    request(`${API_BASE}/files/${encodeURIComponent(filename)}/text`, {
      method: 'GET',
      params: { plain },
      skipErrorHandler: true,
    }),
  );
}

export async function getPreview(filename: string): Promise<string> {
  return withErrorDetail(async () => {
    const response = await fetch(
      `${API_BASE}/files/${encodeURIComponent(filename)}/preview`,
      { credentials: 'same-origin' },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      throw new Error(body.detail || '排版预览加载失败');
    }
    return response.text();
  });
}

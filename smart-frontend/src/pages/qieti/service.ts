import { request } from '@umijs/max';
import type {
  CutApiResponse,
  QietiPage,
  QietiSnapshot,
  QietiUploadRecord,
  UploadApiResponse,
} from './data';

// 走相对路径，由 dev proxy / nginx 反代到后端，同源自动携带登录 Cookie
const API_BASE = '/api/qieti';

/** 跳过全局错误 toast，把后端 detail 透传成可读的 Error（由调用方自行展示） */
async function withErrorDetail<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (e) {
    const err = e as {
      response?: { data?: { detail?: string } };
      data?: { detail?: string };
      message?: string;
    };
    const detail =
      err?.response?.data?.detail ||
      err?.data?.detail ||
      err?.message ||
      '请求失败';
    throw new Error(String(detail));
  }
}

/** 上传切题图片（multipart），后端转存阿里云 OSS */
export async function uploadImage(file: File): Promise<UploadApiResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return withErrorDetail(() =>
    request<UploadApiResponse>(`${API_BASE}/upload`, {
      method: 'POST',
      data: formData,
      requestType: 'form',
      skipErrorHandler: true,
    }),
  );
}

/** 切题识别：传入图片公网 URL，返回 EduTutor 结构化题目数据 */
export async function cutQuestions(
  questionImageUrl: string,
): Promise<CutApiResponse> {
  return withErrorDetail(() =>
    request<CutApiResponse>(`${API_BASE}/cut`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { question_image_url: questionImageUrl },
      skipErrorHandler: true,
    }),
  );
}

/** 保存题库快照（防抖后调用，云端留档） */
export async function saveSnapshot(
  pages: QietiPage[],
  currentPageIndex: number,
): Promise<{ success: boolean; totalPages: number; totalQuestions: number }> {
  return request(`${API_BASE}/snapshot`, {
    method: 'POST',
    data: { pages, currentPageIndex },
  });
}

/** 读取最新题库快照 */
export async function getSnapshot(): Promise<{
  success: boolean;
  snapshot: QietiSnapshot | null;
}> {
  return request(`${API_BASE}/snapshot`, { method: 'GET' });
}

/** 分页查询上传记录 */
export async function listUploadRecords(
  limit = 100,
  offset = 0,
): Promise<{ success: boolean; records: QietiUploadRecord[] }> {
  return request(`${API_BASE}/records`, {
    method: 'GET',
    params: { limit, offset },
  });
}

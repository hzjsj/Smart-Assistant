import { request } from '@umijs/max';
import type { ChatAttachmentParam } from './request';

/** mineru 附件接口返回的上传记录。 */
export interface UploadedAttachment {
  id: string;
  name: string;
  url: string;
  size: number;
  ext: string;
}

/** 输入区附件草稿：上传各阶段的状态载体，按会话隔离保存。 */
export interface ChatAttachmentDraft {
  uid: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  /** 原始文件，供上传中生成本地预览缩略图。 */
  file: File;
  /** 上传进度 0-100，仅上传中存在。 */
  percent?: number;
  /** 上传完成后的 OSS 公网地址。 */
  url?: string;
  /** 上传完成后的服务端记录 id，移除时用于清理。 */
  id?: string;
  error?: string;
}

const ATTACHMENTS_API_URL = '/api/mineru/attachments';

/** 单条消息最多随发的附件数，与后端 mineru/attachment_service 一致。 */
export const MAX_SEND_ATTACHMENTS = 5;

/** DeepSeek 图像理解仅支持这四种格式（api-docs：vision）。 */
export const DEEPSEEK_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/** 是否为 DeepSeek 模式可发送的图片附件（按文件名扩展判断）。 */
export const isDeepSeekImage = (name: string) => {
  const index = name.lastIndexOf('.');
  const ext = index < 0 ? '' : name.slice(index).toLowerCase();
  return DEEPSEEK_IMAGE_EXTS.includes(ext);
};

export async function uploadAttachment(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadedAttachment> {
  // 用 XHR 以获取真实上传进度（umi request 不暴露 upload.onprogress）。
  return new Promise<UploadedAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ATTACHMENTS_API_URL);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedAttachment);
        } catch {
          reject(new Error('上传响应解析失败，请稍后重试'));
        }
        return;
      }
      if (xhr.status === 401) {
        reject(new Error('登录已过期，请重新登录'));
        return;
      }
      let detail = `上传失败（${xhr.status}），请稍后重试`;
      try {
        const payload = JSON.parse(xhr.responseText) as { detail?: unknown };
        if (typeof payload?.detail === 'string') detail = payload.detail;
      } catch {
        // 非 JSON 错误响应使用上面的状态兜底。
      }
      reject(new Error(detail));
    };
    xhr.onerror = () => reject(new Error('网络连接失败，请检查服务是否可用'));
    xhr.send(formDataFor(file));
  });
}

function formDataFor(file: File): FormData {
  const formData = new FormData();
  formData.append('file', file);
  return formData;
}

export async function deleteAttachment(id: string): Promise<void> {
  await request<void>(`${ATTACHMENTS_API_URL}/${id}`, { method: 'delete' });
}

export const toChatAttachment = (
  uploaded: UploadedAttachment,
): ChatAttachmentParam => ({ url: uploaded.url, name: uploaded.name });

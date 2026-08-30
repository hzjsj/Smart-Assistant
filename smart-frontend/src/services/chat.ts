// AI 对话服务层：会话/消息/模型的 REST 接口与类型（chat、chatbot 页面共用）
import { request } from '@umijs/max';

/** 模型注册表项（GET /api/chat/models） */
export interface ChatModelItem {
  name: string;
  provider: string;
  providerLabel: string;
  contextTokens: number;
  supportsThinking: boolean;
}

/** 会话列表项（后端按 今天/昨天/7天内/更早 分组输出） */
export interface ChatConversationItem {
  key: string;
  label: string;
  group?: string;
  /** 本地草稿会话：尚未发出首条消息、未在后端建档 */
  isDraft?: boolean;
}

/** 历史消息记录（GET /api/chat/messages） */
export interface ChatMessageRecord {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  reasoningContent?: string | null;
  model?: string | null;
  timestamp: number;
}

interface ApiResult<T> {
  success: boolean;
  errorMessage?: string;
  data: T;
}

/** 可用模型列表（三平台），data 附带 default 默认模型名 */
export async function listChatModels() {
  return request<ApiResult<ChatModelItem[] & { default?: string }>>(
    '/api/chat/models',
    { method: 'GET' },
  );
}

/** 当前用户会话列表（分组） */
export async function listChatSessions() {
  return request<ApiResult<ChatConversationItem[]>>('/api/chat/sessions', {
    method: 'GET',
  });
}

/** 新建会话 */
export async function createChatSession(chatId: string, title: string) {
  return request<ApiResult<{ chatId: string; title: string }>>(
    '/api/chat/sessions',
    { method: 'POST', data: { chat_id: chatId, title } },
  );
}

/** 重命名会话 */
export async function renameChatSession(chatId: string, title: string) {
  return request<ApiResult<{ chatId: string; title: string }>>(
    `/api/chat/sessions/${chatId}`,
    { method: 'PUT', data: { title } },
  );
}

/** 删除会话（级联删消息） */
export async function deleteChatSession(chatId: string) {
  return request<ApiResult<null>>(`/api/chat/sessions/${chatId}`, {
    method: 'DELETE',
  });
}

/** 会话历史消息（升序）；draft 会话后端无记录（后端返回空列表），静默处理避免全局错误提示 */
export async function listChatMessages(chatId: string) {
  return request<ApiResult<ChatMessageRecord[]>>(
    `/api/chat/messages?chat_id=${encodeURIComponent(chatId)}`,
    { method: 'GET', skipErrorHandler: true },
  );
}

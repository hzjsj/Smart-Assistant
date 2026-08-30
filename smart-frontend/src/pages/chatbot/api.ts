// src/pages/chatbot/api.ts
// 会话/消息/模型的后端 REST 接口（流式对话走 service.ts 的 XRequest）
import { request } from '@umijs/max';
import type {
  ChatMessageRecord,
  ChatModelItem,
  ConversationItem,
} from './data';

interface ApiResult<T> {
  success: boolean;
  data: T;
}

/** 可用模型列表（三平台） */
export async function listChatModels() {
  return request<ApiResult<ChatModelItem[] & { default?: string }>>(
    '/api/chat/models',
    { method: 'GET' },
  );
}

/** 当前用户会话列表（今天/昨天/7天内/更早分组） */
export async function listChatSessions() {
  return request<ApiResult<ConversationItem[]>>('/api/chat/sessions', {
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

/** 会话历史消息（升序）；draft 会话后端无记录，静默处理避免全局错误提示 */
export async function listChatMessages(chatId: string) {
  return request<ApiResult<ChatMessageRecord[]>>(
    `/api/chat/messages?chat_id=${encodeURIComponent(chatId)}`,
    { method: 'GET', skipErrorHandler: true },
  );
}

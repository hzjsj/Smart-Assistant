import type { MessageInfo } from '@ant-design/x-sdk';
import { request } from '@umijs/max';
import type { HermesMessage, ReasoningActivity } from './data';
import type { ChatAttachmentParam } from './request';

/**
 * 会话与消息的服务端持久化（conversations 模块）。
 *
 * 存储模型（对齐豆包三层消息模型的精简版）：
 * - 后端为流式对话的权威：页面刷新 / 断线 / 超时后，后端继续读完上游
 *   SSE 并落库；仅用户手动 abort 才终止。
 * - content 为规范文本（重放上游历史），content_json 为显示快照
 *   （reasoning_content / attachments 等），恢复渲染用。
 */

const API = '/api/conversations';
const DRAFT_STORAGE_PREFIX = 'hermes-draft:';

/** conversations 表记录。 */
export interface ConversationRecord {
  id: string;
  title: string;
  model: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

/** conversation_messages 表记录。 */
export interface MessageRecord {
  id: number;
  role: string;
  content: string;
  content_json: string | null;
  /** 0=streaming（后端仍在生成）1=done 2=error 3=aborted */
  status: number;
  finish_reason: string | null;
  usage: string | null;
  created_at: string;
}

export interface MessagePage {
  messages: MessageRecord[];
  has_more: boolean;
  next_before_id: number | null;
}

/** content_json 快照结构（由后端采集转发器生成）。 */
interface MessageSnapshot {
  content?: string;
  reasoning_content?: string;
  finish_reason?: string;
  usage?: Record<string, number> | null;
  attachments?: ChatAttachmentParam[];
}

export async function listConversations(): Promise<ConversationRecord[]> {
  return request<ConversationRecord[]>(API, { method: 'get' });
}

export async function createConversationRecord(
  title?: string,
  model?: string,
): Promise<ConversationRecord> {
  return request<ConversationRecord>(API, {
    method: 'post',
    data: { ...(title ? { title } : {}), ...(model ? { model } : {}) },
  });
}

export async function listMessages(
  conversationId: string,
  beforeId?: number,
): Promise<MessagePage> {
  return request<MessagePage>(`${API}/${conversationId}/messages`, {
    method: 'get',
    params: { limit: 50, ...(beforeId ? { before_id: beforeId } : {}) },
  });
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<void> {
  await request(`${API}/${conversationId}`, {
    method: 'patch',
    data: { title },
  });
}

export async function deleteConversationRecord(
  conversationId: string,
): Promise<void> {
  await request(`${API}/${conversationId}`, { method: 'delete' });
}

/** 终止后端仍在进行的流式对话（已生成部分落库为 aborted）；静默失败。 */
export async function abortConversationRecord(
  conversationId: string,
): Promise<void> {
  await request(`${API}/${conversationId}/abort`, { method: 'post' }).catch(
    () => undefined,
  );
}

/** 按 updated_at 计算侧栏分组（时间分组交给 Conversations groupable）。 */
export const conversationGroupFor = (updatedAt: string): string => {
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) return '更早';
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (time >= startOfToday) return '今天';
  if (time >= startOfToday - 86_400_000) return '昨天';
  if (time >= startOfToday - 7 * 86_400_000) return '近7天';
  return '更早';
};

/** 把后端消息记录反序列化为 HermesMessage（恢复渲染； activities 仅还原思维链）。 */
export const messageRecordToHermesMessage = (
  record: MessageRecord,
): HermesMessage => {
  let snapshot: MessageSnapshot = {};
  if (record.content_json) {
    try {
      snapshot = JSON.parse(record.content_json) as MessageSnapshot;
    } catch {
      // 快照损坏时退化为纯文本渲染。
    }
  }
  const attachments = snapshot.attachments?.length
    ? snapshot.attachments.map((attachment) => ({ ...attachment }))
    : undefined;
  const reasoning = snapshot.reasoning_content || '';
  const activities: HermesMessage['activities'] = [];
  if (reasoning) {
    const activity: ReasoningActivity = {
      type: 'reasoning',
      key: `reasoning:${record.id}`,
      text: reasoning,
      status: record.status === 0 ? 'active' : 'done',
    };
    activities.push(activity);
  }
  return {
    role: record.role === 'assistant' ? 'assistant' : 'user',
    content: snapshot.content ?? record.content,
    ...(record.role === 'user' && attachments ? { attachments } : {}),
    activities,
    contentActive: false,
    ...(record.role === 'assistant' && record.finish_reason
      ? { finishReason: record.finish_reason as HermesMessage['finishReason'] }
      : {}),
    ...(record.role === 'assistant' && snapshot.usage
      ? { usage: snapshot.usage }
      : {}),
  };
};

/**
 * 包装为 useXChat setMessages 需要的 MessageInfo。
 *
 * streaming=true（后端仍在生成，status=0）时用 status='updating'：
 * 命中 usePacedMessages 的打字机与 Bubble 的 streaming 光标，轮询拉到
 * 增量内容后逐字续播；完成后最后一次以 local 收尾。
 */
export const messageRecordToMessageInfo = (
  record: MessageRecord,
  streaming = false,
): MessageInfo<HermesMessage> => {
  const message = messageRecordToHermesMessage(record);
  return {
    id: `restore_${record.id}`,
    status: streaming && record.role === 'assistant' ? 'updating' : 'local',
    message:
      streaming && record.role === 'assistant'
        ? { ...message, restoredStreaming: true }
        : message,
  };
};

/** 从 localStorage 读输入草稿（按会话 key 隔离；豆包草稿库的单机简化版）。 */
export const readDraftsFromStorage = (): Record<string, string> => {
  try {
    const drafts: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(DRAFT_STORAGE_PREFIX)) continue;
      drafts[key.slice(DRAFT_STORAGE_PREFIX.length)] =
        localStorage.getItem(key) ?? '';
    }
    return drafts;
  } catch {
    // 隐私模式等 localStorage 不可用场景。
    return {};
  }
};

/** 全量同步草稿到 localStorage（写前清理，避免已删除会话的草稿残留）。 */
export const syncDraftsToStorage = (drafts: Record<string, string>): void => {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(DRAFT_STORAGE_PREFIX)) localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(drafts)) {
      if (value) localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${key}`, value);
    }
  } catch {
    // 持久化失败不影响本次会话使用。
  }
};

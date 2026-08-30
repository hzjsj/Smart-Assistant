// src/pages/chatbot/data.d.ts

/** 侧栏会话项（后端分组接口直接输出 key/label/group） */
export interface ConversationItem {
  key: string;
  label: string;
  group?: string;
  /** 本地草稿会话：尚未发出首条消息、未在后端建档 */
  isDraft?: boolean;
}

/** 气泡消息：<think> 标签保留在 content 中，由 XMarkdown 的 think 自定义组件渲染 */
export type ParsedMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

/** 模型注册表项（GET /api/chat/models） */
export interface ChatModelItem {
  name: string;
  provider: string;
  providerLabel: string;
  contextTokens: number;
  supportsThinking: boolean;
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

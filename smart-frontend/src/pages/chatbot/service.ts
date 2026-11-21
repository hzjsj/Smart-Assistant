// src/pages/chatbot/service.ts
import { DeepSeekChatProvider, XRequest } from '@ant-design/x-sdk';
import { API_BASE } from '@/utils/apiBase';

export const CHAT_API_URL = `${API_BASE}/api/chat/completions`;

/**
 * 工厂 — 每个组件挂载创建一次（useMemo 包裹）。
 * DeepSeekChatProvider 处理 SSE 解析、历史累积，并把 delta.reasoning_content
 * 包装成 <think>...</think>（配合 parser/Think 展示深度思考）。
 * chatId / model / enableThinking 由每次 onRequest 动态传入
 * （x-sdk transformParams: {...静态params, ...请求params, messages}）。
 */
export const createChatProvider = () =>
  new DeepSeekChatProvider({
    request: XRequest(CHAT_API_URL, {
      // 跨域直连后端（8000 → 5000）必须显式携带 Cookie，否则会话鉴权 401
      credentials: 'include',
      manual: true,
      headers: { 'Content-Type': 'application/json' },
      params: { stream: true },
    }),
  });

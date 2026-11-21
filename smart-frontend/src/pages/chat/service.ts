// src/pages/chat/service.ts
// 流式对话请求工厂（DeepSeekChatProvider 处理 SSE 解析与 <think> 包装）
import { DeepSeekChatProvider, XRequest } from '@ant-design/x-sdk';
import { API_BASE } from '@/utils/apiBase';

// SSE 流式直连后端完整路径（开发按主机直连 5000，生产同源 nginx 反代）
export const CHAT_API_URL = `${API_BASE}/api/chat/completions`;

/**
 * 每个组件挂载创建一次（useMemo 包裹）。
 * chatId / model / enableThinking 由每次 onRequest 动态传入
 * （x-sdk transformParams: {...静态params, ...请求params, messages}）。
 */
export const createChatProvider = () =>
  new DeepSeekChatProvider({
    request: XRequest(CHAT_API_URL, {
      credentials: 'include',
      manual: true,
      headers: { 'Content-Type': 'application/json' },
      params: { stream: true },
    }),
  });

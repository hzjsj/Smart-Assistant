// src/pages/chat/service.ts
// 流式对话请求工厂（DeepSeekChatProvider 处理 SSE 解析与 <think> 包装）
import { DeepSeekChatProvider, XRequest } from '@ant-design/x-sdk';

// 开发环境直连后端完整路径（SSE 流式不经过 dev proxy 缓冲），生产环境用 / 开头同源路径
const isDev = process.env.NODE_ENV === 'development';

export const CHAT_API_URL = isDev
  ? 'http://localhost:5000/api/chat/completions'
  : '/api/chat/completions';

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

// src/pages/chat/service.ts
// 流式对话请求工厂（DeepSeekChatProvider 处理 SSE 解析与 <think> 包装）
import { DeepSeekChatProvider, XRequest } from '@ant-design/x-sdk';

// SSE 流式直连后端完整路径（不走 dev/preview proxy，避免 HPM 代理缓冲）
// 生产部署时通过 nginx 的 proxy_buffering off 代理到后端
export const CHAT_API_URL = 'http://localhost:5000/api/chat/completions';

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

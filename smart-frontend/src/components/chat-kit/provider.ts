/** 跨页共享的流式对话 Provider 工厂（chat / chatbot 共用；copilot 因带 onResponse 中间件保留自有工厂，仅复用端点常量）。 */
import { DeepSeekChatProvider, XRequest } from '@ant-design/x-sdk';
import { API_BASE } from '@/utils/apiBase';

/** chat/completions 流式端点（三页共用，开发直连 5000 / 生产同源反代） */
export const CHAT_COMPLETIONS_URL = `${API_BASE}/api/chat/completions`;

/** 兼容 chat 页历史的导出名 */
export const CHAT_API_URL = CHAT_COMPLETIONS_URL;

/**
 * 工厂 — 每个组件挂载创建一次（useMemo 包裹）。
 * DeepSeekChatProvider 处理 SSE 解析、历史累积，并把 delta.reasoning_content
 * 包装成 <think>...</think>（配合 parser/Think 展示深度思考）。
 * chatId / model / enableThinking 由每次 onRequest 动态传入
 * （x-sdk transformParams: {...静态params, ...请求params, messages}）。
 * 跨域直连后端（8000 → 5000）必须显式携带 Cookie，否则会话鉴权 401。
 */
export const createChatProvider = () =>
  new DeepSeekChatProvider({
    request: XRequest(CHAT_COMPLETIONS_URL, {
      credentials: 'include',
      manual: true,
      headers: { 'Content-Type': 'application/json' },
      params: { stream: true },
    }),
  });

import { type SSEOutput, XRequest } from '@ant-design/x-sdk';
import type { ApprovalRequest, ApprovalResponse } from './data';
import { HermesChatProvider } from './HermesChatProvider';
import type { HermesChatParams } from './request';

// SSE 流式直连后端完整路径（不走 dev/preview proxy，避免 HPM 代理缓冲）；
// 生产部署时通过 nginx 的 proxy_buffering off 代理到后端（与 src/pages/chat 惯例一致）。
// 普通 REST（附件/会话/题库）仍走相对路径 /api 经代理。
// 开发环境按当前访问主机推导（localhost 与局域网 IP 手机真机均可直连 5000）；
// 生产构建取空串走同源（nginx 反代），换环境无需改代码。
const SSE_API_BASE =
  process.env.NODE_ENV === 'development'
    ? `${window.location.protocol}//${window.location.hostname}:5000`
    : '';

export const CHAT_API_URL = `${SSE_API_BASE}/api/hermes/v1/chat/completions`;
/**
 * 带附件的聊天走 mineru 端点：后端把附件 URL 注入消息后转发同一上游，
 * SSE 格式与 hermes 端点完全一致，Provider 解析逻辑无需区分。
 */
export const ATTACHMENT_CHAT_API_URL = `${SSE_API_BASE}/api/mineru/chat/completions`;
/**
 * DeepSeek 普通对话端点（OpenAI 兼容，SSE）。图片附件由后端注入
 * image_url 内容块；SSE 解析与 hermes 端点共用 HermesChatProvider。
 */
export const DEEPSEEK_CHAT_API_URL = `${SSE_API_BASE}/api/deepseek/chat/completions`;
/**
 * Dify Agent 端点：后端把 Dify 事件翻译成 OpenAI 兼容流（含
 * agent_thought → 思考内容 + 工具进度事件），前端 Provider 无需区分。
 */
export const DIFY_CHAT_API_URL = `${SSE_API_BASE}/api/dify/chat/completions`;
/**
 * 百炼（DashScope Agent 2.0）端点：后端调用 /apps/{APP_ID}/completion，
 * 把事件翻译为 OpenAI 兼容流（含 session 多轮与 thinking），前端 Provider 无需区分。
 */
export const BAILIAN_CHAT_API_URL = `${SSE_API_BASE}/api/bailian/agent/chat/completions`;
/**
 * LangChain Agent 端点（自研）：后端手动 tool-calling 循环直接产出
 * OpenAI 兼容流（含工具进度事件），前端 Provider 无需区分。
 */
export const LANGCHAIN_CHAT_API_URL = `${SSE_API_BASE}/api/langchain/chat/completions`;
/**
 * OpenClaw Gateway 端点（OpenAI 兼容直通）：多轮上下文由上游 agent
 * 会话维护（user = 会话 ID），前端 Provider 无需区分。
 */
export const OPENCLAW_CHAT_API_URL = `${SSE_API_BASE}/api/openclaw/chat/completions`;

/** 输入框右下角可选的对话模型。 */
export type ChatModel =
  | 'hermes'
  | 'deepseek'
  | 'dify'
  | 'bailian'
  | 'langchain'
  | 'openclaw';

export const CHAT_MODEL_LABELS: Record<ChatModel, string> = {
  hermes: 'Hermes Agent',
  deepseek: 'DeepSeek',
  dify: 'Dify',
  bailian: '百炼',
  langchain: 'LangChain Agent',
  openclaw: 'OpenClaw Agent',
};

type ErrorPayload = {
  detail?: unknown;
  error?: {
    message?: unknown;
  };
};

const getResponseError = async (response: Response) => {
  let detail = '';
  try {
    const payload = (await response.clone().json()) as ErrorPayload;
    if (typeof payload.detail === 'string') {
      detail = payload.detail;
    } else if (Array.isArray(payload.detail)) {
      detail = payload.detail
        .slice(0, 3)
        .map((value) => {
          const error = value as { msg?: unknown } | null;
          return typeof error?.msg === 'string'
            ? error.msg.replace(/^Value error,\s*/, '')
            : '';
        })
        .filter(Boolean)
        .join('；');
    } else if (typeof payload.error?.message === 'string') {
      detail = payload.error.message;
    }
  } catch {
    // 非 JSON 错误响应使用下面的状态兜底。
  }

  if (response.status === 401) {
    return '登录已过期，请重新登录';
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const reason = detail || 'Hermes Agent 当前请求过多';
    return retryAfter
      ? `${reason}，请在 ${retryAfter} 秒后重试`
      : `${reason}，请稍后重试`;
  }
  if (response.status === 422) {
    return detail || '请求参数校验失败，请检查表单内容后重试';
  }
  return detail || `请求失败（${response.status}），请稍后重试`;
};

export const getChatErrorMessage = (error: Error) => {
  if (error.name === 'TimeoutError' || error.name === 'StreamTimeoutError') {
    return '响应超时，请稍后重试';
  }
  if (error.message === 'Failed to fetch') {
    return '网络连接失败，请检查服务是否可用';
  }
  return error.message || '请求失败，请稍后重试';
};

/** Hermes Chat SSE carries custom named events in addition to OpenAI deltas. */
export const createChatProvider = (
  apiUrl: string = CHAT_API_URL,
  conversationId?: string,
) =>
  new HermesChatProvider({
    request: XRequest<HermesChatParams, SSEOutput>(apiUrl, {
      manual: true,
      // SSE 直连后端（跨源），需 include 才能携带登录 cookie
      credentials: 'include',
      params: {
        stream: true,
        // 会话持久化：conversation_id 随静态参数进入每次请求（含重试），
        // 由后端落 user 消息并权威落库 assistant 消息。
        ...(conversationId ? { conversation_id: conversationId } : {}),
      },
      headers: { 'Content-Type': 'application/json' },
      middlewares: {
        onResponse: async (response) => {
          if (!response.ok) {
            throw new Error(await getResponseError(response));
          }
          return response;
        },
      },
    }),
  });

export const postApproval = async (
  runId: string,
  payload: ApprovalRequest,
): Promise<ApprovalResponse> => {
  let response: Response;
  try {
    response = await fetch(
      `/api/hermes/v1/runs/${encodeURIComponent(runId)}/approval`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  } catch {
    throw new Error('网络连接失败，请检查服务后重试');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as ErrorPayload;
      if (typeof body.detail === 'string') detail = body.detail;
      else if (typeof body.error?.message === 'string') {
        detail = body.error.message;
      }
    } catch {
      // Use status and Retry-After when the server has no JSON error body.
    }

    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    if (response.status === 409) {
      throw new Error(detail || '审批已失效或已处理，请刷新对话');
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new Error(
        retryAfter
          ? `请求过于频繁，请在 ${retryAfter} 秒后重试`
          : detail || '请求过于频繁，请稍后重试',
      );
    }
    throw new Error(detail || `审批提交失败（${response.status}）`);
  }

  return (await response.json()) as ApprovalResponse;
};

/** 跨页共享的模型注册工具（chat / chatbot / copilot 三页共用，todo 第 29 条）。 */

export const formatContext = (tokens: number) =>
  tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : `${tokens}`;

/** 模型名缩写（模型选择按钮上显示） */
export const MODEL_ABBR: Record<string, string> = {
  'deepseek-v4-flash': 'DS-Flash',
  'deepseek-v4-pro': 'DS-Pro',
  'deepseek-v4-flash-vision-exp': 'DS-Vision',
  'qwen3.7-plus': 'Qwen-Plus',
  'qwen3.8-flash': 'Qwen-Flash',
  'qwen3.8-max': 'Qwen-Max',
  'doubao-seed-2-1-pro-260628': 'Doubao-Pro',
  'doubao-seed-2-1-turbo-260628': 'Doubao-Turbo',
  'doubao-seed-evolving': 'Doubao-Evo',
};

export const modelAbbr = (name: string) => MODEL_ABBR[name] ?? name;

/** 深度思考开关文字样式（on/off 居中窄列；copilot 页样式不同，保留页内自有实现） */
export const SwitchTextStyle: React.CSSProperties = {
  display: 'inline-flex',
  width: 24,
  justifyContent: 'center',
  alignItems: 'center',
};

/** 会话ID 用 UUID（后端 chat_id 唯一索引，'default' 这类固定值会跨用户冲突） */
export const newChatId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

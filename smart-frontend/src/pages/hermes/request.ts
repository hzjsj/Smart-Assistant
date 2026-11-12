import type { XModelMessage, XModelParams } from '@ant-design/x-sdk';
import type { HermesMessage } from './data';
import { copyPaperRequestConfig, type PaperRequestConfig } from './paper';

/** 附件引用：后端（mineru 端点）注入消息后转发上游，前端不传全文。 */
export interface ChatAttachmentParam {
  url: string;
  name?: string;
}

export interface HermesChatParams extends XModelParams {
  task?: 'chat' | 'question_bank';
  paper_config?: PaperRequestConfig;
  /** 附件引用，仅普通聊天携带；随顶层字段透传给 mineru 聊天端点。 */
  attachments?: ChatAttachmentParam[];
  /** 会话持久化：由 createChatProvider 按会话注入 XRequest params（重试同样生效）。 */
  conversation_id?: string;
  /** Local retry context, removed before the HTTP request. */
  retryHistory?: XModelMessage[];
}

export function buildRetryParams(
  messages: readonly { id: string | number; message: HermesMessage }[],
  id: string | number,
): HermesChatParams {
  const index = messages.findIndex((info) => info.id === id);
  if (index < 0) throw new Error('未找到需要重新生成的消息');
  const history = messages.slice(0, index).map((info) => info.message);
  const user = [...history]
    .reverse()
    .find((message) => message.role === 'user');
  return {
    task: user?.paperConfig ? 'question_bank' : 'chat',
    ...(user?.paperConfig
      ? { paper_config: copyPaperRequestConfig(user.paperConfig) }
      : {}),
    // 重新生成沿用原消息的附件快照，不混入后来上传或取消的资料。
    ...(user?.attachments?.length
      ? {
          attachments: user.attachments.map((attachment) => ({
            ...attachment,
          })),
        }
      : {}),
    retryHistory: history
      .filter((message) => message.content || message.role === 'user')
      .map(({ role, content }) => ({ role, content })),
  };
}

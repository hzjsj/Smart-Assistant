import type { PaperRequestConfig } from './paper';
import type { QuestionBankCardData } from './question-bank/types';
import type { ChatAttachmentParam } from './request';

export type ActivityStatus = 'active' | 'done' | 'error' | 'abort';

export interface ReasoningActivity {
  type: 'reasoning';
  key: string;
  text: string;
  status: ActivityStatus;
  /** Display grouping by event order, not a tool-generated reasoning result. */
  toolKey?: string;
  isStageReasoning?: boolean;
}

export interface ToolActivity {
  type: 'tool';
  key: string;
  toolCallId: string;
  tool: string;
  emoji?: string;
  label?: string;
  progress?: number;
  progressMessage?: string;
  /** Preserve overlap information after both calls have completed. */
  overlapped?: boolean;
  status: 'running' | 'completed' | 'error' | 'abort';
}

export interface StatusActivity {
  type: 'status';
  key: string;
  kind: string;
  text: string;
}

export interface ApprovalActivity {
  type: 'approval';
  key: string;
  runId: string;
  requestId?: string;
  command?: string;
  description?: string;
  choices: string[];
  status: 'pending' | 'submitting' | 'resolved' | 'error';
  choice?: string;
}

export type HermesActivity =
  | ReasoningActivity
  | ToolActivity
  | StatusActivity
  | ApprovalActivity;

export interface HermesMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Form snapshot, attached only to the submitted user message. */
  paperConfig?: PaperRequestConfig;
  /** 用户消息随发的附件（仅本地展示与重试快照用）。 */
  attachments?: ChatAttachmentParam[];
  activities: HermesActivity[];
  contentActive?: boolean;
  finishReason?: 'stop' | 'length' | 'error';
  usage?: Record<string, number>;
  questionBanks?: QuestionBankCardData[];
  questionBankPending?: boolean;
  questionBankErrors?: string[];
  /** 历史恢复的流式消息：直接展示已落库内容，不再从空串重放打字机 */
  restoredStreaming?: boolean;
}

export interface ConversationItem {
  key: string;
  label: string;
  group: string;
}

export type ConversationDrafts = Record<string, string>;

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

export interface ApprovalRequest {
  choice: ApprovalChoice;
  request_id?: string;
  resolve_all: boolean;
}

export interface ApprovalResponse {
  object: string;
  run_id: string;
  choice: ApprovalChoice;
  request_id?: string;
  resolved: number;
}

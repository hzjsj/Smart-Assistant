import {
  AbstractChatProvider,
  type SSEOutput,
  type TransformMessage,
  type XModelMessage,
} from '@ant-design/x-sdk';
import type { HermesActivity, HermesMessage, ToolActivity } from './data';
import { copyPaperRequestConfig } from './paper';
import type { HermesChatParams } from './request';

type HermesChunk = SSEOutput;

type ChatChunk = {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: 'stop' | 'length' | 'error' | null;
  }>;
  usage?: Record<string, number>;
  error?: { message?: string };
  hermes?: { error_code?: string };
};

export class HermesStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HermesStreamError';
  }
}

const emptyAssistant = (): HermesMessage => ({
  role: 'assistant',
  content: '',
  activities: [],
  contentActive: false,
});

const parseData = (
  value?: string,
): ChatChunk | Record<string, unknown> | null => {
  if (!value || value === '[DONE]') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const updateActivity = (
  activities: HermesActivity[],
  key: string,
  update: (activity: HermesActivity) => HermesActivity,
) => {
  const index = activities.findIndex((activity) => activity.key === key);
  if (index < 0) return activities;
  return activities.map((activity, currentIndex) =>
    currentIndex === index ? update(activity) : activity,
  );
};

const closeOpenActivities = (
  activities: HermesActivity[],
  status: 'done' | 'error' | 'abort',
): HermesActivity[] =>
  activities.map((activity): HermesActivity => {
    if (activity.type === 'status') return activity;
    if (activity.type === 'approval' && activity.status !== 'pending') {
      return activity;
    }
    if (activity.type === 'reasoning' && activity.status === 'active') {
      return { ...activity, status };
    }
    if (activity.type === 'tool' && activity.status === 'running') {
      return {
        ...activity,
        status: status === 'done' ? 'completed' : status,
      };
    }
    return activity;
  });

const closeReasoning = (activities: HermesActivity[]): HermesActivity[] =>
  activities.map((activity) =>
    activity.type === 'reasoning' && activity.status === 'active'
      ? { ...activity, status: 'done' }
      : activity,
  );

const normalizeToolStatus = (status?: string): ToolActivity['status'] => {
  if (['error', 'failed', 'failure'].includes(status || '')) return 'error';
  if (['abort', 'aborted', 'cancelled', 'canceled'].includes(status || ''))
    return 'abort';
  if (['completed', 'success', 'done'].includes(status || ''))
    return 'completed';
  return 'running';
};

const preserveTerminalToolStatus = (
  previous: ToolActivity['status'],
  incoming: ToolActivity['status'],
): ToolActivity['status'] => {
  if (previous === 'error' || incoming === 'error') return 'error';
  if (previous === 'abort' || incoming === 'abort') return 'abort';
  if (previous === 'completed' || incoming === 'completed') return 'completed';
  return incoming;
};

const reasoningScope = (
  activities: HermesActivity[],
): { toolKey?: string; isStageReasoning?: boolean } => {
  // Consecutive tools form one stage. Without an explicit reasoning call ID,
  // a stage containing several tools cannot be attributed to just one of them.
  const tools = [];
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity.type !== 'tool') break;
    tools.push(activity);
  }
  const candidate = tools.length === 1 ? tools[0] : undefined;
  const overlapping = activities.some(
    (activity) =>
      activity.type === 'tool' &&
      activity.status === 'running' &&
      activity.key !== candidate?.key,
  );
  if (tools.length > 1 || candidate?.overlapped || overlapping) {
    return { isStageReasoning: true };
  }
  return candidate ? { toolKey: candidate.key } : {};
};

export const finalizeHermesMessage = (
  message: HermesMessage,
  status: 'done' | 'error' | 'abort',
): HermesMessage => ({
  ...message,
  contentActive: false,
  activities: closeOpenActivities(message.activities, status),
});

export class HermesChatProvider extends AbstractChatProvider<
  HermesMessage,
  HermesChatParams,
  HermesChunk
> {
  transformParams(
    requestParams: Partial<HermesChatParams>,
    options: Parameters<
      AbstractChatProvider<
        HermesMessage,
        HermesChatParams,
        HermesChunk
      >['transformParams']
    >[1],
  ): HermesChatParams {
    const messages = (requestParams.retryHistory || this.getMessages())
      .filter(
        (message) => message.role === 'user' || message.role === 'assistant',
      )
      .filter((message) => message.content || message.role === 'user')
      .map(({ role, content }) => ({ role, content }) as XModelMessage);
    const params: HermesChatParams = {
      ...(options?.params || {}),
      ...requestParams,
      task: requestParams.task || 'chat',
      messages,
      stream: true,
    };
    // Defaults and local retry metadata must not leak into subsequent requests.
    delete params.retryHistory;
    delete params.paper_config;
    if (requestParams.task === 'question_bank' && requestParams.paper_config) {
      params.paper_config = copyPaperRequestConfig(requestParams.paper_config);
    }
    return params;
  }

  transformLocalMessage(
    requestParams: Partial<HermesChatParams>,
  ): HermesMessage[] {
    return (requestParams.messages || []).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: typeof message.content === 'string' ? message.content : '',
      ...(message.role === 'user' &&
      requestParams.task === 'question_bank' &&
      requestParams.paper_config
        ? { paperConfig: copyPaperRequestConfig(requestParams.paper_config) }
        : {}),
      ...(message.role === 'user' && requestParams.attachments?.length
        ? { attachments: requestParams.attachments }
        : {}),
      activities: [],
    }));
  }

  transformMessage({
    originMessage,
    chunk,
    status,
  }: TransformMessage<HermesMessage, HermesChunk>): HermesMessage {
    let current: HermesMessage = originMessage
      ? {
          ...originMessage,
          activities: [...originMessage.activities],
        }
      : emptyAssistant();
    const parsed = parseData(chunk?.data);
    if (!parsed) {
      if (status === 'success') {
        current = {
          ...current,
          contentActive: false,
          activities: closeOpenActivities(current.activities, 'done'),
        };
      } else if (status === 'abort' || status === 'error') {
        current = {
          ...current,
          contentActive: false,
          activities: closeOpenActivities(
            current.activities,
            status === 'abort' ? 'abort' : 'error',
          ),
        };
      }
      return current;
    }

    if (
      chunk?.event === 'hermes.tool.progress' ||
      chunk?.event === 'tool.progress'
    ) {
      const toolEvent = parsed as {
        tool?: string;
        emoji?: string;
        label?: string;
        toolCallId?: string;
        status?: string;
        percent?: number;
        message?: string;
      };
      const toolCallId =
        toolEvent.toolCallId ||
        (toolEvent.tool
          ? current.activities.find(
              (
                activity,
              ): activity is Extract<HermesActivity, { type: 'tool' }> =>
                activity.type === 'tool' &&
                activity.tool === toolEvent.tool &&
                activity.status === 'running',
            )?.toolCallId
          : undefined) ||
        (toolEvent.tool
          ? `tool:${toolEvent.tool}`
          : `tool-${current.activities.length}`);
      const key = `tool:${toolCallId}`;
      const existing = current.activities.some(
        (activity) => activity.key === key,
      );
      if (existing) {
        current = {
          ...current,
          contentActive: false,
          activities: updateActivity(
            current.activities,
            key,
            (activity) =>
              ({
                ...activity,
                ...(toolEvent.tool ? { tool: toolEvent.tool } : {}),
                ...(toolEvent.emoji ? { emoji: toolEvent.emoji } : {}),
                ...(toolEvent.label ? { label: toolEvent.label } : {}),
                ...(typeof toolEvent.percent === 'number'
                  ? { progress: Math.min(100, Math.max(0, toolEvent.percent)) }
                  : {}),
                ...(toolEvent.message
                  ? { progressMessage: toolEvent.message }
                  : {}),
                status:
                  activity.type === 'tool'
                    ? preserveTerminalToolStatus(
                        activity.status,
                        normalizeToolStatus(toolEvent.status),
                      )
                    : normalizeToolStatus(toolEvent.status),
              }) as HermesActivity,
          ),
        };
      } else {
        const overlapped = current.activities.some(
          (activity) =>
            activity.type === 'tool' && activity.status === 'running',
        );
        current = {
          ...current,
          contentActive: false,
          activities: [
            ...closeReasoning(current.activities).map((activity) =>
              overlapped &&
              activity.type === 'tool' &&
              activity.status === 'running'
                ? { ...activity, overlapped: true }
                : activity,
            ),
            {
              type: 'tool',
              key,
              toolCallId,
              tool: toolEvent.tool || 'tool',
              emoji: toolEvent.emoji,
              label: toolEvent.label,
              progress:
                typeof toolEvent.percent === 'number'
                  ? Math.min(100, Math.max(0, toolEvent.percent))
                  : undefined,
              progressMessage: toolEvent.message,
              ...(overlapped ? { overlapped: true } : {}),
              status: normalizeToolStatus(toolEvent.status),
            } as HermesActivity,
          ],
        };
      }
      return current;
    }

    if (chunk?.event === 'hermes.status') {
      const statusEvent = parsed as { kind?: string; text?: string };
      return {
        ...current,
        contentActive: false,
        activities: [
          ...closeReasoning(current.activities),
          {
            type: 'status',
            key: `status:${current.activities.length}`,
            kind: statusEvent.kind || 'status',
            text: statusEvent.text || '',
          },
        ],
      };
    }

    if (chunk?.event === 'approval.request') {
      const approval = parsed as {
        run_id?: string;
        request_id?: string;
        command?: string;
        description?: string;
        choices?: Array<string | { choice?: string; label?: string }>;
      };
      const choices = (approval.choices || [])
        .map((choice) =>
          typeof choice === 'string' ? choice : choice.choice || choice.label,
        )
        .filter((choice): choice is string => Boolean(choice));
      const key = `approval:${approval.request_id || approval.run_id || current.activities.length}`;
      return {
        ...current,
        contentActive: false,
        activities: [
          ...closeReasoning(current.activities),
          {
            type: 'approval',
            key,
            runId: approval.run_id || '',
            requestId: approval.request_id,
            command: approval.command,
            description: approval.description,
            choices,
            status: 'pending',
          },
        ],
      };
    }

    const chatChunk = parsed as ChatChunk;
    const choice = chatChunk.choices?.[0];
    const delta = choice?.delta;
    if (delta?.reasoning_content) {
      current.contentActive = false;
      const activeReasoning = current.activities.at(-1);
      if (
        activeReasoning?.type === 'reasoning' &&
        activeReasoning.status === 'active'
      ) {
        current = {
          ...current,
          activities: updateActivity(
            current.activities,
            activeReasoning.key,
            (activity) =>
              activity.type === 'reasoning'
                ? {
                    ...activity,
                    text: activity.text + delta.reasoning_content,
                  }
                : activity,
          ),
        };
      } else {
        current = {
          ...current,
          activities: [
            ...current.activities,
            {
              type: 'reasoning',
              key: `reasoning:${current.activities.length}`,
              text: delta.reasoning_content,
              status: 'active',
              ...reasoningScope(current.activities),
            },
          ],
        };
      }
    }
    if (delta?.content) {
      current = {
        ...current,
        content: current.content + delta.content,
        contentActive: true,
        activities: closeReasoning(current.activities),
      };
    }
    if (choice?.finish_reason) {
      current = {
        ...current,
        contentActive: false,
        finishReason: choice.finish_reason,
        usage: chatChunk.usage,
        activities: closeOpenActivities(
          current.activities,
          choice.finish_reason === 'error' ? 'error' : 'done',
        ),
      };
      if (choice.finish_reason === 'length') {
        current.activities = [
          ...current.activities,
          {
            type: 'status',
            key: `status:truncated:${current.activities.length}`,
            kind: 'warning',
            text: '回答已达到长度限制，内容可能不完整。',
          },
        ];
      }
      if (choice.finish_reason === 'error') {
        throw new HermesStreamError(
          chatChunk.error?.message || 'Hermes Agent 生成失败',
        );
      }
    }
    return current;
  }
}

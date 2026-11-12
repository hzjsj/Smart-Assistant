import { useXChat } from '@ant-design/x-sdk';
import { act, renderHook } from '@testing-library/react';
import { request } from '@umijs/max';
import { createElement, type ReactNode, StrictMode, useEffect } from 'react';
import type { Mock } from 'vitest';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AssistantPreset } from './assistant/types';
import { useAssistantMode } from './assistant/useAssistantMode';
import type { MessagePage, MessageRecord } from './conversationService';
import type { HermesMessage } from './data';
import { HermesChatProvider } from './HermesChatProvider';
import { buildRetryParams, type HermesChatParams } from './request';
import { useConversationHistory } from './useConversationHistory';

vi.mock('@umijs/max', () => ({ request: vi.fn() }));

const requestMock = vi.mocked(request);
const emptyPage: MessagePage = {
  messages: [],
  has_more: false,
  next_before_id: null,
};
const presets: AssistantPreset[] = [
  {
    key: 'essay',
    title: '作文助手',
    icon: null,
    welcomeTitle: '作文助手欢迎语',
    welcome: '点击示例开始',
    prompts: [
      {
        key: 'correct',
        label: '作文批改',
        slots: [],
        examples: [
          {
            key: 'sample',
            label: '示例作文',
            slots: [{ type: 'text', value: '请批改这篇作文' }],
          },
        ],
      },
    ],
  },
];

const record = (
  role: 'user' | 'assistant',
  content: string,
  overrides: Partial<MessageRecord> = {},
): MessageRecord => ({
  id: role === 'user' ? 1 : 2,
  role,
  content,
  content_json: null,
  status: 1,
  finish_reason: null,
  usage: null,
  created_at: '2026-11-09T10:00:00',
  ...overrides,
});
const historyPage: MessagePage = {
  ...emptyPage,
  messages: [
    record('user', '已保存的作文'),
    record('assistant', '已保存的批改'),
  ],
};

const deferred = () => {
  let resolve!: (page: MessagePage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MessagePage>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

function setup(strict = false) {
  const key: string = crypto.randomUUID();
  const otherKey = `${key}-other`;
  const onRestored = vi.fn();
  const createConversation = vi.fn();
  const renameConversation = vi.fn();
  const addConversation = vi.fn();
  const setActiveConversationKey = vi.fn();
  const providers = new Map<
    string,
    { provider: HermesChatProvider; run: Mock }
  >();
  const result = renderHook(
    ({ activeKey, enabled }) => {
      let entry = providers.get(activeKey);
      if (!entry) {
        const run = vi.fn();
        entry = {
          run,
          provider: new HermesChatProvider({
            request: {
              manual: true,
              options: { params: { conversation_id: activeKey } },
              run,
            } as unknown as HermesChatProvider['request'],
          }),
        };
        providers.set(activeKey, entry);
      }
      const chat = useXChat<HermesMessage, HermesMessage, HermesChatParams>({
        provider: entry.provider,
        conversationKey: activeKey,
        defaultMessages: [],
        requestPlaceholder: {
          role: 'assistant',
          content: '',
          activities: [],
        },
      });
      const history = useConversationHistory({
        activeConversationKey: activeKey,
        enabled,
        messageCount: chat.messages.length,
        setMessages: chat.setMessages,
        onRestored,
      });
      const assistant = useAssistantMode({
        presets,
        activeConversationKey: activeKey,
        messages: chat.messages,
        model: 'hermes',
        ready: history.status === 'ready',
        createConversation,
        renameConversation,
        addConversation,
        setActiveConversationKey,
        setConversationLabel: vi.fn(),
        messageApi: { error: vi.fn() } as never,
      });
      useEffect(() => {
        assistant.registerConversations([
          { id: key, title: '作文助手' },
          { id: otherKey, title: '作文助手' },
        ]);
      }, [assistant.registerConversations]);
      return { chat, history, assistant };
    },
    {
      initialProps: { activeKey: key, enabled: true },
      wrapper: strict
        ? ({ children }: { children: ReactNode }) =>
            createElement(StrictMode, null, children)
        : undefined,
    },
  );
  return {
    ...result,
    key,
    otherKey,
    providers,
    onRestored,
    renameConversation,
    createConversation,
    addConversation,
    setActiveConversationKey,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue(emptyPage);
});

it('等待慢响应的历史成功恢复，欢迎语不会抢占消息列表', async () => {
  const pending = deferred();
  requestMock.mockReturnValue(pending.promise);
  const { result, providers, key } = setup();
  expect(result.current.history.status).toBe('loading');
  expect(result.current.assistant.welcomeContent).toBeUndefined();
  expect(result.current.chat.messages).toEqual([]);

  await act(async () => pending.resolve(historyPage));
  expect(result.current.history.status).toBe('ready');
  expect(result.current.assistant.welcomeContent).toBeUndefined();
  expect(
    result.current.chat.messages.map((info) => info.message.content),
  ).toEqual(['已保存的作文', '已保存的批改']);
  expect(providers.get(key)?.run).not.toHaveBeenCalled();
});

it('空会话单独显示示例，首条消息立即隐藏欢迎语且请求和重试均不包含欢迎语', async () => {
  const { result, key, providers } = setup();
  await act(async () => {});
  expect(result.current.history.status).toBe('ready');
  expect(result.current.assistant.welcomeContent).toContain(
    '[示例作文](#hermes-prompt=correct/sample)',
  );
  expect(result.current.chat.messages).toEqual([]);
  act(() => result.current.assistant.selectPrompt('correct/sample'));
  expect(result.current.assistant.slotConfig).toEqual(
    presets[0].prompts[0].examples?.[0].slots,
  );

  act(() => {
    result.current.chat.onRequest({
      messages: [{ role: 'user', content: '请批改这篇作文' }],
      attachments: [{ url: 'https://example.com/essay.png', name: '作文.png' }],
    });
  });
  expect(result.current.assistant.welcomeContent).toBeUndefined();
  expect(providers.get(key)?.run).toHaveBeenCalledWith(
    expect.objectContaining({
      conversation_id: key,
      messages: [{ role: 'user', content: '请批改这篇作文' }],
      attachments: [{ url: 'https://example.com/essay.png', name: '作文.png' }],
    }),
  );
  const messages = result.current.chat.messages;
  expect(
    buildRetryParams(messages, messages[messages.length - 1].id),
  ).toMatchObject({
    retryHistory: [{ role: 'user', content: '请批改这篇作文' }],
  });
});

it('历史读取失败不会显示欢迎语，切回后可以重新读取', async () => {
  requestMock.mockRejectedValueOnce(new Error('网络错误'));
  const { result, rerender, key, otherKey } = setup();
  await act(async () => {});
  expect(result.current.history.status).toBe('error');
  expect(result.current.assistant.welcomeContent).toBeUndefined();
  rerender({ activeKey: otherKey, enabled: true });
  await act(async () => {});
  expect(result.current.assistant.welcomeContent).toBeDefined();
  requestMock.mockResolvedValueOnce(historyPage);
  rerender({ activeKey: key, enabled: true });
  await act(async () => {});
  expect(result.current.history.status).toBe('ready');
  expect(result.current.chat.messages).toHaveLength(2);
  expect(result.current.assistant.welcomeContent).toBeUndefined();
});

it('切换会话后忽略旧请求，切回时重新加载并恢复正确的 SDK store', async () => {
  const pending = deferred();
  requestMock.mockReturnValueOnce(pending.promise);
  const { result, rerender, key, otherKey } = setup();
  rerender({ activeKey: otherKey, enabled: true });
  await act(async () => {});
  await act(async () => pending.resolve(historyPage));
  expect(result.current.chat.messages).toEqual([]);
  expect(result.current.assistant.welcomeContent).toBeDefined();

  requestMock.mockResolvedValueOnce(historyPage);
  rerender({ activeKey: key, enabled: true });
  await act(async () => {});
  expect(
    result.current.chat.messages.map((info) => info.message.content),
  ).toEqual(['已保存的作文', '已保存的批改']);
  expect(result.current.assistant.welcomeContent).toBeUndefined();
  rerender({ activeKey: otherKey, enabled: true });
  await act(async () => {});
  expect(result.current.chat.messages).toEqual([]);
  const calls = requestMock.mock.calls.length;
  rerender({ activeKey: key, enabled: true });
  await act(async () => {});
  expect(result.current.chat.messages).toHaveLength(2);
  expect(requestMock).toHaveBeenCalledTimes(calls);
});

it.each([
  'assistant',
  'user',
] as const)('刷新后恢复生成中的 %s 消息及附件，通知页面继续轮询且不显示欢迎语', async (lastRole) => {
  requestMock.mockResolvedValue({
    ...emptyPage,
    messages: [
      record('user', '批改图片作文', {
        content_json: JSON.stringify({
          attachments: [
            { url: 'https://example.com/essay.png', name: '作文.png' },
          ],
        }),
      }),
      ...(lastRole === 'assistant'
        ? [record('assistant', '生成中', { status: 0 })]
        : []),
    ],
  });
  const { result, key, onRestored } = setup();
  await act(async () => {});
  expect(result.current.assistant.welcomeContent).toBeUndefined();
  expect(onRestored).toHaveBeenCalledWith({
    conversationKey: key,
    streaming: true,
    hasAttachments: true,
  });
  if (lastRole === 'assistant') {
    expect(result.current.chat.messages.at(-1)?.status).toBe('updating');
  }
});

it('StrictMode 重复 effect 不会丢失历史或误显示欢迎语', async () => {
  const pending = deferred();
  requestMock.mockReturnValue(pending.promise);
  const { result } = setup(true);
  await act(async () => pending.resolve(historyPage));
  expect(result.current.history.status).toBe('ready');
  expect(result.current.chat.messages).toHaveLength(2);
  expect(result.current.assistant.welcomeContent).toBeUndefined();
});

it('已有作文对话时再次点击助手会创建并激活新作文会话', async () => {
  requestMock.mockResolvedValue(historyPage);
  const {
    result,
    createConversation,
    addConversation,
    setActiveConversationKey,
  } = setup();
  await act(async () => {});
  createConversation.mockResolvedValue({ id: 'new-essay', title: '作文助手' });
  await act(async () => result.current.assistant.open(presets[0]));
  expect(createConversation).toHaveBeenCalledWith('作文助手', 'hermes');
  expect(addConversation).toHaveBeenCalledWith(
    { key: 'new-essay', label: '作文助手', group: '今天' },
    'prepend',
  );
  expect(setActiveConversationKey).toHaveBeenCalledWith('new-essay');
  expect(result.current.chat.messages).toHaveLength(2);
});

it('空作文会话重复点击入口不新建，并保留已选示例插槽', async () => {
  const { result, createConversation, renameConversation } = setup();
  await act(async () => {});
  act(() => result.current.assistant.selectPrompt('correct/sample'));
  const slots = result.current.assistant.slotConfig;
  await act(async () => result.current.assistant.open(presets[0]));
  expect(createConversation).not.toHaveBeenCalled();
  expect(renameConversation).not.toHaveBeenCalled();
  expect(result.current.assistant.slotConfig).toBe(slots);
  expect(result.current.assistant.welcomeContent).toBeDefined();
});

it('助手创建期间切换入口后，返回的会话保留但不再激活', async () => {
  requestMock.mockResolvedValue(historyPage);
  const {
    result,
    createConversation,
    addConversation,
    setActiveConversationKey,
  } = setup();
  await act(async () => {});
  let resolve!: (value: { id: string; title: string }) => void;
  createConversation.mockReturnValue(
    new Promise((res) => {
      resolve = res;
    }),
  );
  let current = true;
  let opening!: Promise<void>;
  act(() => {
    opening = result.current.assistant.open(presets[0], () => current);
  });
  current = false;
  await act(async () => {
    resolve({ id: 'background-essay', title: '作文助手' });
    await opening;
  });
  expect(addConversation).toHaveBeenCalledTimes(1);
  expect(setActiveConversationKey).not.toHaveBeenCalled();
});

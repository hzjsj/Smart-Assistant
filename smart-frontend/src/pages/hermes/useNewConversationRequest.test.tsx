import { useXChat, type XModelParams } from '@ant-design/x-sdk';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HermesMessage } from './data';
import { HermesChatProvider } from './HermesChatProvider';
import { defaultPaperConfig, toPaperRequestConfig } from './paper';
import { useNewConversationRequest } from './useNewConversationRequest';

const makeProvider = () => {
  const run = vi.fn();
  const provider = new HermesChatProvider({
    request: {
      manual: true,
      options: {},
      run,
    } as unknown as HermesChatProvider['request'],
  });
  return { provider, run };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('waits for the real SDK store switch and sends once without historical context', async () => {
  const old = makeProvider();
  const next = makeProvider();
  const key = crypto.randomUUID();
  const oldKey = `${key}-old`;
  const nextKey = `${key}-new`;
  const { result, rerender } = renderHook(
    ({ activeKey }) => {
      const chat = useXChat<HermesMessage, HermesMessage, XModelParams>({
        provider: activeKey === oldKey ? old.provider : next.provider,
        conversationKey: activeKey,
        defaultMessages: (info?: { conversationKey?: string }) =>
          info?.conversationKey === oldKey
            ? [
                {
                  message: {
                    role: 'user' as const,
                    content: 'old history',
                    activities: [],
                  },
                },
              ]
            : [],
      });
      const pending = useNewConversationRequest({
        activeConversationKey: activeKey,
        initializing: chat.isDefaultMessagesRequesting,
        onSend: (content, paperConfig) =>
          chat.onRequest({
            messages: [{ role: 'user', content }],
            ...(paperConfig
              ? { task: 'question_bank', paper_config: paperConfig }
              : {}),
          }),
      });
      return { chat, pending };
    },
    {
      initialProps: { activeKey: oldKey },
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(StrictMode, null, children),
    },
  );
  await act(async () => {});
  expect(result.current.chat.messages[0].message.content).toBe('old history');
  act(() => {
    expect(
      result.current.pending.enqueue({
        conversationKey: nextKey,
        content: 'generate paper',
        paperConfig: toPaperRequestConfig({
          ...defaultPaperConfig,
          quantity: 9,
        }),
      }),
    ).toBe(true);
    expect(
      result.current.pending.enqueue({
        conversationKey: nextKey,
        content: 'duplicate',
      }),
    ).toBe(false);
  });
  act(() => vi.runOnlyPendingTimers());
  expect(old.run).not.toHaveBeenCalled();
  expect(next.run).not.toHaveBeenCalled();
  rerender({ activeKey: nextKey });
  await act(async () => {});
  act(() => vi.runOnlyPendingTimers());
  expect(next.run).toHaveBeenCalledTimes(1);
  expect(next.run.mock.calls[0][0]).toMatchObject({
    task: 'question_bank',
    paper_config: { quantity: 9 },
  });
  expect(next.run.mock.calls[0][0].messages).toEqual([
    { role: 'user', content: 'generate paper' },
  ]);
  expect(old.run).not.toHaveBeenCalled();
  rerender({ activeKey: nextKey });
  act(() => vi.runOnlyPendingTimers());
  expect(next.run).toHaveBeenCalledTimes(1);
  rerender({ activeKey: oldKey });
  await act(async () => {});
  expect(
    result.current.chat.messages.map((item) => item.message.content),
  ).toEqual(['old history']);
});

it('waits for initialization and cancels the scheduled send while away', () => {
  const onSend = vi.fn();
  const { result, rerender } = renderHook(
    ({ activeKey, initializing }) =>
      useNewConversationRequest({
        activeConversationKey: activeKey,
        initializing,
        onSend,
      }),
    { initialProps: { activeKey: 'new', initializing: true } },
  );
  act(() => {
    result.current.enqueue({ conversationKey: 'new', content: 'paper' });
  });
  act(() => vi.runOnlyPendingTimers());
  expect(onSend).not.toHaveBeenCalled();
  rerender({ activeKey: 'new', initializing: false });
  rerender({ activeKey: 'old', initializing: false });
  act(() => vi.runOnlyPendingTimers());
  expect(onSend).not.toHaveBeenCalled();
  rerender({ activeKey: 'new', initializing: false });
  act(() => vi.runOnlyPendingTimers());
  expect(onSend).toHaveBeenCalledTimes(1);
});

it('离开组卷入口时取消尚未发送的请求，重新进入不会偷偷发送旧配置', () => {
  const onSend = vi.fn();
  const { result, rerender } = renderHook(
    ({ initializing }) =>
      useNewConversationRequest({
        activeConversationKey: 'paper',
        initializing,
        onSend,
      }),
    { initialProps: { initializing: true } },
  );
  act(() => {
    result.current.enqueue({
      conversationKey: 'paper',
      content: '旧的组卷配置',
    });
    result.current.cancel();
  });
  rerender({ initializing: false });
  act(() => vi.runOnlyPendingTimers());
  expect(result.current.pending).toBe(false);
  expect(onSend).not.toHaveBeenCalled();
  act(() => {
    result.current.enqueue({
      conversationKey: 'paper',
      content: '新的组卷配置',
    });
  });
  act(() => vi.runOnlyPendingTimers());
  expect(onSend).toHaveBeenCalledWith('新的组卷配置', undefined);
});

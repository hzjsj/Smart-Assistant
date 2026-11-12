import type { MessageInfo } from '@ant-design/x-sdk';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesMessage } from './data';
import { nextTextEnd } from './streamingText';
import { usePacedMessages } from './usePacedMessages';

const reply = (
  content: string,
  status: MessageInfo<HermesMessage>['status'] = 'updating',
): MessageInfo<HermesMessage> => ({
  id: 'answer',
  status,
  message: { role: 'assistant', content, activities: [], contentActive: true },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('plays a burst at 50ms intervals and drains after SSE completion', () => {
  const input = [reply('春风吹过山坡，花草随风轻轻摇摆。')];
  const { result, rerender } = renderHook(
    ({ messages }) => usePacedMessages(messages, 'chat'),
    { initialProps: { messages: input } },
  );
  expect(result.current.visibleMessages[0].message.content).toBe('');
  act(() => vi.advanceTimersByTime(50));
  expect(result.current.visibleMessages[0].message.content).toBe('春风吹');
  rerender({ messages: [reply(input[0].message.content, 'success')] });
  expect(result.current.visibleMessages[0].status).toBe('updating');
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.visibleMessages[0].message.content).toBe(
    input[0].message.content,
  );
  expect(result.current.visibleMessages[0].status).toBe('success');
  expect(result.current.pending).toBe(false);
  expect(input[0].message.content).toBe('春风吹过山坡，花草随风轻轻摇摆。');
});

it('shows history immediately and never plays a previous conversation into the next one', () => {
  const { result, rerender } = renderHook(
    ({ messages, key }) => usePacedMessages(messages, key),
    { initialProps: { messages: [reply('第一段正在生成')], key: 'first' } },
  );
  act(() => vi.advanceTimersByTime(50));
  rerender({ messages: [reply('第二段历史记录', 'success')], key: 'second' });
  expect(result.current.visibleMessages[0].message.content).toBe(
    '第二段历史记录',
  );
  act(() => vi.advanceTimersByTime(100));
  expect(result.current.visibleMessages[0].message.content).toBe(
    '第二段历史记录',
  );
});

it.each([
  'abort',
  'error',
] as const)('reveals all received content on %s', (status) => {
  const { result, rerender } = renderHook(
    ({ messages }) => usePacedMessages(messages, 'chat'),
    {
      initialProps: {
        messages: [reply('这是一段已经收到但尚未显示完成的内容')],
      },
    },
  );
  rerender({ messages: [reply('已收到的内容', status)] });
  expect(result.current.visibleMessages[0].message.content).toBe(
    '已收到的内容',
  );
  expect(result.current.visibleMessages[0].status).toBe(status);
  expect(result.current.pending).toBe(false);
});

it('holds unclosed display math, commits closed math atomically and releases malformed final text', () => {
  expect(nextTextEnd('$$\\frac{1}{2}', 0, 3, false)).toBe(0);
  expect(nextTextEnd('题目：$$x+1', 0, 5, false)).toBe(3);
  expect(nextTextEnd('题目：\\[x+1', 0, 5, false)).toBe(3);
  const math = '$$\\frac{1}{2}$$';
  expect(nextTextEnd(`${math}答案`, 0, 3, false)).toBe(math.length);
  expect(nextTextEnd('$$未闭合', 0, 3, true)).toBe(3);
  const bracketMath = '\\[x^2+1\\]';
  expect(nextTextEnd(bracketMath, 0, 1, false)).toBe(bracketMath.length);
});

it('keeps emoji graphemes intact and exposes unclosed inline math as source', () => {
  const family = '👨‍👩‍👧‍👦';
  expect(nextTextEnd(`${family}你好`, 0, 1, false)).toBe(family.length);
  expect(nextTextEnd('$x+1', 0, 3, false)).toBe(3);
  expect(nextTextEnd('```tex\n$$x', 7, 3, false)).toBe(10);
});

it('does not put question-bank JSON metadata into the typewriter queue', () => {
  const card = {
    type: 'question_bank',
    version: 1,
    id: 'bank',
    name: '题库.json',
    url: `https://example.com/bank.json?sig=${'a'.repeat(5000)}`,
  };
  const source = `题库已生成。\n\`\`\`question-bank\n${JSON.stringify(card)}\n\`\`\``;
  const { result, rerender } = renderHook(
    ({ messages }) => usePacedMessages(messages, 'chat'),
    { initialProps: { messages: [reply(source)] } },
  );
  rerender({ messages: [reply(source, 'success')] });
  act(() => vi.advanceTimersByTime(200));
  expect(result.current.pending).toBe(false);
  expect(result.current.visibleMessages[0].message.content).toBe(
    '题库已生成。',
  );
  expect(result.current.visibleMessages[0].message.questionBanks).toHaveLength(
    1,
  );
  expect(source).toContain('question-bank');
});

it('reports truncated bank metadata after completion instead of staying in loading forever', () => {
  const messages = [
    reply('说明\n```question-bank\n{"type":"question_bank"', 'success'),
  ];
  const { result } = renderHook(() => usePacedMessages(messages, 'chat'));
  expect(result.current.visibleMessages[0].message.questionBankPending).toBe(
    false,
  );
  expect(
    result.current.visibleMessages[0].message.questionBankErrors,
  ).toContain('题库信息未完整返回，请重新生成');
});

describe('background completion', () => {
  let hidden = false;
  const changeVisibility = (value: boolean) => {
    hidden = value;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
  };

  beforeEach(() => {
    hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  });

  it('flushes on hide and displays new data and success without playback timers', () => {
    const { result, rerender } = renderHook(
      ({ messages }) => usePacedMessages(messages, 'chat'),
      { initialProps: { messages: [reply('后台生成前已有的内容')] } },
    );
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.visibleMessages[0].message.content).toBe('后台生');
    changeVisibility(true);
    expect(result.current.visibleMessages[0].message.content).toBe(
      '后台生成前已有的内容',
    );
    expect(result.current.pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const fullText =
      '后台生成前已有的内容，后续数据含公式 $$x^2+1$$，现在已经完成。';
    rerender({ messages: [reply(fullText)] });
    expect(result.current.visibleMessages[0].message.content).toBe(fullText);
    rerender({ messages: [reply(fullText, 'success')] });
    expect(result.current.visibleMessages[0].status).toBe('success');
    changeVisibility(false);
    expect(result.current.visibleMessages[0].message.content).toBe(fullText);
    expect(result.current.pending).toBe(false);
  });

  it('does not re-queue late SDK updates delivered after returning to the page', () => {
    const { result, rerender } = renderHook(
      ({ messages }) => usePacedMessages(messages, 'chat'),
      { initialProps: { messages: [reply('最初收到的几个字')] } },
    );
    changeVisibility(true);
    changeVisibility(false);
    const finalText = '后台期间已收齐、恢复时才由 SDK 通知界面的完整回复。';
    rerender({ messages: [reply(finalText, 'success')] });
    expect(result.current.visibleMessages[0].message.content).toBe(finalText);
    expect(result.current.visibleMessages[0].status).toBe('success');
    expect(result.current.pending).toBe(false);
  });

  it('flushes a completed stream whose foreground animation is still pending', () => {
    const text = '服务端已经结束，前台还有一整段内容尚未播放完成。';
    const { result, rerender } = renderHook(
      ({ messages }) => usePacedMessages(messages, 'chat'),
      { initialProps: { messages: [reply(text)] } },
    );
    rerender({ messages: [reply(text, 'success')] });
    expect(result.current.pending).toBe(true);
    changeVisibility(true);
    expect(result.current.visibleMessages[0].message.content).toBe(text);
    expect(result.current.visibleMessages[0].status).toBe('success');
    expect(result.current.pending).toBe(false);
  });

  it('mounts hidden in realtime mode and restores pacing for a new foreground reply', () => {
    hidden = true;
    const { result, rerender } = renderHook(
      ({ messages }) => usePacedMessages(messages, 'chat'),
      { initialProps: { messages: [reply('后台直接显示全部内容')] } },
    );
    expect(result.current.visibleMessages[0].message.content).toBe(
      '后台直接显示全部内容',
    );
    expect(vi.getTimerCount()).toBe(0);
    rerender({ messages: [reply('后台直接显示全部内容', 'success')] });
    changeVisibility(false);
    rerender({
      messages: [{ ...reply('新回复恢复逐字播放'), id: 'next-answer' }],
    });
    expect(result.current.visibleMessages[0].message.content).toBe('');
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.visibleMessages[0].message.content).toBe('新回复');
  });

  it('catches up on focus and pageshow, and removes lifecycle listeners on unmount', () => {
    const messages = [reply('页面重新获得焦点后无需继续补播。')];
    const { result, unmount } = renderHook(() =>
      usePacedMessages(messages, 'chat'),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current.pending).toBe(false);
    act(() => window.dispatchEvent(new Event('pageshow')));
    expect(result.current.visibleMessages[0].message.content).toBe(
      '页面重新获得焦点后无需继续补播。',
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

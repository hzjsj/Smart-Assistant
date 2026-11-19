import type { MessageInfo } from '@ant-design/x-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { chatTokens } from './chatTokens';
import type { HermesMessage } from './data';
import { parseQuestionBankReply } from './question-bank/protocol';
import { nextTextEnd } from './streamingText';

type ChatMessage = MessageInfo<HermesMessage>;
type Playback = {
  target: string;
  shown: string;
  finished: boolean;
  realtime: boolean;
};

/** Presentation only: useXChat retains the complete response and tool events. */
export function usePacedMessages(
  messages: ChatMessage[],
  conversationKey: string,
) {
  // Preserve the raw content in useXChat for context/copy/history. Only this
  // presentation projection removes structured bank metadata from typewriting.
  const projectedMessages = useMemo(
    () =>
      messages.map((info) => {
        if (
          info.message.role !== 'assistant' ||
          !info.message.content.includes('```q')
        )
          return info;
        const parsed = parseQuestionBankReply(info.message.content);
        const active = info.status === 'loading' || info.status === 'updating';
        return {
          ...info,
          message: {
            ...info.message,
            content: parsed.markdown,
            questionBanks: parsed.cards,
            questionBankPending: parsed.pending && active,
            questionBankErrors:
              parsed.pending && !active
                ? [...parsed.errors, '题库信息未完整返回，请重新生成']
                : parsed.errors,
          },
        };
      }),
    [messages],
  );
  const playback = useRef(new Map<string | number, Playback>());
  const scope = useRef(conversationKey);
  const [snapshot, setSnapshot] = useState({
    key: conversationKey,
    text: new Map<string | number, string>(),
  });

  useEffect(() => {
    if (scope.current !== conversationKey) {
      playback.current.clear();
      scope.current = conversationKey;
    }
    const liveIds = new Set(projectedMessages.map(({ id }) => id));
    for (const id of playback.current.keys()) {
      if (!liveIds.has(id)) playback.current.delete(id);
    }

    for (const info of projectedMessages) {
      if (info.message.role !== 'assistant') continue;
      const target = info.message.content;
      const active = info.status === 'loading' || info.status === 'updating';
      const prior = playback.current.get(info.id);
      const interrupted = info.status === 'abort' || info.status === 'error';
      const restarted = active && prior?.finished;
      // 历史恢复的流式消息已落库完整内容：直接展示，避免刷新后从空串重放打字机
      const restored = Boolean(info.message.restoredStreaming);
      const realtime =
        document.hidden || restored || (!restarted && Boolean(prior?.realtime));
      playback.current.set(info.id, {
        target,
        shown:
          realtime || interrupted || (prior && !target.startsWith(prior.shown))
            ? target
            : (prior?.shown ?? (active ? '' : target)),
        finished: !active,
        realtime,
      });
    }
    setSnapshot({
      key: conversationKey,
      text: new Map(
        [...playback.current].map(([id, value]) => [id, value.shown]),
      ),
    });
  }, [projectedMessages, conversationKey]);

  useEffect(() => {
    let timer: number | undefined;
    const publish = () => {
      setSnapshot({
        key: conversationKey,
        text: new Map(
          [...playback.current].map(([id, value]) => [id, value.shown]),
        ),
      });
    };
    const catchUp = () => {
      // Once a reply has run in the background, keep it in realtime mode until
      // it finishes. Late SDK notifications after resume must not re-queue it.
      for (const value of playback.current.values()) {
        value.realtime = true;
        value.shown = value.target;
      }
      publish();
    };
    const tick = () => {
      let changed = false;
      for (const value of playback.current.values()) {
        if (value.shown === value.target) continue;
        if (value.realtime || document.hidden) {
          value.shown = value.target;
          changed = true;
          continue;
        }
        const step =
          chatTokens.minStep +
          Math.floor(
            Math.random() * (chatTokens.maxStep - chatTokens.minStep + 1),
          );
        const end = nextTextEnd(
          value.target,
          value.shown.length,
          step,
          value.finished,
        );
        if (end === value.shown.length) continue;
        value.shown = value.target.slice(0, end);
        changed = true;
      }
      if (changed) publish();
    };
    const updateVisibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      catchUp();
      if (!document.hidden)
        timer = window.setInterval(tick, chatTokens.frameMs);
    };

    if (!document.hidden) timer = window.setInterval(tick, chatTokens.frameMs);
    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('focus', catchUp);
    window.addEventListener('pageshow', catchUp);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', updateVisibility);
      window.removeEventListener('focus', catchUp);
      window.removeEventListener('pageshow', catchUp);
    };
  }, [conversationKey]);

  const visibleMessages = projectedMessages.map((info): ChatMessage => {
    if (info.message.role !== 'assistant') return info;
    if (info.status === 'abort' || info.status === 'error') return info;
    if (document.hidden || playback.current.get(info.id)?.realtime) return info;
    const active = info.status === 'loading' || info.status === 'updating';
    const text =
      (snapshot.key === conversationKey
        ? snapshot.text.get(info.id)
        : undefined) ?? (active ? '' : info.message.content);
    if (text === info.message.content) return info;
    return {
      ...info,
      status: 'updating',
      message: { ...info.message, content: text, contentActive: true },
    };
  });

  const flush = () => {
    for (const value of playback.current.values()) value.shown = value.target;
    setSnapshot({
      key: conversationKey,
      text: new Map(
        [...playback.current].map(([id, value]) => [id, value.shown]),
      ),
    });
  };

  return {
    visibleMessages,
    pending: visibleMessages.some(
      (info, index) =>
        info.message.content !== projectedMessages[index].message.content,
    ),
    flush,
  };
}

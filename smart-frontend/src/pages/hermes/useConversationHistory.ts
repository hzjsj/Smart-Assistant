import type { MessageInfo } from '@ant-design/x-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listMessages,
  type MessagePage,
  messageRecordToMessageInfo,
} from './conversationService';
import type { HermesMessage } from './data';

type HistoryStatus = 'loading' | 'ready' | 'error';

export interface RestoredHistory {
  conversationKey: string;
  hasAttachments: boolean;
  streaming: boolean;
}

/** 历史拉取和消息注入分两步，等待 SDK 切换会话 store 后才恢复。 */
export function useConversationHistory({
  activeConversationKey,
  enabled,
  messageCount,
  setMessages,
  onRestored,
}: {
  activeConversationKey: string;
  enabled: boolean;
  messageCount: number;
  setMessages: (messages: MessageInfo<HermesMessage>[]) => void;
  onRestored: (history: RestoredHistory) => void;
}) {
  const restoredConversations = useRef(new Set<string>());
  const [historyState, setHistoryState] = useState<{
    key: string;
    status: HistoryStatus;
  }>({ key: activeConversationKey, status: 'loading' });
  const [pendingRestore, setPendingRestore] = useState<{
    key: string;
    page: MessagePage;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (restoredConversations.current.has(activeConversationKey)) {
      setHistoryState({ key: activeConversationKey, status: 'ready' });
      return;
    }
    let cancelled = false;
    setHistoryState({ key: activeConversationKey, status: 'loading' });
    void (async () => {
      try {
        const page = await listMessages(activeConversationKey);
        if (!cancelled) setPendingRestore({ key: activeConversationKey, page });
      } catch {
        if (!cancelled) {
          setHistoryState({ key: activeConversationKey, status: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConversationKey, enabled]);

  useEffect(() => {
    if (!pendingRestore) return;
    if (pendingRestore.key !== activeConversationKey) {
      setPendingRestore(null);
      return;
    }
    // 欢迎语独立展示；这里的内存消息只可能是真实历史或进行中的对话。
    if (messageCount === 0) {
      const records = pendingRestore.page.messages;
      const last = records[records.length - 1];
      const streaming = Boolean(
        last &&
          (last.role === 'user' ||
            (last.role === 'assistant' && last.status === 0)),
      );
      const messages = records.map((record, index) =>
        messageRecordToMessageInfo(
          record,
          streaming && index === records.length - 1,
        ),
      );
      setMessages(messages);
      onRestored({
        conversationKey: activeConversationKey,
        hasAttachments: messages.some((info) =>
          Boolean(info.message.attachments?.length),
        ),
        streaming,
      });
    }
    restoredConversations.current.add(activeConversationKey);
    setHistoryState({ key: activeConversationKey, status: 'ready' });
    setPendingRestore(null);
  }, [
    activeConversationKey,
    messageCount,
    onRestored,
    pendingRestore,
    setMessages,
  ]);

  const forgetConversation = useCallback((key: string) => {
    restoredConversations.current.delete(key);
  }, []);

  return {
    status:
      enabled && historyState.key === activeConversationKey
        ? historyState.status
        : ('loading' as const),
    forgetConversation,
  };
}

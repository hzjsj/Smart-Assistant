import { useEffect, useRef, useState } from 'react';
import { importQuestionBank } from './service';
import type { QuestionBankCardData, QuestionBankEntry } from './types';

interface WorkspaceState {
  open: boolean;
  activeKey?: string;
  loading?: QuestionBankCardData;
  error?: string;
  retryCard?: QuestionBankCardData;
}

export function useQuestionBankWorkspace(conversationKey: string) {
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceState>>(
    {},
  );
  const [entries, setEntries] = useState<Record<string, QuestionBankEntry>>({});
  const requests = useRef(new Map<string, AbortController>());
  const cache = useRef(entries);
  cache.current = entries;
  const state = workspaces[conversationKey] || { open: false };
  const entry = state.activeKey ? entries[state.activeKey] : undefined;

  useEffect(
    () => () => {
      for (const controller of requests.current.values()) controller.abort();
    },
    [],
  );

  const updateState = (patch: Partial<WorkspaceState>) =>
    setWorkspaces((previous) => ({
      ...previous,
      [conversationKey]: {
        ...(previous[conversationKey] || { open: false }),
        ...patch,
      },
    }));

  const openBank = async (card: QuestionBankCardData) => {
    const key = JSON.stringify([conversationKey, card.id, card.url]);
    requests.current.get(conversationKey)?.abort();
    if (cache.current[key]) {
      updateState({
        open: true,
        activeKey: key,
        loading: undefined,
        error: undefined,
        retryCard: undefined,
      });
      return;
    }
    const controller = new AbortController();
    requests.current.set(conversationKey, controller);
    updateState({
      open: true,
      loading: card,
      error: undefined,
      retryCard: card,
    });
    try {
      const bank = await importQuestionBank(card, controller.signal);
      if (controller.signal.aborted) return;
      setEntries((previous) => ({
        ...previous,
        [key]: previous[key] || {
          key,
          card,
          bank,
          title: bank.document.title,
          selectedIds: bank.document.questions.map((question) => question.id),
          showAnswers: false,
        },
      }));
      updateState({
        activeKey: key,
        loading: undefined,
        error: undefined,
        retryCard: undefined,
      });
    } catch (error) {
      if (!controller.signal.aborted)
        updateState({
          loading: undefined,
          error: error instanceof Error ? error.message : '题库加载失败',
          retryCard: card,
        });
    }
  };

  const close = () => {
    requests.current.get(conversationKey)?.abort();
    updateState({ open: false, loading: undefined });
  };
  const patchEntry = (
    patch: Partial<
      Pick<QuestionBankEntry, 'selectedIds' | 'showAnswers' | 'title'>
    >,
  ) => {
    if (!state.activeKey) return;
    const key = state.activeKey;
    setEntries((previous) => ({
      ...previous,
      [key]: { ...previous[key], ...patch },
    }));
  };

  return {
    state,
    entry,
    openBank,
    close,
    patchEntry,
    retry: () => state.retryCard && openBank(state.retryCard),
  };
}

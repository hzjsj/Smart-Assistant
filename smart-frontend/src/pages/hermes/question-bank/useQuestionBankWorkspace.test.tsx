import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { importQuestionBank } from './service';
import { useQuestionBankWorkspace } from './useQuestionBankWorkspace';

vi.mock('./service', () => ({ importQuestionBank: vi.fn() }));
const card = {
  type: 'question_bank' as const,
  version: 1 as const,
  id: 'one',
  name: '题库.json',
  url: 'https://example.com/one.json',
};
const bank = {
  id: 'saved',
  question_count: 2,
  total_score: 10,
  document: {
    type: 'question_bank' as const,
    version: 1 as const,
    id: 'one',
    title: '试卷',
    subject: '数学',
    grade: '初一',
    exam_type: '单元测试',
    difficulty: 5,
    questions: ['q1', 'q2'].map((id) => ({
      id,
      type: '填空题',
      content: '1+1=',
      options: [],
      answer: '2',
      analysis: '',
      score: 5,
      knowledge_points: [],
      cognitive_level: '',
      difficulty: 5,
    })),
  },
};

beforeEach(() => vi.clearAllMocks());

it('opens only on click, retains selection on close/reopen and isolates conversations', async () => {
  vi.mocked(importQuestionBank).mockResolvedValue(bank);
  const { result, rerender } = renderHook(
    ({ scope }) => useQuestionBankWorkspace(scope),
    { initialProps: { scope: 'chat-a' } },
  );
  expect(result.current.state.open).toBe(false);
  await act(async () => {
    await result.current.openBank(card);
  });
  expect(result.current.entry?.selectedIds).toEqual(['q1', 'q2']);
  act(() => result.current.patchEntry({ selectedIds: ['q2'] }));
  act(() => result.current.close());
  await act(async () => {
    await result.current.openBank(card);
  });
  expect(result.current.entry?.selectedIds).toEqual(['q2']);
  expect(importQuestionBank).toHaveBeenCalledTimes(1);
  rerender({ scope: 'chat-b' });
  expect(result.current.state.open).toBe(false);
  expect(result.current.entry).toBeUndefined();
  rerender({ scope: 'chat-a' });
  expect(result.current.entry?.selectedIds).toEqual(['q2']);
});

it('keeps the current bank when a new bank fails to load', async () => {
  vi.mocked(importQuestionBank)
    .mockResolvedValueOnce(bank)
    .mockRejectedValueOnce(new Error('链接已过期'));
  const { result } = renderHook(() => useQuestionBankWorkspace('chat'));
  await act(async () => {
    await result.current.openBank(card);
  });
  await act(async () => {
    await result.current.openBank({
      ...card,
      id: 'two',
      url: 'https://example.com/two.json',
    });
  });
  expect(result.current.entry?.bank.id).toBe('saved');
  expect(result.current.state.error).toBe('链接已过期');
});

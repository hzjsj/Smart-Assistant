import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useProcessDisclosure } from './useProcessDisclosure';

it('keeps manual choices during a stream, collapses once on completion, and allows reopening', () => {
  const { result, rerender } = renderHook(
    ({ active }) => useProcessDisclosure(active),
    { initialProps: { active: true } },
  );
  expect(result.current.expanded).toBe(true);
  act(() => result.current.setExpanded(false));
  rerender({ active: true });
  expect(result.current.expanded).toBe(false);
  act(() => {
    result.current.setExpanded(true);
    result.current.setToolKeys(['tool-1']);
    result.current.toggleReasoning('reason-1');
  });
  rerender({ active: false });
  expect(result.current.expanded).toBe(false);
  act(() => result.current.setExpanded(true));
  rerender({ active: false });
  expect(result.current.expanded).toBe(true);
  expect(result.current.toolKeys).toEqual(['tool-1']);
  expect(result.current.reasoningKeys).toEqual(['reason-1']);
});

it('starts history closed and resets nested details when the same reply is regenerated', () => {
  const { result, rerender } = renderHook(
    ({ active }) => useProcessDisclosure(active),
    { initialProps: { active: false } },
  );
  expect(result.current.expanded).toBe(false);
  act(() => {
    result.current.setExpanded(true);
    result.current.setToolKeys(['old-tool']);
    result.current.toggleReasoning('old-reason');
  });
  rerender({ active: true });
  expect(result.current.expanded).toBe(true);
  expect(result.current.toolKeys).toEqual([]);
  expect(result.current.reasoningKeys).toEqual([]);
});

it('isolates expansion between separate replies', () => {
  const { result, rerender } = renderHook(
    ({ active }) => ({
      first: useProcessDisclosure(active),
      second: useProcessDisclosure(false),
    }),
    { initialProps: { active: true } },
  );
  act(() => {
    result.current.second.setExpanded(true);
    result.current.first.setToolKeys(['first-tool']);
  });
  rerender({ active: false });
  expect(result.current.first.expanded).toBe(false);
  expect(result.current.second.expanded).toBe(true);
  expect(result.current.second.toolKeys).toEqual([]);
});

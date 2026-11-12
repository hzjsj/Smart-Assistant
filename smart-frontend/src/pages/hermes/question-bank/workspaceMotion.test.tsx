import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  useWorkspaceMotion,
  WORKSPACE_MOTION_MS,
  workspacePercentages,
} from './workspaceMotion';

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('animates desktop toggles and cancels the previous timer on rapid reversal', () => {
  const { result, rerender } = renderHook(
    ({ open, wide }) => useWorkspaceMotion(open, wide),
    { initialProps: { open: false, wide: true } },
  );
  rerender({ open: true, wide: true });
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(100));
  rerender({ open: false, wide: true });
  act(() => vi.advanceTimersByTime(WORKSPACE_MOTION_MS - 100));
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(100));
  expect(result.current).toBe(false);
});

it('does not animate mobile or reduced-motion changes and clears timers at a breakpoint', () => {
  const { result, rerender } = renderHook(
    ({ open, wide }) => useWorkspaceMotion(open, wide),
    { initialProps: { open: false, wide: true } },
  );
  rerender({ open: true, wide: true });
  expect(result.current).toBe(true);
  rerender({ open: false, wide: false });
  expect(result.current).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: true,
  } as MediaQueryList);
  rerender({ open: true, wide: true });
  rerender({ open: false, wide: true });
  expect(result.current).toBe(false);
});

it('stores drag sizes as percentages so container changes preserve the ratio', () => {
  expect(workspacePercentages([360, 1080])).toEqual(['25%', '75%']);
  expect(workspacePercentages([0, 0])).toEqual(['40%', '60%']);
});

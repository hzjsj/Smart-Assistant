import { act, renderHook } from '@testing-library/react';
import type { UIEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoHideScrollbar } from './useAutoHideScrollbar';

const scrollEvent = (values: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) => ({ currentTarget: values }) as unknown as UIEvent<HTMLElement>;

describe('useAutoHideScrollbar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('滚动时显示并按可见比例计算滑块，停止 600ms 后隐藏', () => {
    const { result } = renderHook(() => useAutoHideScrollbar());
    expect(result.current.visible).toBe(false);

    act(() => {
      result.current.onScroll(
        scrollEvent({ scrollTop: 250, scrollHeight: 1000, clientHeight: 500 }),
      );
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.thumb).toEqual({ top: 25, height: 50 });

    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.visible).toBe(false);
  });

  it('反序滚动容器按负向 scrollTop 换算：底部为 0，向上为负', () => {
    const { result } = renderHook(() =>
      useAutoHideScrollbar({ reversed: true }),
    );

    act(() => {
      result.current.onScroll(
        scrollEvent({ scrollTop: -500, scrollHeight: 1000, clientHeight: 500 }),
      );
    });
    expect(result.current.thumb).toEqual({ top: 50, height: 50 });

    act(() => {
      result.current.onScroll(
        scrollEvent({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 }),
      );
    });
    expect(result.current.thumb).toEqual({ top: 0, height: 50 });
  });

  it('连续滚动会重置隐藏计时', () => {
    const { result } = renderHook(() => useAutoHideScrollbar());

    act(() => {
      result.current.onScroll(
        scrollEvent({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      result.current.onScroll(
        scrollEvent({ scrollTop: 120, scrollHeight: 1000, clientHeight: 500 }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.visible).toBe(false);
  });

  it('内容不溢出时滚动不改变滑块尺寸', () => {
    const { result } = renderHook(() => useAutoHideScrollbar());

    act(() => {
      result.current.onScroll(
        scrollEvent({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 }),
      );
    });

    expect(result.current.thumb).toEqual({ top: 0, height: 0 });
  });
});

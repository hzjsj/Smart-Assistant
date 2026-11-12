import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEntryNavigation } from './useEntryNavigation';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

it('连续点击相同入口只执行一次创建', async () => {
  const pending = deferred();
  const create = vi.fn(() => pending.promise);
  const { result } = renderHook(useEntryNavigation);
  let first!: Promise<void>;
  act(() => {
    first = result.current.run('assistant:essay', create);
  });
  await act(async () => {
    await result.current.run('assistant:essay', create);
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(result.current.pendingKey).toBe('assistant:essay');
  await act(async () => {
    pending.resolve();
    await first;
  });
  expect(result.current.pendingKey).toBeNull();
});

it('后点击的入口优先，旧请求完成时不会清除新入口的等待状态', async () => {
  const old = deferred();
  const next = deferred();
  const activate = vi.fn();
  const { result } = renderHook(useEntryNavigation);
  let oldRun!: Promise<void>;
  let nextRun!: Promise<void>;
  act(() => {
    oldRun = result.current.run('chat', async (isCurrent) => {
      await old.promise;
      if (isCurrent()) activate('chat');
    });
    nextRun = result.current.run('assistant:essay', async (isCurrent) => {
      await next.promise;
      if (isCurrent()) activate('essay');
    });
  });
  await act(async () => {
    old.resolve();
    await oldRun;
  });
  expect(activate).not.toHaveBeenCalled();
  expect(result.current.pendingKey).toBe('assistant:essay');
  await act(async () => {
    next.resolve();
    await nextRun;
  });
  expect(activate).toHaveBeenCalledWith('essay');
  expect(result.current.pendingKey).toBeNull();
});

it('切换表单或历史会话后取消旧导航，下一次点击仍可创建', async () => {
  const pending = deferred();
  const activate = vi.fn();
  const { result } = renderHook(useEntryNavigation);
  let running!: Promise<void>;
  act(() => {
    running = result.current.run('chat', async (isCurrent) => {
      await pending.promise;
      if (isCurrent()) activate();
    });
    result.current.cancel();
  });
  await act(async () => {
    pending.resolve();
    await running;
  });
  expect(activate).not.toHaveBeenCalled();
  expect(result.current.pendingKey).toBeNull();
  await act(async () => {
    await result.current.run('chat', async (isCurrent) => {
      if (isCurrent()) activate();
    });
  });
  expect(activate).toHaveBeenCalledTimes(1);
});

it('创建失败后释放防重状态，卸载后过期请求不能激活页面', async () => {
  const { result, unmount } = renderHook(useEntryNavigation);
  await act(async () => {
    await expect(
      result.current.run('chat', async () => {
        throw new Error('失败');
      }),
    ).rejects.toThrow('失败');
  });
  expect(result.current.pendingKey).toBeNull();
  const pending = deferred();
  const activate = vi.fn();
  let running!: Promise<void>;
  act(() => {
    running = result.current.run('chat', async (isCurrent) => {
      await pending.promise;
      if (isCurrent()) activate();
    });
  });
  unmount();
  pending.resolve();
  await running;
  expect(activate).not.toHaveBeenCalled();
});

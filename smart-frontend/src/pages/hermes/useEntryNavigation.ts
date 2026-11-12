import { useCallback, useEffect, useRef, useState } from 'react';

/** 三个入口共用异步导航状态：同一入口防重，切换入口后旧请求不再激活页面。 */
export function useEntryNavigation() {
  const pending = useRef<{ key: string } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const cancel = useCallback(() => {
    pending.current = null;
    setPendingKey(null);
  }, []);

  const run = useCallback(
    async (
      key: string,
      action: (isCurrent: () => boolean) => Promise<void>,
    ) => {
      if (pending.current?.key === key) return;
      const entry = { key };
      pending.current = entry;
      setPendingKey(key);
      try {
        await action(() => pending.current === entry);
      } finally {
        if (pending.current === entry) {
          pending.current = null;
          setPendingKey(null);
        }
      }
    },
    [],
  );

  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );

  return { run, cancel, pendingKey };
}

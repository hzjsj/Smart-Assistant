// src/hooks/useDelayedLoading.ts
import { useEffect, useRef, useState } from 'react';

/**
 * loading 持续超过 delay 毫秒后才返回 true；快速结束则始终为 false。
 * 用于避免本地接口很快返回时骨架屏「瞬闪」。
 */
export function useDelayedLoading(loading: boolean, delay = 150) {
  const [delayed, setDelayed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!loading) {
      setDelayed(false);
      return;
    }
    timerRef.current = setTimeout(() => setDelayed(true), delay);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loading, delay]);

  return delayed;
}

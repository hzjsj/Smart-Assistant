import type { UIEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

export type ScrollIndicatorMetrics = {
  /** 滑块顶部位置（百分比，相对指示器轨道） */
  top: number;
  /** 滑块高度（百分比，相对指示器轨道） */
  height: number;
};

/**
 * 自绘滚动条状态：滚动时显示指示器，停止 delay 毫秒后淡出。
 *
 * 原生滚动条由样式隐藏，返回的 onScroll 必须绑定到真正的滚动容器。
 * 反序滚动容器（如 Bubble.List 的 column-reverse，scrollTop 为
 * [-maxScroll, 0]）传 `reversed: true`，滑块位置按可视偏移量换算。
 */
export const useAutoHideScrollbar = (options?: {
  delay?: number;
  reversed?: boolean;
}) => {
  const delay = options?.delay ?? 600;
  const reversed = options?.reversed ?? false;
  const [visible, setVisible] = useState(false);
  const [thumb, setThumb] = useState<ScrollIndicatorMetrics>({
    top: 0,
    height: 0,
  });
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  const onScroll = (event: UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll > 0) {
      // 滑块最小高度由样式兜底，这里按可见比例计算。
      const height = Math.max((clientHeight / scrollHeight) * 100, 6);
      const offset = Math.min(
        Math.max(reversed ? -scrollTop : scrollTop, 0),
        maxScroll,
      );
      setThumb({ top: (offset / maxScroll) * (100 - height), height });
    }
    setVisible(true);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setVisible(false);
      timer.current = undefined;
    }, delay);
  };

  return { visible, thumb, onScroll };
};

import { useLayoutEffect, useRef, useState } from 'react';

export const WORKSPACE_MOTION_MS = 280;
export const DEFAULT_WORKSPACE_SIZES = ['40%', '60%'];

export function workspacePercentages(sizes: number[]): string[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > 0
    ? sizes.map((size) => `${(size / total) * 100}%`)
    : [...DEFAULT_WORKSPACE_SIZES];
}

/** Animate only explicit desktop open/close, never pointer-driven resizing. */
export function useWorkspaceMotion(open: boolean, wide: boolean) {
  const previous = useRef({ open, wide });
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { open, wide };
    if (before.open === open && before.wide === wide) return;
    const animate =
      wide &&
      before.wide &&
      before.open !== open &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setMoving(animate);
    if (!animate) return;
    const timer = window.setTimeout(
      () => setMoving(false),
      WORKSPACE_MOTION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, wide]);
  return moving;
}

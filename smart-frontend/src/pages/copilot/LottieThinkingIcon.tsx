import lottie, { type AnimationItem } from 'lottie-web';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import thinkingData from '@/assets/lottie/thinking.json';

/**
 * Lottie 元数据（thinking.json）：ip=0、op=26，端点帧 = op - ip - 1 = 25。
 * 帧 0/25 视觉一致（张开态），图标只负责切换瞬间的动感。
 */
const IP = thinkingData.ip ?? 0;
const OP = thinkingData.op;
const LAST = OP - IP - 1;

export type LottieThinkingIconProps = {
  /** 深度思考是否开启 */
  active: boolean;
  /** 图标尺寸（px） */
  size?: number;
};

/**
 * 深度思考开关的 Lottie 图标（SVG renderer）。
 *
 * - 挂载：initialSegment 固定为当前状态对应的端点帧，直接停在端点，无入场动画
 * - 切换：在同一个动画实例内 playSegments 正播/倒放，不 destroy 重建、不淡入淡出
 * - 颜色（描边/圆点 rgb(15,17,20)）已烘焙进 JSON，不使用 currentColor
 */
export default function LottieThinkingIcon({
  active,
  size = 14,
}: LottieThinkingIconProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  // 仅取挂载时的状态，initialSegment 固定不变，避免每次渲染重建动画
  const initialActiveRef = useRef(active);
  const initialSegment = useMemo<[number, number]>(() => {
    const at = initialActiveRef.current ? LAST : IP;
    return [at, at];
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: thinkingData,
      initialSegment,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    });
    animRef.current = anim;
    return () => {
      anim.destroy();
      animRef.current = null;
    };
  }, [initialSegment]);

  useLayoutEffect(() => {
    const anim = animRef.current;
    if (!anim || !anim.isLoaded) return;
    const target = active ? LAST : IP;
    // 当前绝对帧必须用 firstFrame + currentRawFrame（不能只读 currentRawFrame）
    const current = anim.firstFrame + anim.currentRawFrame;
    if (current !== target) {
      // target < current 时 lottie 内部 adjustSegment 会自动把 playDirection 置为 -1
      anim.playSegments([current, target], true);
    }
  }, [active]);

  return (
    <span
      ref={containerRef}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        flexShrink: 0,
      }}
    />
  );
}

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const lottieMock = vi.hoisted(() => ({ loadAnimation: vi.fn() }));

vi.mock('lottie-web', () => ({ default: lottieMock }));

import LottieThinkingIcon from './index';

type FakeAnimation = {
  isLoaded: boolean;
  firstFrame: number;
  currentRawFrame: number;
  playSegments: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

function createAnimation(
  overrides: Partial<FakeAnimation> = {},
): FakeAnimation {
  return {
    isLoaded: true,
    firstFrame: 0,
    currentRawFrame: 0,
    playSegments: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
}

function loadParams(index = 0) {
  return lottieMock.loadAnimation.mock.calls[index][0] as {
    renderer: string;
    loop: boolean;
    autoplay: boolean;
    initialSegment: [number, number];
  };
}

describe('LottieThinkingIcon', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('挂载时直接停在端点帧，不播放入场动画', () => {
    const anim = createAnimation();
    lottieMock.loadAnimation.mockReturnValue(anim);

    render(<LottieThinkingIcon active={false} />);

    expect(lottieMock.loadAnimation).toHaveBeenCalledTimes(1);
    expect(loadParams()).toMatchObject({
      renderer: 'svg',
      loop: false,
      autoplay: false,
      initialSegment: [0, 0],
    });
    expect(anim.playSegments).not.toHaveBeenCalled();
  });

  it('初始为开时停在端点帧 25', () => {
    lottieMock.loadAnimation.mockReturnValue(
      createAnimation({ firstFrame: 25 }),
    );

    render(<LottieThinkingIcon active />);

    expect(loadParams().initialSegment).toEqual([25, 25]);
  });

  it('切换时在同一实例内正播/倒放，不重建动画', () => {
    const anim = createAnimation();
    lottieMock.loadAnimation.mockReturnValue(anim);

    const view = render(<LottieThinkingIcon active={false} />);

    // 开：0 → 25 正播
    view.rerender(<LottieThinkingIcon active />);
    expect(anim.playSegments).toHaveBeenCalledWith([0, 25], true);

    // 模拟正向播完（lottie 停在端点前一帧）
    anim.currentRawFrame = 24.999;

    // 关：24.999 → 0 倒放（方向由 playSegments 内部处理）
    view.rerender(<LottieThinkingIcon active={false} />);
    expect(anim.playSegments).toHaveBeenLastCalledWith([24.999, 0], true);

    // 切换过程未重建、未销毁
    expect(lottieMock.loadAnimation).toHaveBeenCalledTimes(1);
    expect(anim.destroy).not.toHaveBeenCalled();

    view.unmount();
    expect(anim.destroy).toHaveBeenCalledTimes(1);
  });

  it('状态未变化时不重复播放', () => {
    const anim = createAnimation();
    lottieMock.loadAnimation.mockReturnValue(anim);

    const view = render(<LottieThinkingIcon active={false} />);
    view.rerender(<LottieThinkingIcon active={false} />);

    expect(anim.playSegments).not.toHaveBeenCalled();
  });
});

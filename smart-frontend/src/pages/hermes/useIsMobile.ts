import { useEffect, useState } from 'react';

/**
 * 移动端视口判定：<768px（与 antd md 断点互补，ProLayout 在该区间
 * 将侧栏渲染为抽屉，项目其他页面（shuban 等）同样以 768 为分界）。
 * 用 matchMedia + change 监听，跨断点时自动更新。
 */
const QUERY = '(max-width: 767.98px)';

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    list.addEventListener('change', onChange);
    // 挂载期间查询结果可能已变化（SSR 水合/热更新），同步一次。
    setIsMobile(list.matches);
    return () => list.removeEventListener('change', onChange);
  }, []);

  return isMobile;
};

export default useIsMobile;

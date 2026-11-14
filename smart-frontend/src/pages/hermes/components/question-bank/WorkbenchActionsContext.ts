import { createContext, type ReactNode } from 'react';

export const WorkbenchActionsContext = createContext<{
  navigation: ReactNode;
  close: ReactNode;
  /** 侧栏是否处于隐藏态（隐藏时聊天视图需在菜单栏外展示展开入口）。 */
  navHidden: boolean;
  /** 是否移动端视口（<768px，侧栏以 ProLayout 抽屉形态呈现）。 */
  isMobile: boolean;
  /** 切换侧栏显隐；传 open 时显式设定目标态（移动端选会话后收起抽屉用）。 */
  toggleNavigation: (open?: boolean) => void;
}>({
  navigation: null,
  close: null,
  navHidden: false,
  isMobile: false,
  toggleNavigation: () => {},
});

import { createContext, type ReactNode } from 'react';

export const WorkbenchActionsContext = createContext<{
  navigation: ReactNode;
  close: ReactNode;
  /** 侧栏是否处于隐藏态（隐藏时聊天视图需在菜单栏外展示展开入口）。 */
  navHidden: boolean;
}>({ navigation: null, close: null, navHidden: false });

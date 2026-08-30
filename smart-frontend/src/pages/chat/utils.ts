// src/pages/chat/utils.ts
// XMarkdown 明暗主题 className（跟随 antd 主题）
import { theme } from 'antd';
import React from 'react';

export const useMarkdownTheme = () => {
  const token = theme.useToken();

  // antd 默认主题 id 为 0（亮色），暗色算法下 id 变化
  const isLightMode = React.useMemo(() => {
    return token?.theme?.id === 0;
  }, [token]);

  const className = React.useMemo(() => {
    return isLightMode ? 'x-markdown-light' : 'x-markdown-dark';
  }, [isLightMode]);

  return [className] as const;
};

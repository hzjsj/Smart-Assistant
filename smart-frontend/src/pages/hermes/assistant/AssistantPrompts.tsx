import { Prompts } from '@ant-design/x';
import { createStyles } from 'antd-style';
import React from 'react';
import type { AssistantPreset } from './types';

const useStyles = createStyles(({ css }) => ({
  root: css`
    width: 100%;
    max-width: var(--hermes-composer-column);
    margin-bottom: 8px;
    flex-shrink: 0;
    /* 单行横向滚动：宽度不够时左右滑动，滚动条隐藏。 */
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;

    &::-webkit-scrollbar {
      display: none;
    }

    .ant-prompts-list {
      justify-content: flex-start;
      flex-wrap: nowrap;
      width: max-content;
      min-width: 100%;
    }
  `,
}));

/**
 * 助手快捷指令行：展示 preset.prompts 的按钮组。
 * 点击只回传指令 key，由调用方填充插槽模板（不直接发送）。
 */
const AssistantPrompts: React.FC<{
  preset: AssistantPreset;
  onSelect: (itemKey: string) => void;
}> = ({ preset, onSelect }) => {
  const { styles } = useStyles();
  if (preset.prompts.length === 0) return null;

  return (
    <Prompts
      className={styles.root}
      items={preset.prompts.map(({ key, label, icon }) => ({
        key,
        label,
        icon,
      }))}
      onItemClick={({ data }) => onSelect(String(data.key))}
      styles={{ item: { padding: '6px 12px' } }}
    />
  );
};

export default AssistantPrompts;

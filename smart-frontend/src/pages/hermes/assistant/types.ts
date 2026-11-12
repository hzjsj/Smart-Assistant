import type { SlotConfigType } from '@ant-design/x/es/sender/interface';
import type { ReactNode } from 'react';

/**
 * 欢迎消息内示例链接的私有前缀（fragment 形式，避免被 Markdown 的 URL
 * 过滤影响，也不触发新标签页）：`#hermes-prompt=<promptKey>/<exampleKey>`。
 */
export const PROMPT_LINK_PREFIX = '#hermes-prompt=';

/** 指令下的示例：点击欢迎消息中的示例链接后预填该示例内容。 */
export interface AssistantPromptExample {
  key: string;
  /** 示例名（如「北京的秋天」），用于欢迎语链接文字。 */
  label: string;
  /** 示例插槽模板（题目/正文可带 defaultValue 预填）。 */
  slots: SlotConfigType[];
}

/** 助手快捷指令：点击后把 slots 模板填入输入框（text 说明 + content 留空）。 */
export interface AssistantPromptItem {
  key: string;
  /** 指令按钮文案。 */
  label: string;
  icon?: ReactNode;
  /** 插入输入框的插槽模板（模块级稳定常量，引用变化会重建插槽）。 */
  slots: SlotConfigType[];
  /** 示例列表：欢迎消息内渲染为可点击链接，点击预填示例内容。 */
  examples?: AssistantPromptExample[];
}

/**
 * 快捷助手配置：不同助手仅需不同的 preset（标题/欢迎语/指令列表），
 * index.tsx 通过数组 map 生成侧栏入口，新增助手无需改动页面代码。
 */
export interface AssistantPreset {
  /** 稳定标识，用于会话标记（如 'essay'）。 */
  key: string;
  /** 侧栏入口名 + 新建会话标题。 */
  title: string;
  icon: ReactNode;
  /** 欢迎消息的加粗标题（如「你好，我是你的语文作文助手」）。 */
  welcomeTitle?: string;
  /** 欢迎消息正文（示例行由 prompts[].examples 自动生成，无需手写）。 */
  welcome: string;
  prompts: AssistantPromptItem[];
}

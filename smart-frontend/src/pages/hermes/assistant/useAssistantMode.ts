import type { SlotConfigType } from '@ant-design/x/es/sender/interface';
import type { MessageInfo } from '@ant-design/x-sdk';
import type { MessageInstance } from 'antd/es/message/interface';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConversationItem, HermesMessage } from '../data';
import { type AssistantPreset, PROMPT_LINK_PREFIX } from './types';

/**
 * 生成欢迎消息 Markdown：加粗标题 + 正文 + 示例链接行。
 * 示例行由 prompts[].examples 自动生成，新增示例只需改数据。
 */
export function buildWelcomeContent(preset: AssistantPreset): string {
  const lines: string[] = [];
  if (preset.welcomeTitle) lines.push(`**${preset.welcomeTitle}**`);
  if (preset.welcome) lines.push(preset.welcome);
  for (const prompt of preset.prompts) {
    if (!prompt.examples?.length) continue;
    const links = prompt.examples
      .map(
        (example) =>
          `[${example.label}](${PROMPT_LINK_PREFIX}${prompt.key}/${example.key})`,
      )
      .join(' ');
    lines.push(`${prompt.label}示例：${links}`);
  }
  return lines.join('\n\n');
}

export interface UseAssistantModeOptions {
  presets: AssistantPreset[];
  activeConversationKey: string;
  messages: MessageInfo<HermesMessage>[];
  model: string;
  createConversation: (
    title?: string,
    model?: string,
  ) => Promise<{ id: string; title: string }>;
  addConversation: (
    conversation: ConversationItem,
    position?: 'prepend',
  ) => void;
  setActiveConversationKey: (key: string) => void;
  /** 会话改名（复用空会话时把标题设为助手名，刷新后可按标题识别）。 */
  renameConversation: (key: string, title: string) => Promise<void>;
  /** 本地更新侧栏会话标题。 */
  setConversationLabel: (key: string, label: string) => void;
  messageApi: MessageInstance;
  /** 当前会话历史成功加载并恢复后为 true。 */
  ready: boolean;
}

/**
 * 快捷助手模式：会话归属标记、空会话欢迎内容、插槽模板状态。
 *
 * - 点入口：当前会话为空则复用，否则新建「助手标题」会话并激活；
 * - 欢迎语仅用于展示，不进入聊天消息或模型上下文；
 * - 插槽模板交给 Sender 的 slotConfig，发送后清空。
 */
export function useAssistantMode({
  presets,
  activeConversationKey,
  messages,
  model,
  createConversation,
  addConversation,
  setActiveConversationKey,
  renameConversation,
  setConversationLabel,
  messageApi,
  ready,
}: UseAssistantModeOptions) {
  // conversationKey -> presetKey（会话归属；刷新后由列表标题回填）
  const [conversationPresets, setConversationPresets] = useState<
    Map<string, string>
  >(new Map());
  // 当前输入框插槽模板（undefined 表示普通文本输入）
  const [slotConfig, setSlotConfig] = useState<SlotConfigType[] | undefined>();

  const presetMap = useMemo(
    () => new Map(presets.map((preset) => [preset.key, preset])),
    [presets],
  );
  const activePresetKey = conversationPresets.get(activeConversationKey);
  const activePreset = activePresetKey
    ? presetMap.get(activePresetKey)
    : undefined;

  const selectPreset = useCallback(
    (conversationKey: string, presetKey: string) => {
      setConversationPresets((previous) => {
        const next = new Map(previous);
        next.set(conversationKey, presetKey);
        return next;
      });
    },
    [],
  );

  // 会话列表加载后：按标题匹配 preset，恢复助手会话标记（刷新后仍显示指令行）。
  const registerConversations = useCallback(
    (records: readonly { id: string; title: string }[]) => {
      setConversationPresets((previous) => {
        const next = new Map(previous);
        for (const record of records) {
          const matched = presets.find(
            (preset) => preset.title === record.title,
          );
          if (matched) next.set(record.id, matched.key);
        }
        return next;
      });
    },
    [presets],
  );

  const forgetConversation = useCallback((conversationKey: string) => {
    setConversationPresets((previous) => {
      if (!previous.has(conversationKey)) return previous;
      const next = new Map(previous);
      next.delete(conversationKey);
      return next;
    });
  }, []);

  /** 点侧栏入口：同一助手的空会话保留，有真实消息则新建。 */
  const open = useCallback(
    async (preset: AssistantPreset, isCurrent: () => boolean = () => true) => {
      // 空会话保留草稿/插槽；历史尚未就绪时不把当前助手误判成新会话。
      if (
        activePreset?.key === preset.key &&
        (!ready || messages.length === 0)
      ) {
        return;
      }
      setSlotConfig(undefined);
      if (ready && messages.length === 0) {
        selectPreset(activeConversationKey, preset.key);
        // 复用空会话：标题改为助手名，保证刷新后按标题重新识别归属。
        setConversationLabel(activeConversationKey, preset.title);
        void renameConversation(activeConversationKey, preset.title).catch(
          () => undefined,
        );
        return;
      }
      try {
        const record = await createConversation(preset.title, model);
        addConversation(
          { key: record.id, label: record.title, group: '今天' },
          'prepend',
        );
        selectPreset(record.id, preset.key);
        // 会话仍保留在列表中，但用户已切去别处时不抢回焦点。
        if (isCurrent()) setActiveConversationKey(record.id);
      } catch {
        if (isCurrent()) {
          messageApi.error(`创建${preset.title}会话失败，请稍后重试`);
        }
      }
    },
    [
      activeConversationKey,
      activePreset,
      addConversation,
      createConversation,
      messageApi,
      messages.length,
      model,
      renameConversation,
      ready,
      selectPreset,
      setActiveConversationKey,
      setConversationLabel,
    ],
  );

  /**
   * 点击快捷指令或示例：`promptKey` 用指令空白模板，
   * `promptKey/exampleKey` 用示例的预填模板。
   */
  const selectPrompt = useCallback(
    (selectionKey: string) => {
      const [itemKey, exampleKey] = selectionKey.split('/');
      const item = activePreset?.prompts.find(
        (prompt) => prompt.key === itemKey,
      );
      if (!item) return;
      if (exampleKey) {
        const example = item.examples?.find(
          (current) => current.key === exampleKey,
        );
        if (example) setSlotConfig(example.slots);
        return;
      }
      setSlotConfig(item.slots);
    },
    [activePreset],
  );

  const resetSlots = useCallback(() => setSlotConfig(undefined), []);

  const isPresetActive = useCallback(
    (preset: AssistantPreset) => activePresetKey === preset.key,
    [activePresetKey],
  );

  // 切换会话时清空插槽（避免把上一个会话的模板带入新会话）。
  useEffect(() => {
    setSlotConfig(undefined);
  }, [activeConversationKey]);

  return {
    /** 当前会话所属助手（无则不渲染指令行、Sender 走普通文本模式）。 */
    activePreset,
    /** 只有确认无历史的空会话才显示；不写入 useXChat 消息。 */
    welcomeContent:
      ready && messages.length === 0 && activePreset
        ? buildWelcomeContent(activePreset)
        : undefined,
    /** 当前输入框插槽模板；非空时 Sender 进入插槽模式。 */
    slotConfig,
    /** 打开展示该助手的入口（空会话复用 / 否则新建）。 */
    open,
    /** 点击快捷指令，填充插槽模板。 */
    selectPrompt,
    /** 清空插槽（发送后 / 关闭附件时）。 */
    resetSlots,
    /** 侧栏入口高亮判断。 */
    isPresetActive,
    /** 会话列表加载后回填助手会话标记（按标题匹配）。 */
    registerConversations,
    /** 删除会话时清理标记。 */
    forgetConversation,
  };
}

// src/pages/chat/style.ts
// 全屏独立聊天页布局样式（对照 Ant Design X 官方 Independent demo）
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ token, css }) => {
  return {
    layout: css`
      width: 100%;
      min-height: 100vh;
      display: flex;
      background: ${token.colorBgContainer};
      font-family: AlibabaPuHuiTi, ${token.fontFamily}, sans-serif;
    `,
    // 侧栏（吸顶，独立滚动）
    side: css`
      background: ${token.colorBgLayout}80;
      width: 280px;
      flex-shrink: 0;
      height: 100vh;
      position: sticky;
      top: 0;
      display: flex;
      flex-direction: column;
      padding: 0 12px;
      box-sizing: border-box;
    `,
    logo: css`
      display: flex;
      align-items: center;
      justify-content: start;
      padding: 0 24px;
      box-sizing: border-box;
      gap: 8px;
      margin: 24px 0;

      span {
        font-weight: bold;
        color: ${token.colorText};
        font-size: 16px;
      }
    `,
    conversations: css`
      overflow-y: auto;
      margin-top: 12px;
      padding: 0;
      flex: 1;
      .ant-conversations-list {
        padding-inline-start: 0;
      }
    `,
    sideFooter: css`
      border-top: 1px solid ${token.colorBorderSecondary};
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 8px;
    `,
    // 聊天区（页面级滚动，消息区不再内部滚动）
    chat: css`
      flex: 1;
      min-width: 0;
      min-height: 100vh;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    `,
    chatList: css`
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      /* 对齐 hermes：消息列宽 952 + 水平留白 38 */
      padding: 16px 38px 24px;
      box-sizing: border-box;
      /* 去掉 Bubble.List 自带的 8px 内边距，使气泡与输入框左右边界一致 */
      .ant-bubble-list-scroll-content {
        padding-inline: 0;
      }
    `,
    // 发送区吸底，页面滚动时保持可见
    senderBar: css`
      position: sticky;
      bottom: 0;
      z-index: 10;
      width: 100%;
      padding: 8px 38px 16px;
      box-sizing: border-box;
      background: ${token.colorBgContainer};
      &::before {
        content: '';
        position: absolute;
        inset-inline: 0;
        top: -24px;
        height: 24px;
        background: linear-gradient(180deg, transparent, ${token.colorBgContainer});
        pointer-events: none;
      }
    `,
    // 空态欢迎区（与消息列/输入框同宽 952），在消息区内上下居中
    welcomePanel: css`
      width: 100%;
      max-width: 952px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      margin-block: auto;
    `,
    topicGroups: css`
      display: flex;
      flex-direction: column;
      gap: 24px;
      width: 100%;
    `,
    topicGroupLabel: css`
      font-size: 13px;
      font-weight: 500;
      color: ${token.colorTextTertiary};
      margin-bottom: 10px;
    `,
    topicCards: css`
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;

      @media (max-width: 640px) {
        grid-template-columns: minmax(0, 1fr);
      }
    `,
    topicCard: css`
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      width: 100%;
      padding: 14px 16px;
      border: 1px solid ${token.colorBorderSecondary};
      border-radius: ${token.borderRadiusLG}px;
      background: linear-gradient(123deg, #f3f8ff 0%, #f7f3ff 100%);
      cursor: pointer;
      text-align: start;
      font: inherit;
      transition:
        border-color ${token.motionDurationMid} ease,
        box-shadow ${token.motionDurationMid} ease;

      &:hover {
        border-color: ${token.colorPrimaryBorder};
        box-shadow: ${token.boxShadowTertiary};
      }
    `,
    topicCardTitle: css`
      font-size: 14px;
      font-weight: 600;
      line-height: 22px;
      color: ${token.colorText};
    `,
    topicCardDesc: css`
      display: -webkit-box;
      overflow: hidden;
      font-size: 12px;
      line-height: 20px;
      color: ${token.colorTextSecondary};
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    `,
    // 发送区（与消息列同宽 952，保证输入框和对话框左右对齐）
    sender: css`
      width: 100%;
      max-width: 952px;
    `,
    // 快捷指令横向滚动容器（参考 hermes 附件条）：外层滚动以显示 6px 细滚动条
    senderPromptScroll: css`
      width: 100%;
      max-width: 952px;
      margin: 0 auto;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      padding-bottom: 2px;

      /* Prompts 根节点占满宽度；列表按内容宽度排布并自动居中（溢出时不裁左侧） */
      > .ant-prompts {
        width: 100%;
      }

      .ant-prompts-list {
        width: max-content;
        margin-inline: auto;
        flex-wrap: nowrap;
        overflow: visible;
      }

      &::-webkit-scrollbar {
        height: 6px;
      }

      &::-webkit-scrollbar-track {
        background: transparent;
      }

      &::-webkit-scrollbar-thumb {
        border-radius: 3px;
        background: ${token.colorFill};
      }
    `,
    senderPrompt: css`
      width: 100%;
      color: ${token.colorText};
    `,
  };
});

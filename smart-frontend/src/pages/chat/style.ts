// src/pages/chat/style.ts
// 全屏独立聊天页布局样式（对照 Ant Design X 官方 Independent demo）
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ token, css }) => {
  return {
    layout: css`
      width: 100%;
      height: 100vh;
      display: flex;
      background: ${token.colorBgContainer};
      font-family: AlibabaPuHuiTi, ${token.fontFamily}, sans-serif;
    `,
    // 侧栏
    side: css`
      background: ${token.colorBgLayout}80;
      width: 280px;
      height: 100%;
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
    // 聊天区
    chat: css`
      height: 100%;
      width: calc(100% - 280px);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      .ant-bubble-content-updating {
        background-image: linear-gradient(90deg, #ff6b23 0%, #af3cb8 31%, #53b6ff 89%);
        background-size: 100% 2px;
        background-repeat: no-repeat;
        background-position: bottom;
      }
    `,
    chatList: css`
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    `,
    placeholder: css`
      width: 100%;
      padding: ${token.paddingLG}px;
      box-sizing: border-box;
    `,
    // 发送区
    sender: css`
      width: 100%;
      max-width: 840px;
    `,
    senderPrompt: css`
      width: 100%;
      max-width: 840px;
      margin: 0 auto;
      color: ${token.colorText};
    `,
  };
});

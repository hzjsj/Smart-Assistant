// src/components/ChatSkeleton/index.tsx
// 对话页骨架屏（对齐 antd Skeleton）：消息区左右交替气泡 + 会话列表文本条
import { Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import React from 'react';

const useStyles = createStyles(({ token, css }) => ({
  messages: css`
    display: flex;
    flex-direction: column;
    gap: ${token.marginLG}px;
    width: 100%;
    max-width: 952px;
    padding: ${token.paddingLG}px 0;
  `,
  messageRow: css`
    display: flex;
    align-items: flex-start;
    gap: ${token.margin}px;
    width: 100%;
  `,
  messageRowEnd: css`
    justify-content: flex-end;
  `,
  messageBlock: css`
    flex: 1;
    min-width: 0;
    max-width: 78%;
  `,
  messageBlockEnd: css`
    max-width: 60%;
  `,
  conversations: css`
    display: flex;
    flex-direction: column;
    gap: ${token.marginSM}px;
    padding: 4px 8px;
  `,
}));

/** 消息骨架行（固定 key，避免下标 key） */
const MESSAGE_ROWS = [
  { key: 'skeleton-message-1', isUser: false },
  { key: 'skeleton-message-2', isUser: true },
  { key: 'skeleton-message-3', isUser: false },
  { key: 'skeleton-message-4', isUser: true },
];

/** 会话列表骨架行 */
const CONVERSATION_ROWS = [
  { key: 'skeleton-conversation-1', width: '82%' },
  { key: 'skeleton-conversation-2', width: '64%' },
  { key: 'skeleton-conversation-3', width: '74%' },
  { key: 'skeleton-conversation-4', width: '56%' },
  { key: 'skeleton-conversation-5', width: '70%' },
  { key: 'skeleton-conversation-6', width: '48%' },
];

/** 消息区骨架屏：模拟左右交替的对话气泡 */
export const MessageSkeleton: React.FC<{ rows?: number }> = ({
  rows = MESSAGE_ROWS.length,
}) => {
  const { styles } = useStyles();
  return (
    <div className={styles.messages} aria-hidden="true">
      {MESSAGE_ROWS.slice(0, rows).map(({ key, isUser }) => (
        <div
          key={key}
          className={`${styles.messageRow} ${isUser ? styles.messageRowEnd : ''}`}
        >
          {!isUser && <Skeleton.Avatar active size={32} shape="circle" />}
          <div
            className={`${styles.messageBlock} ${isUser ? styles.messageBlockEnd : ''}`}
          >
            <Skeleton
              active
              title={false}
              paragraph={{
                rows: isUser ? 1 : 2,
                width: isUser ? ['92%'] : ['100%', '68%'],
              }}
            />
          </div>
          {isUser && <Skeleton.Avatar active size={32} shape="circle" />}
        </div>
      ))}
    </div>
  );
};

/** 会话列表骨架屏：模拟侧栏会话项 */
export const ConversationSkeleton: React.FC<{ rows?: number }> = ({
  rows = CONVERSATION_ROWS.length,
}) => {
  const { styles } = useStyles();
  return (
    <div className={styles.conversations} aria-hidden="true">
      {CONVERSATION_ROWS.slice(0, rows).map(({ key, width }) => (
        <Skeleton
          key={key}
          active
          title={false}
          paragraph={{ rows: 1, width: [width] }}
        />
      ))}
    </div>
  );
};

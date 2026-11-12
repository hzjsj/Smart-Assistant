import XMarkdown from '@ant-design/x-markdown';
import { message as antMessage, Space, Typography } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PROMPT_LINK_PREFIX } from '../assistant/types';
import {
  collectMessageAttachments,
  downloadMessageAttachment,
  getMessageAttachment,
  type MessageAttachment,
} from '../attachments';
import type { ApprovalActivity, HermesMessage } from '../data';
import { markdownConfig } from '../markdown';
import type { QuestionBankCardData } from '../question-bank/types';
import { useStyles } from '../style';
import ApprovalRequest from './ApprovalRequest';
import MessageAttachments from './MessageAttachments';
import ProcessTrace from './process/ProcessTrace';
import { QuestionBankCards } from './question-bank/QuestionBankCard';

const defaultStyleOverrides = ['p', 'ul', 'ol', 'li', 'pre', 'hr'] as const;

const AnswerContent = React.memo<{
  content: string;
  streamActive: boolean;
}>(({ content, streamActive }) => {
  const streaming = useMemo(
    () => ({ hasNextChunk: streamActive, enableAnimation: false, tail: false }),
    [streamActive],
  );

  return (
    <XMarkdown
      streaming={streaming}
      config={markdownConfig}
      disableDefaultStyles={[...defaultStyleOverrides]}
      openLinksInNewTab
      content={content}
    />
  );
});

export type AssistantMessageView = HermesMessage & { requestStatus?: string };

const AssistantMessage: React.FC<{
  message: HermesMessage;
  status?: string;
  requestStatus?: string;
  onApprovalUpdate: (activity: ApprovalActivity) => void;
  onOpenQuestionBank: (card: QuestionBankCardData) => void;
  /** 点击欢迎消息内的示例链接：填入对应插槽模板。 */
  onSelectExample?: (selectionKey: string) => void;
}> = ({
  message,
  status,
  requestStatus,
  onApprovalUpdate,
  onOpenQuestionBank,
  onSelectExample,
}) => {
  const { styles } = useStyles();
  const activities = message.activities || [];
  const answerRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [messageApi, contextHolder] = antMessage.useMessage();
  const downloading = useRef(new Set<string>());
  const notices: React.ReactNode[] = [];
  for (const activity of activities) {
    if (activity.type === 'approval') {
      notices.push(
        <ApprovalRequest
          key={activity.key}
          activity={activity}
          onUpdate={onApprovalUpdate}
        />,
      );
    } else if (
      activity.type === 'status' &&
      ['error', 'warning'].includes(activity.kind)
    ) {
      notices.push(
        <div
          key={activity.key}
          className={styles.statusLine}
          role={activity.kind === 'error' ? 'alert' : 'status'}
        >
          <Typography.Text
            type={activity.kind === 'error' ? 'danger' : 'warning'}
          >
            {activity.text}
          </Typography.Text>
        </div>,
      );
    } else if (activity.type === 'tool' && activity.status === 'error') {
      notices.push(
        <div
          key={`failure:${activity.key}`}
          className={styles.statusLine}
          role="alert"
        >
          <Typography.Text type="danger">
            工具“{activity.label || activity.tool}”执行失败
            {activity.progressMessage ? `：${activity.progressMessage}` : ''}
          </Typography.Text>
        </div>,
      );
    }
  }
  const hasProcess = activities.some(
    (activity) =>
      activity.type === 'tool' ||
      activity.type === 'reasoning' ||
      (activity.type === 'status' &&
        !['error', 'warning'].includes(activity.kind)),
  );
  const requestActive = status === 'loading' || status === 'updating';
  const handleLinkClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    const link =
      event.target instanceof Element ? event.target.closest('a') : null;
    if (!link) return;
    const href = link.getAttribute('href') || '';
    // 欢迎消息内的示例链接（#hermes-prompt=promptKey/exampleKey）：
    // 拦截跳转，交给业务回调填入对应插槽模板。
    if (href.startsWith(PROMPT_LINK_PREFIX)) {
      event.preventDefault();
      event.stopPropagation();
      onSelectExample?.(
        decodeURIComponent(href.slice(PROMPT_LINK_PREFIX.length)),
      );
      return;
    }
    const file = getMessageAttachment(href, link.textContent || '');
    if (!file) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (requestActive) {
      messageApi.info('请等待回复完成后下载文件');
      return;
    }
    if (downloading.current.has(file.url)) return;
    downloading.current.add(file.url);
    void downloadMessageAttachment(file)
      .catch(() => {
        messageApi.error('下载失败，请检查文件地址后重试');
      })
      .finally(() => downloading.current.delete(file.url));
  };
  const streamActive = status === 'updating' && message.contentActive;
  const hasContent = Boolean(message.content);
  useEffect(() => {
    if (requestActive) {
      setAttachments([]);
      return;
    }
    const root = answerRef.current;
    if (!root) return;
    const update = () => setAttachments(collectMessageAttachments(root));
    update();
    // XMarkdown flushes its final parsed output in a child effect. Observe that
    // update as well, without parsing incomplete signed URLs during streaming.
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [requestActive, hasContent]);
  if (
    !hasProcess &&
    notices.length === 0 &&
    !message.content &&
    !message.questionBankPending &&
    !message.questionBanks?.length &&
    !message.questionBankErrors?.length &&
    requestActive
  ) {
    return undefined;
  }

  return (
    <>
      {contextHolder}
      <Space
        orientation="vertical"
        size={16}
        className={styles.assistantContent}
      >
        <ProcessTrace
          message={message}
          requestStatus={requestStatus ?? status}
        />
        {notices}
        {message.content && (
          <div
            ref={answerRef}
            className={styles.answer}
            onClickCapture={handleLinkClick}
            onAuxClickCapture={handleLinkClick}
          >
            <AnswerContent
              streamActive={Boolean(streamActive)}
              content={message.content}
            />
          </div>
        )}
        {!requestActive && <MessageAttachments files={attachments} />}
        {message.questionBankPending ||
        message.questionBanks?.length ||
        message.questionBankErrors?.length ? (
          <QuestionBankCards
            cards={message.questionBanks || []}
            pending={requestActive || message.questionBankPending}
            errors={message.questionBankErrors}
            onOpen={onOpenQuestionBank}
          />
        ) : null}
      </Space>
    </>
  );
};

export default AssistantMessage;

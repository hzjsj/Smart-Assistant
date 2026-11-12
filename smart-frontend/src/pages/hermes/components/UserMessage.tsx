import { CopyOutlined, MoreOutlined } from '@ant-design/icons';
import { FileCard } from '@ant-design/x';
import { Button, Dropdown, Image, message } from 'antd';
import React, { useMemo, useState } from 'react';
import type { ChatAttachmentParam } from '../request';
import { useStyles } from '../style';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

const attachmentName = (attachment: ChatAttachmentParam) =>
  attachment.name || attachment.url.split('/').pop() || '附件';

const isImageAttachment = (attachment: ChatAttachmentParam) => {
  const name = attachmentName(attachment);
  const index = name.lastIndexOf('.');
  const ext = index < 0 ? '' : name.slice(index).toLowerCase();
  return IMAGE_EXTS.includes(ext);
};

const UserMessage: React.FC<{
  content: string;
  attachments?: ChatAttachmentParam[];
  onUsePrompt: (content: string) => void;
}> = ({ content, attachments, onUsePrompt }) => {
  const { styles } = useStyles();
  const [menuOpen, setMenuOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const imageAttachments = useMemo(
    () => (attachments ?? []).filter(isImageAttachment),
    [attachments],
  );
  const fileAttachments = useMemo(
    () => (attachments ?? []).filter((item) => !isImageAttachment(item)),
    [attachments],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      messageApi.success('已复制原文');
    } catch {
      messageApi.error('复制失败，请选中文字后复制');
    }
  };

  return (
    <div className={styles.userRow}>
      {contextHolder}
      <div className={styles.userBubble}>
        <div className={styles.userText} data-user-message-text>
          {content}
        </div>
        {imageAttachments.length ? (
          <div className={styles.userAttachmentImages} data-user-attachments>
            <Image.PreviewGroup>
              {imageAttachments.map((attachment) => (
                <Image
                  key={attachment.url}
                  src={attachment.url}
                  alt={attachmentName(attachment)}
                  width={96}
                  height={96}
                  style={{ objectFit: 'cover', borderRadius: 8 }}
                />
              ))}
            </Image.PreviewGroup>
          </div>
        ) : null}
        {fileAttachments.length ? (
          <div className={styles.attachments} data-user-attachments>
            {fileAttachments.map((attachment) => (
              <FileCard
                key={attachment.url}
                name={attachmentName(attachment)}
                type="file"
              />
            ))}
          </div>
        ) : null}
      </div>
      <div
        className={styles.userActions}
        data-user-actions
        data-menu-open={menuOpen}
      >
        <Button
          type="text"
          icon={<CopyOutlined />}
          aria-label="复制用户消息"
          onClick={() => void copy()}
        />
        <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={['click']}
          menu={{
            items: [{ key: 'reuse', label: '放入输入框' }],
            onClick: () => {
              onUsePrompt(content);
              setMenuOpen(false);
            },
          }}
        >
          <Button
            type="text"
            icon={<MoreOutlined />}
            aria-label="更多用户消息操作"
          />
        </Dropdown>
      </div>
    </div>
  );
};

export default UserMessage;

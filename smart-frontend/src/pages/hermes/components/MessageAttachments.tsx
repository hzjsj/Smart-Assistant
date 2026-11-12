import { DownloadOutlined } from '@ant-design/icons';
import { FileCard } from '@ant-design/x';
import { Button, message } from 'antd';
import React, { useState } from 'react';
import {
  downloadMessageAttachment,
  type MessageAttachment,
} from '../attachments';
import { useStyles } from '../style';

const AttachmentCard: React.FC<{ file: MessageAttachment }> = ({ file }) => {
  const { styles } = useStyles();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const download = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await downloadMessageAttachment(file);
      setFailed(false);
    } catch {
      setFailed(true);
      messageApi.error('下载失败，请检查文件地址后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {contextHolder}
      <FileCard
        name={file.name}
        src={file.url}
        type="file"
        icon={file.icon}
        className={styles.attachmentCard}
        onClick={() => void download()}
        description={
          <div className={styles.attachmentDescription}>
            <span>{file.label}</span>
            <Button
              type="text"
              size="small"
              loading={loading}
              icon={<DownloadOutlined />}
              aria-label={`${failed ? '重试下载' : '下载'} ${file.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void download();
              }}
            >
              {failed ? '重试下载' : '下载'}
            </Button>
          </div>
        }
      />
    </>
  );
};

const MessageAttachments: React.FC<{ files: MessageAttachment[] }> = ({
  files,
}) => {
  const { styles } = useStyles();
  if (files.length === 0) return null;
  return (
    <section className={styles.attachments} aria-label="附件下载">
      {files.map((file) => (
        <AttachmentCard key={file.url} file={file} />
      ))}
    </section>
  );
};

export default MessageAttachments;

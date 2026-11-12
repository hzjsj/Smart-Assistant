import { CloudUploadOutlined } from '@ant-design/icons';
import { Attachments, type AttachmentsProps, Sender } from '@ant-design/x';
import { type GetProp, message, Upload, type UploadProps } from 'antd';
import React from 'react';
import {
  type ChatAttachmentDraft,
  DEEPSEEK_IMAGE_EXTS,
  deleteAttachment,
  uploadAttachment,
} from '../attachmentService';

type AttachmentItem = GetProp<AttachmentsProps, 'items'>[number];
type CustomRequestOption = Parameters<
  NonNullable<UploadProps['customRequest']>
>[0];

/** 与后端 mineru/attachment_service.ALLOWED_EXTS 保持一致。 */
const ALLOWED_EXTS = [
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.txt',
  '.md',
];
const MAX_SIZE = 50 * 1024 * 1024;

const fileExt = (name: string) => {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
};

interface ChatAttachmentsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前会话的附件草稿（受控，状态保存在页面级以便按会话隔离）。 */
  items: ChatAttachmentDraft[];
  onItemsChange: (
    updater: (prev: ChatAttachmentDraft[]) => ChatAttachmentDraft[],
  ) => void;
  getDropContainer: AttachmentsProps['getDropContainer'];
  /** DeepSeek 模式仅支持图片附件（图像理解），其余格式一律拦截。 */
  imageOnly?: boolean;
}

/**
 * 聊天输入区的附件上传面板：Sender.Header + Attachments，
 * 通过 customRequest 直传 mineru 附件接口，上传完成卡片即“可随消息发送”。
 */
const ChatAttachments: React.FC<ChatAttachmentsProps> = ({
  open,
  onOpenChange,
  items,
  onItemsChange,
  getDropContainer,
  imageOnly = false,
}) => {
  const [messageApi, contextHolder] = message.useMessage();

  const patchDraft = (uid: string, patch: Partial<ChatAttachmentDraft>) => {
    onItemsChange((prev) =>
      prev.map((item) => (item.uid === uid ? { ...item, ...patch } : item)),
    );
  };

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    const ext = fileExt(file.name);
    if (imageOnly) {
      if (!DEEPSEEK_IMAGE_EXTS.includes(ext)) {
        messageApi.error(
          `DeepSeek 仅支持图片解析：${ext || '未知'} 不受支持（PNG/JPG/GIF/WebP）`,
        );
        return Upload.LIST_IGNORE;
      }
    } else if (!ALLOWED_EXTS.includes(ext)) {
      messageApi.error(
        `不支持的附件类型：${ext || '未知'}（支持 pdf/word/ppt/excel/图片/txt/md）`,
      );
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_SIZE) {
      messageApi.error('附件大小不能超过 50MB');
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const customRequest = (options: CustomRequestOption) => {
    const { file, onSuccess, onError } = options;
    const uid = (file as { uid?: string }).uid ?? '';
    void (async () => {
      try {
        const uploaded = await uploadAttachment(file as File, (percent) => {
          patchDraft(uid, { percent });
        });
        patchDraft(uid, {
          status: 'done',
          url: uploaded.url,
          id: uploaded.id,
          percent: undefined,
        });
        onSuccess?.(uploaded);
      } catch (error) {
        const detail =
          error instanceof Error && error.message
            ? error.message
            : '附件上传失败，请稍后重试';
        patchDraft(uid, { status: 'error', error: detail, percent: undefined });
        onError?.(new Error(detail));
        messageApi.error(detail);
      }
    })();
  };

  const handleChange: AttachmentsProps['onChange'] = ({ file }) => {
    // 只负责登记新选择的文件；上传中/完成/失败状态由 customRequest 回写。
    if (file.status !== 'uploading') return;
    onItemsChange((prev) => {
      if (prev.some((item) => item.uid === file.uid)) return prev;
      return [
        ...prev,
        {
          uid: file.uid,
          name: file.name,
          size: file.size ?? 0,
          status: 'uploading',
          // 保留原始文件供上传中生成本地预览缩略图。
          file: (file.originFileObj as File) ?? (file as unknown as File),
        },
      ];
    });
  };

  const handleRemove = (item: AttachmentItem) => {
    const draft = items.find((candidate) => candidate.uid === item.uid);
    if (draft?.id) {
      // 已上传的附件同步清理服务端记录；失败不阻断界面移除。
      void deleteAttachment(draft.id).catch(() => undefined);
    }
    onItemsChange((prev) =>
      prev.filter((candidate) => candidate.uid !== item.uid),
    );
    return true;
  };

  const attachmentItems: AttachmentItem[] = items.map((draft) => ({
    uid: draft.uid,
    name: draft.name,
    size: draft.size,
    status: draft.status,
    url: draft.url,
    response: draft.error,
    // 传入原始文件与进度：上传中由 X 生成本地预览并叠加进度遮罩。
    // antd 的 originFileObj 类型是 RcFile；本地生成的 File 仅供预览读取，直接断言。
    originFileObj: draft.file as AttachmentItem['originFileObj'],
    percent: draft.percent,
  }));

  return (
    <Sender.Header
      title="附件"
      open={open}
      onOpenChange={onOpenChange}
      styles={{ content: { padding: 0 } }}
    >
      {contextHolder}
      <Attachments
        items={attachmentItems}
        multiple
        beforeUpload={beforeUpload}
        customRequest={customRequest}
        onChange={handleChange}
        onRemove={handleRemove}
        placeholder={(type) =>
          type === 'drop'
            ? { title: '松开即可上传附件' }
            : {
                icon: <CloudUploadOutlined />,
                title: '上传附件',
                description: imageOnly
                  ? '点击或拖入图片，随消息一并发送（PNG/JPG/GIF/WebP，≤50MB）'
                  : '点击或拖入文件，随消息一并发送（≤50MB）',
              }
        }
        getDropContainer={getDropContainer}
      />
    </Sender.Header>
  );
};

export default ChatAttachments;

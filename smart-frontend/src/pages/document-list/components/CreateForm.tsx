import {
  DownloadOutlined,
  InboxOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { ActionType } from '@ant-design/pro-components';
import { history } from '@umijs/max';
import type { UploadFile, UploadProps } from 'antd';
import { Button, Drawer, message, Table, Upload } from 'antd';
import type { FC } from 'react';
import { useState } from 'react';

const { Dragger } = Upload;

const downloadFile = async (
  fileUrl: string,
  fileName: string,
  mimeType: string,
) => {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error('下载失败');
  const fileBlob = await response.blob();
  const blob = new Blob([fileBlob], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
};

interface CreateFormProps {
  reload?: ActionType['reload'];
}

interface FileRecord {
  key: string;
  id: number | null;
  filename: string;
  oss_word_url: string | null;
  oss_md_url: string | null;
}

const CreateForm: FC<CreateFormProps> = (props) => {
  const { reload } = props;
  const [open, setOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [resultList, setResultList] = useState<FileRecord[]>([]);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: true,
    accept: '.doc,.docx,.md,.zip',
    fileList,
    progress: { strokeWidth: 2, showInfo: true },
    showUploadList: { showRemoveIcon: false },
    customRequest: ({ file, onSuccess, onError, onProgress }) => {
      const formData = new FormData();
      formData.append('file', file as File);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress?.({ percent }, file as any);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            onSuccess?.(result);
            if (result.status === 'ok' && result.data) {
              setResultList((prev) => [
                ...prev,
                {
                  key: `${Date.now()}_${result.data.filename}`,
                  id: result.data.id ?? null,
                  filename: result.data.filename,
                  oss_word_url: result.data.oss_word_url,
                  oss_md_url: result.data.oss_md_url,
                },
              ]);
              messageApi.success(`${(file as File).name} 处理成功`);
              setFileList((prev) =>
                prev.filter((f) => f.uid !== (file as UploadFile).uid),
              );
            } else {
              messageApi.error(`${(file as File).name} 处理失败`);
            }
          } catch {
            onError?.(new Error('解析响应失败'));
          }
        } else {
          let errMsg = '上传失败';
          try {
            const err = JSON.parse(xhr.responseText);
            errMsg = err.detail || err.errorMessage || errMsg;
          } catch {}
          onError?.(new Error(errMsg));
          messageApi.error(`${(file as File).name} ${errMsg}`);
        }
      };

      xhr.onerror = () => {
        onError?.(new Error('网络错误'));
        messageApi.error(`${(file as File).name} 上传失败: 网络错误`);
      };

      xhr.send(formData);
    },
    onChange: ({ fileList: newFileList }) => {
      setFileList(newFileList);
    },
    onDrop(e) {
      console.log('Dropped files', e.dataTransfer.files);
    },
  };

  const columns = [
    {
      title: '文件名称',
      dataIndex: 'filename',
      key: 'filename',
      ellipsis: true,
    },
    {
      title: 'Word',
      dataIndex: 'oss_word_url',
      key: 'oss_word_url',
      width: 80,
      render: (url: string | null, record: FileRecord) =>
        url ? (
          <Button
            type="link"
            size="small"
            loading={downloadingKey === `word-${record.key}`}
            onClick={async () => {
              setDownloadingKey(`word-${record.key}`);
              try {
                const baseName = (record.filename || 'file').replace(
                  /\.\w+$/,
                  '',
                );
                await downloadFile(
                  url,
                  `${baseName}.docx`,
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                );
                messageApi.success('下载成功');
              } catch {
                messageApi.error('下载失败');
              } finally {
                setDownloadingKey(null);
              }
            }}
          >
            下载
          </Button>
        ) : (
          '-'
        ),
    },
    {
      title: 'Markdown',
      dataIndex: 'oss_md_url',
      key: 'oss_md_url',
      width: 80,
      render: (url: string | null, record: FileRecord) =>
        url ? (
          <Button
            type="link"
            size="small"
            loading={downloadingKey === `md-${record.key}`}
            onClick={async () => {
              setDownloadingKey(`md-${record.key}`);
              try {
                const baseName = (record.filename || 'file').replace(
                  /\.\w+$/,
                  '',
                );
                await downloadFile(url, `${baseName}.md`, 'text/markdown');
                messageApi.success('下载成功');
              } catch {
                messageApi.error('下载失败');
              } finally {
                setDownloadingKey(null);
              }
            }}
          >
            下载
          </Button>
        ) : (
          '-'
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: FileRecord) =>
        record.id ? (
          <a onClick={() => history.push(`/copilot/${record.id}`)}>AI 对话</a>
        ) : (
          '-'
        ),
    },
  ];

  const handleBatchDownload = async () => {
    const tasks = resultList.flatMap((r) => {
      const baseName = (r.filename || 'file').replace(/\.\w+$/, '');
      const items: { url: string; fileName: string; mimeType: string }[] = [];
      if (r.oss_word_url) {
        items.push({
          url: r.oss_word_url,
          fileName: `${baseName}.docx`,
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      }
      if (r.oss_md_url) {
        items.push({
          url: r.oss_md_url,
          fileName: `${baseName}.md`,
          mimeType: 'text/markdown',
        });
      }
      return items;
    });
    if (!tasks.length) return;
    setDownloadingKey('batch');
    try {
      for (const t of tasks) {
        await downloadFile(t.url, t.fileName, t.mimeType);
      }
      messageApi.success(`已下载 ${tasks.length} 个文件`);
    } catch {
      messageApi.error('批量下载失败');
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleClose = () => {
    setResultList([]);
    setFileList([]);
    setOpen(false);
    if (resultList.length > 0) {
      reload?.();
    }
  };

  return (
    <>
      {contextHolder}
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => setOpen(true)}
      >
        新建
      </Button>
      <Drawer title="上传文件" size={600} open={open} onClose={handleClose}>
        <div style={{ maxWidth: 400, margin: '0 auto' }}>
          <Dragger {...uploadProps} style={{ padding: '12px 0' }}>
            <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
              <InboxOutlined style={{ fontSize: 32, color: '#1677ff' }} />
            </p>
            <p className="ant-upload-text" style={{ fontSize: 13 }}>
              点击或拖拽文件到此区域上传
            </p>
            <p className="ant-upload-hint" style={{ fontSize: 12 }}>
              支持 .doc / .docx / .md 文件
            </p>
          </Dragger>
        </div>

        {resultList.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 500 }}>
                上传结果（{resultList.length} 个文件）
              </span>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloadingKey === 'batch'}
                onClick={handleBatchDownload}
              >
                批量下载
              </Button>
            </div>
            <Table
              columns={columns}
              dataSource={resultList}
              pagination={false}
              size="small"
            />
          </div>
        )}
      </Drawer>
    </>
  );
};

export default CreateForm;

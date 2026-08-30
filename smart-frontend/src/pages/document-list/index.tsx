import { UploadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { history } from '@umijs/max';
import { Button, message, Popconfirm, Upload } from 'antd';
import React, { useCallback, useRef, useState } from 'react';
import {
  handleFileApiFilesPost,
  listFilesApiFilesGet,
} from '@/services/fast-api-manage/wenjianguanli';
import CreateForm from './components/CreateForm';

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

const TableList: React.FC = () => {
  const actionRef = useRef<ActionType | null>(null);
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [parsingFiles, setParsingFiles] = useState<Set<string>>(new Set());

  const { mutate: deleteMutate, isPending: deleting } = useMutation({
    mutationFn: (keys: React.Key[]) =>
      handleFileApiFilesPost({ method: 'delete', data: { key: keys } }),
    onSuccess: () => {
      setSelectedRowKeys([]);
      actionRef.current?.reloadAndRest?.();
      queryClient.invalidateQueries({ queryKey: ['files'] });
      messageApi.success('删除成功');
    },
    onError: () => {
      messageApi.error('删除失败，请重试');
    },
  });

  const handleRemove = useCallback(
    (keys: React.Key[]) => {
      if (!keys.length) {
        messageApi.warning('请选择删除项');
        return;
      }
      deleteMutate(keys);
    },
    [deleteMutate, messageApi],
  );

  const columns: ProColumns[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 50,
      search: false,
    },
    {
      title: '文件名称',
      dataIndex: 'original_name',
      ellipsis: true,
    },
    {
      title: '用户',
      dataIndex: 'uid',
      ellipsis: true,
    },
    {
      title: '文件大小',
      dataIndex: 'file_size',
      width: 100,
      search: false,
      render: (_, record) => {
        const size = record.file_size;
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
      },
    },
    {
      title: 'Word 下载',
      dataIndex: 'oss_word_url',
      width: 120,
      search: false,
      render: (_, record) =>
        record.oss_word_url ? (
          <Button
            type="link"
            size="small"
            loading={downloadingKey === `word-${record.id}`}
            onClick={async () => {
              setDownloadingKey(`word-${record.id}`);
              try {
                const baseName = (record.original_name || 'file').replace(
                  /\.\w+$/,
                  '',
                );
                await downloadFile(
                  record.oss_word_url,
                  `${baseName}.docx`,
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                );
                messageApi.success('下载成功');
              } catch {
                messageApi.error('下载失败，请重试');
              } finally {
                setDownloadingKey(null);
              }
            }}
          >
            Word
          </Button>
        ) : (
          '-'
        ),
    },
    {
      title: 'Markdown 下载',
      dataIndex: 'oss_md_url',
      width: 140,
      search: false,
      render: (_, record) =>
        record.oss_md_url ? (
          <Button
            type="link"
            size="small"
            loading={downloadingKey === `md-${record.id}`}
            onClick={async () => {
              setDownloadingKey(`md-${record.id}`);
              try {
                const baseName = (record.original_name || 'file').replace(
                  /\.\w+$/,
                  '',
                );
                await downloadFile(
                  record.oss_md_url,
                  `${baseName}.md`,
                  'text/markdown',
                );
                messageApi.success('下载成功');
              } catch {
                messageApi.error('下载失败，请重试');
              } finally {
                setDownloadingKey(null);
              }
            }}
          >
            Markdown
          </Button>
        ) : (
          '-'
        ),
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      render: (_, record) => (
        <>
          <a onClick={() => history.push(`/copilot/${record.id}`)}>AI 对话</a>
          <a style={{ marginLeft: 8, marginRight: 8, color: '#d9d9d9' }}>|</a>
          <Popconfirm
            title="确认删除此文件？"
            onConfirm={() => handleRemove([record.id])}
          >
            <a>删除</a>
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <PageContainer>
      {contextHolder}
      <ProTable
        headerTitle="文件列表"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 120,
        }}
        request={async (params) => {
          const res = await listFilesApiFilesGet({
            current: params.current,
            pageSize: params.pageSize,
            original_name: params.original_name || undefined,
          });
          return {
            data: res.data || [],
            total: res.total || 0,
            success: res.success,
          };
        }}
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        toolBarRender={() => [
          <Upload
            key="mineru-upload"
            name="file"
            action="/api/files/mineru/upload"
            showUploadList={false}
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
            withCredentials
            onChange={(info) => {
              const name = info.file.name;
              if (info.file.status === 'uploading') {
                setParsingFiles((prev) => new Set(prev).add(name));
              }
              if (info.file.status === 'done') {
                messageApi.success(`${name} 已提交解析，处理完成后将自动显示`);
                setTimeout(() => actionRef.current?.reload(), 15000);
                setTimeout(() => actionRef.current?.reload(), 30000);
                setParsingFiles((prev) => {
                  const next = new Set(prev);
                  next.delete(name);
                  return next;
                });
              } else if (info.file.status === 'error') {
                const errDetail = info.file.response?.detail || '上传失败';
                messageApi.error(`${name}: ${errDetail}`);
                setParsingFiles((prev) => {
                  const next = new Set(prev);
                  next.delete(name);
                  return next;
                });
              }
            }}
          >
            <Button icon={<UploadOutlined />} loading={parsingFiles.size > 0}>
              {parsingFiles.size > 0
                ? `解析中 (${parsingFiles.size})`
                : '解析文档'}
            </Button>
          </Upload>,
          <CreateForm key="create" reload={actionRef.current?.reload} />,
          selectedRowKeys.length > 0 && (
            <Button
              key="batchDelete"
              danger
              loading={deleting}
              onClick={() => handleRemove(selectedRowKeys)}
            >
              批量删除（{selectedRowKeys.length}）
            </Button>
          ),
        ]}
      />
    </PageContainer>
  );
};

export default TableList;

import {
  CheckCircleFilled,
  DeleteOutlined,
  EyeOutlined,
  FileMarkdownOutlined,
  FileWordOutlined,
  InfoCircleFilled,
  LoadingOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Empty,
  Flex,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import type { MineruTask } from './service';
import { deleteMineruTasks, listMineruTasks } from './service';
import './task.css';

export type StatusFilter = 'all' | 'success' | 'failed';

interface TaskTableProps {
  search: string;
  statusFilter: StatusFilter;
}

const PAGE_SIZE = 10;

const STATE_FILTER_MAP: Record<StatusFilter, string | undefined> = {
  all: undefined,
  success: 'done',
  failed: 'error',
};

function formatSize(bytes?: number | null) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** "2025-10-25 09:48:05" → "2025/10/25 09:48"（与原型展示一致） */
function formatDate(s?: string | null) {
  return s ? s.replace(/-/g, '/').slice(0, 16) : '';
}

function fileType(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'Word';
  if (ext === 'md') return 'Markdown';
  return '文档';
}

/** 前端 blob 下载（与 document-list 页一致）：fetch → blob → a[download] 点击，不打开新页面 */
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

const DOWNLOAD_MIME: Record<'word' | 'md', { suffix: string; type: string }> = {
  word: {
    suffix: '.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  md: { suffix: '.md', type: 'text/markdown' },
};

export default function TaskTable({ search, statusFilter }: TaskTableProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  // 搜索防抖：输入停 300ms 再触发查询，避免每个按键一次请求
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // 新搜索回到第一页
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1); // 切换状态筛选回到第一页
  }, [statusFilter]);

  const queryKey = [
    'mineru-tasks',
    { page, search: debouncedSearch, statusFilter },
  ];
  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      listMineruTasks({
        current: page,
        pageSize: PAGE_SIZE,
        original_name: debouncedSearch.trim() || undefined,
        state: STATE_FILTER_MAP[statusFilter] as 'done' | 'error' | undefined,
      }),
    placeholderData: (prev) => prev, // 翻页/筛选时保留旧数据避免闪空
    // 存在"解析中"任务时每 8s 自动轮询，全部终态后停止
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some((t) => t.mineru_state === 'submitted')
        ? 8000
        : false,
  });

  const tasks = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;

  const handleRemove = async (id: number) => {
    setRemovingId(id);
    try {
      await deleteMineruTasks([id]);
      message.success('任务已删除');
      queryClient.invalidateQueries({ queryKey: ['mineru-tasks'] });
    } catch (e) {
      message.error(`删除失败：${e instanceof Error ? e.message : '请重试'}`);
    } finally {
      setRemovingId(null);
    }
  };

  const handleDownload = async (
    record: MineruTask,
    kind: 'word' | 'md',
    fileUrl: string,
  ) => {
    setDownloadingKey(`${kind}-${record.id}`);
    try {
      const baseName = (record.original_name || 'file').replace(/\.\w+$/, '');
      await downloadFile(
        fileUrl,
        `${baseName}${DOWNLOAD_MIME[kind].suffix}`,
        DOWNLOAD_MIME[kind].type,
      );
      message.success('下载成功');
    } catch {
      message.error('下载失败，请重试');
    } finally {
      setDownloadingKey(null);
    }
  };

  const stateCell = (state: string | null) => {
    if (state === 'done') {
      return (
        <Space size={6} className="mu-status mu-status-success">
          <CheckCircleFilled />
          <span>解析成功</span>
        </Space>
      );
    }
    if (state === 'error') {
      return (
        <Space size={6} className="mu-status mu-status-failed">
          <InfoCircleFilled />
          <span>解析失败</span>
        </Space>
      );
    }
    return (
      <Space size={6} className="mu-status mu-status-parsing">
        <LoadingOutlined spin />
        <span>解析中</span>
      </Space>
    );
  };

  const columns: ColumnsType<MineruTask> = [
    {
      title: '任务名称',
      dataIndex: 'original_name',
      render: (_, record) => (
        <Flex vertical gap={2}>
          <Typography.Text strong className="mu-task-name" ellipsis>
            {record.original_name}
          </Typography.Text>
          <Typography.Text type="secondary" className="mu-task-size">
            {formatSize(record.file_size)}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '状态',
      dataIndex: 'mineru_state',
      width: 140,
      render: (_, record) => stateCell(record.mineru_state),
    },
    {
      title: '类型',
      width: 100,
      render: (_, record) => fileType(record.original_name),
    },
    { title: '模型', width: 150, render: () => 'MinerU VLM' },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (_, record) => formatDate(record.created_at),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => {
        // 预览优先 HTML（extra_formats 原生生成，自包含样式），历史任务回落 Markdown
        const previewUrl = record.oss_html_url || record.oss_md_url;
        const previewTip = record.oss_html_url
          ? '预览 HTML'
          : record.oss_md_url
            ? '查看 Markdown'
            : '解析完成后可预览';
        return (
          <Space size={4} className="mu-actions">
            <Tooltip title={previewTip}>
              <Button
                type="text"
                size="small"
                className="mu-action-btn"
                icon={<EyeOutlined />}
                disabled={!previewUrl}
                onClick={() => previewUrl && window.open(previewUrl, '_blank')}
              />
            </Tooltip>
            <Tooltip
              title={record.oss_word_url ? '下载 Word' : '解析完成后可下载'}
            >
              <Button
                type="text"
                size="small"
                className="mu-action-btn"
                icon={<FileWordOutlined />}
                disabled={!record.oss_word_url}
                loading={downloadingKey === `word-${record.id}`}
                onClick={() =>
                  record.oss_word_url &&
                  handleDownload(record, 'word', record.oss_word_url)
                }
              />
            </Tooltip>
            <Tooltip
              title={record.oss_md_url ? '下载 Markdown' : '解析完成后可下载'}
            >
              <Button
                type="text"
                size="small"
                className="mu-action-btn"
                icon={<FileMarkdownOutlined />}
                disabled={!record.oss_md_url}
                loading={downloadingKey === `md-${record.id}`}
                onClick={() =>
                  record.oss_md_url &&
                  handleDownload(record, 'md', record.oss_md_url)
                }
              />
            </Tooltip>
            <Popconfirm
              title="确认删除该解析任务吗？"
              description="源文件与解析产物将一并删除"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleRemove(record.id)}
            >
              <Tooltip title="删除">
                <Button
                  type="text"
                  size="small"
                  danger
                  loading={removingId === record.id}
                  className="mu-action-btn mu-action-btn-danger"
                  icon={<DeleteOutlined />}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize: PAGE_SIZE,
    total,
    showSizeChanger: false,
    onChange: setPage,
  };

  return (
    <div className="mu-table-wrap mu-slide-in-late">
      <Table<MineruTask>
        rowKey="id"
        columns={columns}
        dataSource={tasks}
        loading={isLoading || isFetching}
        scroll={{ x: 960 }}
        tableLayout="fixed"
        pagination={pagination}
        locale={{ emptyText: <Empty description="暂无任务" /> }}
      />
    </div>
  );
}

import {
  CheckCircleFilled,
  CloudUploadOutlined,
  ExclamationCircleFilled,
  FileTextOutlined,
  LoadingOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import type { UploadFile, UploadProps } from 'antd';
import { App, Button, Flex, Typography, Upload } from 'antd';
import { useMemo, useState } from 'react';
import './task.css';

interface UploadViewProps {
  /** 提交成功后引导去任务管理 */
  onViewTasks?: () => void;
}

const ACCEPTED_EXTS = ['.pdf', '.docx', '.doc', '.md'];

function formatSize(bytes?: number) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 单文件提交状态：后端失败也返回 HTTP 200，须以 response.status 为准 */
function submitState(file: UploadFile): 'uploading' | 'ok' | 'failed' {
  if (file.status === 'uploading') return 'uploading';
  if (file.status === 'done' && file.response?.status === 'ok') return 'ok';
  return 'failed';
}

/** 新解析：上传文档提交 MinerU 解析（POST /api/files/mineru/upload，Cookie 鉴权） */
export default function UploadView({ onViewTasks }: UploadViewProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const hasSuccess = useMemo(
    () => fileList.some((f) => submitState(f) === 'ok'),
    [fileList],
  );

  const draggerProps: UploadProps = {
    name: 'file',
    action: '/api/files/mineru/upload',
    accept: ACCEPTED_EXTS.join(','),
    multiple: true,
    withCredentials: true,
    showUploadList: false,
    onChange: (info) => {
      setFileList(info.fileList);
      if (info.file.status === 'done') {
        const resp = info.file.response;
        if (resp?.status === 'ok') {
          message.success(
            `${info.file.name} 已提交解析，处理完成后可在「任务管理」查看`,
          );
          // 提交成功即刷新任务列表缓存，切到任务管理看到最新数据
          queryClient.invalidateQueries({ queryKey: ['mineru-tasks'] });
        } else {
          message.error(
            `${info.file.name}：${resp?.errorMessage || resp?.detail || '提交解析失败'}`,
          );
        }
      } else if (info.file.status === 'error') {
        message.error(`${info.file.name}：上传失败，请重试`);
      }
    },
  };

  return (
    <div className="mu-upload-wrap mu-slide-in-late">
      <Flex vertical align="center" gap={4} className="mu-upload-hero">
        <CloudUploadOutlined className="mu-upload-hero-icon" />
        <Typography.Title level={4} className="mu-upload-hero-title">
          新解析
        </Typography.Title>
        <Typography.Text type="secondary">
          上传文档自动提交 MinerU 解析，支持 {ACCEPTED_EXTS.join(' / ')}，可多选
        </Typography.Text>
      </Flex>

      <Upload.Dragger {...draggerProps} className="mu-upload-dragger">
        <Flex
          vertical
          align="center"
          gap={10}
          className="mu-upload-dragger-inner"
        >
          <span className="mu-upload-dragger-icon">
            <CloudUploadOutlined />
          </span>
          <Typography.Text strong>点击或拖拽文件到此处上传</Typography.Text>
          <Typography.Text type="secondary" className="mu-upload-dragger-hint">
            单个或多个文件均可，解析任务仅保留 30 天
          </Typography.Text>
        </Flex>
      </Upload.Dragger>

      {fileList.length > 0 && (
        <div className="mu-upload-list">
          {fileList.map((file) => {
            const state = submitState(file);
            return (
              <Flex
                key={file.uid}
                align="center"
                gap={10}
                className="mu-upload-row"
              >
                <FileTextOutlined className="mu-upload-row-icon" />
                <Flex vertical gap={2} className="mu-upload-row-name">
                  <Typography.Text
                    strong
                    ellipsis
                    className="mu-upload-row-title"
                  >
                    {file.name}
                  </Typography.Text>
                  {file.size !== undefined && (
                    <Typography.Text
                      type="secondary"
                      className="mu-upload-row-size"
                    >
                      {formatSize(file.size)}
                    </Typography.Text>
                  )}
                </Flex>
                {state === 'uploading' && (
                  <Flex gap={6} className="mu-status mu-status-uploading">
                    <LoadingOutlined spin />
                    <span>上传中…</span>
                  </Flex>
                )}
                {state === 'ok' && (
                  <Flex gap={6} className="mu-status mu-status-success">
                    <CheckCircleFilled />
                    <span>已提交解析</span>
                  </Flex>
                )}
                {state === 'failed' && (
                  <Flex gap={6} className="mu-status mu-status-failed">
                    <ExclamationCircleFilled />
                    <span>{file.response?.errorMessage || '提交失败'}</span>
                  </Flex>
                )}
              </Flex>
            );
          })}
        </div>
      )}

      {hasSuccess && (
        <Flex justify="center" className="mu-upload-footer">
          <Button type="primary" ghost onClick={onViewTasks}>
            查看任务记录
            <RightOutlined />
          </Button>
        </Flex>
      )}
    </div>
  );
}

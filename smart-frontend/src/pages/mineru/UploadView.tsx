import {
  CheckCircleFilled,
  ExclamationCircleFilled,
  FileTextOutlined,
  GlobalOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import type { UploadFile, UploadProps } from 'antd';
import {
  App,
  Button,
  Flex,
  Input,
  Modal,
  Space,
  Typography,
  Upload,
} from 'antd';
import { useMemo, useState } from 'react';
import cloudUploadSvg from './assets/cloud-upload.svg';
import { submitMineruUrl } from './service';
import './task.css';

interface UploadViewProps {
  /** 提交成功后引导去任务管理 */
  onViewTasks?: () => void;
}

const ACCEPTED_EXTS = ['.pdf', '.docx', '.doc', '.md'];

/** 明确是文档/图片的链接（带扩展名）才走 VLM 模型，其余按网页用 MinerU-HTML */
const DOC_URL_RE =
  /\.(pdf|docx?|pptx?|xlsx?|png|jpe?g|jp2|webp|gif|bmp)(\?|#|$)/i;

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

/** 新解析：上传文档 / 网页链接提交 MinerU 解析 */
export default function UploadView({ onViewTasks }: UploadViewProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [submittingUrl, setSubmittingUrl] = useState(false);

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

  const handleUrlSubmit = async () => {
    const url = urlValue.trim();
    if (!/^https?:\/\//.test(url)) {
      message.warning('请输入以 http(s):// 开头的链接');
      return;
    }
    setSubmittingUrl(true);
    try {
      // 无需用户选择：明确是文档链接（pdf/word/ppt/excel/图片）才走 VLM，
      // 其余（无扩展名或 .html 的网页 URL）一律 MinerU-HTML——
      // VLM 无法处理 html 文件，平台会报 "cannot process html files"
      const modelVersion = DOC_URL_RE.test(url) ? 'vlm' : 'MinerU-HTML';
      await submitMineruUrl(url, { model_version: modelVersion });
      message.success('已提交解析，处理完成后可在「任务管理」查看');
      queryClient.invalidateQueries({ queryKey: ['mineru-tasks'] });
      setUrlModalOpen(false);
      setUrlValue('');
    } catch (e) {
      message.error(`提交失败：${e instanceof Error ? e.message : '请重试'}`);
    } finally {
      setSubmittingUrl(false);
    }
  };

  return (
    <div className="mu-upload-page mu-slide-in-late">
      <div className="mu-upload-inner">
        {/* 标题区（参考官网智能解析页） */}
        <div className="mu-upload-heading">
          <Typography.Title level={2} className="mu-upload-title">
            智能解析
          </Typography.Title>
          <Typography.Text type="secondary" className="mu-upload-subtitle">
            让文档和网页内容为 AI 所用
          </Typography.Text>
        </div>

        <div className="mu-upload-card-holder">
          {/* 提交成功后的右上角入口 */}
          {hasSuccess && (
            <Button
              type="link"
              size="small"
              className="mu-upload-view-tasks"
              onClick={onViewTasks}
            >
              查看任务记录
              <RightOutlined />
            </Button>
          )}

          <Upload.Dragger {...draggerProps} className="mu-upload-dragger">
            <Flex
              vertical
              align="center"
              gap={22}
              className="mu-upload-card-inner"
            >
              <img
                src={cloudUploadSvg}
                alt="文档解析插画"
                className="mu-upload-art"
                draggable={false}
              />
              <Space size={12}>
                <Button
                  icon={<PaperClipOutlined />}
                  className="mu-upload-action"
                >
                  上传文件
                </Button>
                {/* 阻断冒泡：避免点击时触发 Dragger 的文件选择 */}
                <Button
                  icon={<GlobalOutlined />}
                  className="mu-upload-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    setUrlModalOpen(true);
                  }}
                >
                  网页链接
                </Button>
              </Space>
            </Flex>
          </Upload.Dragger>
        </div>

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
      </div>

      <Modal
        title="网页链接解析"
        open={urlModalOpen}
        onCancel={() => setUrlModalOpen(false)}
        onOk={handleUrlSubmit}
        okText="提交解析"
        cancelText="取消"
        confirmLoading={submittingUrl}
        okButtonProps={{ disabled: !urlValue.trim() }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" className="mu-upload-modal-tip">
          输入可公开访问的链接（.html 网页 / .pdf / .docx
          等文档），解析完成后可在任务管理查看结果
        </Typography.Paragraph>
        <Input
          allowClear
          placeholder="https://example.com/page.html 或 https://example.com/document.pdf"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onPressEnter={handleUrlSubmit}
        />
      </Modal>
    </div>
  );
}

import {
  DownloadOutlined,
  FileTextOutlined,
  InboxOutlined,
  PrinterOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  List,
  message,
  Row,
  Col,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import { useRef, useState } from 'react';
import type { ShubanFile, ShubanToken } from './data';
import { getAst, getPreview, getReport, getText, getTokens, listFiles } from './service';

const { Dragger } = Upload;
const { Text } = Typography;
const queryKeys = {
  files: ['shuban', 'files'],
  report: (name: string) => ['shuban', name, 'report'],
  preview: (name: string) => ['shuban', name, 'preview'],
  tokens: (name: string) => ['shuban', name, 'tokens'],
  ast: (name: string) => ['shuban', name, 'ast'],
  text: (name: string) => ['shuban', name, 'text'],
};

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ShubanPage() {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<string>();
  const [activeTab, setActiveTab] = useState('preview');
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const filesQuery = useQuery({ queryKey: queryKeys.files, queryFn: listFiles });
  const file = selectedFile;
  const reportQuery = useQuery({
    queryKey: queryKeys.report(file || ''),
    queryFn: () => getReport(file || ''),
    enabled: Boolean(file),
  });
  const previewQuery = useQuery({
    queryKey: queryKeys.preview(file || ''),
    queryFn: () => getPreview(file || ''),
    enabled: Boolean(file) && activeTab === 'preview',
  });
  const tokenQuery = useQuery({
    queryKey: queryKeys.tokens(file || ''),
    queryFn: () => getTokens(file || ''),
    enabled: Boolean(file) && activeTab === 'structure',
  });
  const astQuery = useQuery({
    queryKey: queryKeys.ast(file || ''),
    queryFn: () => getAst(file || ''),
    enabled: Boolean(file) && activeTab === 'ast',
  });
  const textQuery = useQuery({
    queryKey: queryKeys.text(file || ''),
    queryFn: () => getText(file || ''),
    enabled: Boolean(file) && activeTab === 'text',
  });
  const files = filesQuery.data?.files || [];

  const uploadProps: UploadProps = {
    name: 'file',
    action: '/api/shuban/upload',
    multiple: true,
    accept: '.fbd,.pro,.png,.jpg,.jpeg,.gif,.webp,.svg,.tif,.tiff,.bmp,.eps,.ps',
    withCredentials: true,
    showUploadList: false,
    onChange(info) {
      if (info.file.status === 'done') {
        void message.success(`${info.file.name} 已导入`);
        void queryClient.invalidateQueries({ queryKey: queryKeys.files });
        if (info.file.name.toLowerCase().endsWith('.fbd')) {
          setSelectedFile(info.file.name);
        }
      } else if (info.file.status === 'error') {
        const response = info.file.response as { detail?: string } | undefined;
        void message.error(response?.detail || `${info.file.name} 导入失败`);
      }
    },
  };

  const tabs = [
    {
      key: 'preview',
      label: '近似排版',
      children: previewQuery.isLoading ? (
        <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
      ) : previewQuery.data ? (
        <iframe
          ref={previewFrame}
          title="FBD 近似排版预览"
          sandbox="allow-scripts allow-modals"
          srcDoc={previewQuery.data}
          style={{ width: '100%', height: 'calc(100vh - 340px)', minHeight: 560, border: 0 }}
        />
      ) : <Empty description={previewQuery.error?.message || '排版预览暂不可用'} />,
    },
    {
      key: 'structure',
      label: '结构视图',
      children: <Spin spinning={tokenQuery.isLoading}>
        {tokenQuery.data ? <Table<ShubanToken>
          size="small"
          rowKey={(item) => `${item.offset}-${item.kind}`}
          dataSource={tokenQuery.data}
          pagination={{ pageSize: 50, showSizeChanger: true }}
          scroll={{ x: 900, y: 'calc(100vh - 410px)' }}
          columns={[
            { title: '行', dataIndex: 'line', width: 70, sorter: (a, b) => a.line - b.line },
            { title: '类型', dataIndex: 'kind', width: 100, render: (value: string) => <Tag>{value}</Tag> },
            { title: '名称', dataIndex: 'name', width: 120, render: (value: string) => value || '—' },
            { title: '内容', dataIndex: 'raw', ellipsis: true },
            { title: '说明', dataIndex: 'description', width: 240, ellipsis: true, render: (value: string) => value || '—' },
            { title: '置信度', dataIndex: 'confidence', width: 100, render: (value: string) => value || '—' },
          ]}
        /> : <Empty description={tokenQuery.error?.message || '没有结构数据'} />}
      </Spin>,
    },
    {
      key: 'ast',
      label: 'AST 树',
      children: <Spin spinning={astQuery.isLoading}>
        {astQuery.data ? <>
          <Descriptions size="small" column={{ xs: 1, sm: 3 }} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="节点数">{astQuery.data.summary.nodes}</Descriptions.Item>
            <Descriptions.Item label="最大嵌套">{astQuery.data.summary.max_depth}</Descriptions.Item>
            <Descriptions.Item label="宏展开">{astQuery.data.macros.expanded} / {astQuery.data.macros.calls}</Descriptions.Item>
          </Descriptions>
          {astQuery.data.warnings.map((warning) => <Alert key={warning} type="warning" showIcon message={warning} style={{ marginBottom: 8 }} />)}
          <pre style={{ overflow: 'auto', maxHeight: 'calc(100vh - 450px)', whiteSpace: 'pre-wrap' }}>{astQuery.data.text}</pre>
        </> : <Empty description={astQuery.error?.message || '没有 AST 数据'} />}
      </Spin>,
    },
    {
      key: 'text',
      label: '纯文本',
      children: <Spin spinning={textQuery.isLoading}>
        {textQuery.data ? <pre style={{ overflow: 'auto', maxHeight: 'calc(100vh - 390px)', whiteSpace: 'pre-wrap' }}>{textQuery.data.text}</pre> : <Empty description={textQuery.error?.message || '没有文本数据'} />}
      </Spin>,
    },
    {
      key: 'report',
      label: '统计校验',
      children: <Spin spinning={reportQuery.isLoading}>
        {reportQuery.data ? <>
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={12} md={6}><Statistic title="文件大小" value={formatSize(reportQuery.data.size)} /></Col>
            <Col xs={12} md={6}><Statistic title="行数" value={reportQuery.data.lines} /></Col>
            <Col xs={12} md={6}><Statistic title="注解数" value={reportQuery.data.annot_total} /></Col>
            <Col xs={12} md={6}><Statistic title="控制符种类" value={Object.keys(reportQuery.data.ctrl).length} /></Col>
          </Row>
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="配套 PRO">{reportQuery.data.pro.exists ? '已找到' : '未找到'}</Descriptions.Item>
            <Descriptions.Item label="注解名称">{reportQuery.data.annot_names}</Descriptions.Item>
            <Descriptions.Item label="控制符" span={2}>{Object.entries(reportQuery.data.ctrl).map(([name, count]) => `${name}: ${count}`).join('　') || '无'}</Descriptions.Item>
            <Descriptions.Item label="版面几何" span={2}><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(reportQuery.data.geometry, null, 2)}</pre></Descriptions.Item>
          </Descriptions>
          {reportQuery.data.warnings.length ? reportQuery.data.warnings.map((warning) => <Alert key={warning} type="warning" showIcon message={warning} style={{ marginBottom: 8 }} />) : <Alert type="success" showIcon message="未发现校验告警" />}
        </> : <Empty description={reportQuery.error?.message || '没有统计报告'} />}
      </Spin>,
    },
  ];

  return (
    <PageContainer
      title="书版预览"
      subTitle="方正书版小样解析、校验与近似排版"
      extra={<Space>
        <Button
          icon={<PrinterOutlined />}
          disabled={!file || activeTab !== 'preview'}
          onClick={() => previewFrame.current?.contentWindow?.print()}
        >打印 / PDF</Button>
        <Button
          href={file ? `/api/shuban/files/${encodeURIComponent(file)}/word` : undefined}
          icon={<DownloadOutlined />}
          disabled={!file}
        >导出 Word</Button>
        <Button icon={<ReloadOutlined />} loading={filesQuery.isFetching} onClick={() => void filesQuery.refetch()}>刷新文件</Button>
      </Space>}
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={6} xl={5}>
          <Dragger {...uploadProps} style={{ padding: '12px 8px', marginBottom: 16 }}>
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">导入 FBD 及配套文件</p>
            <p className="ant-upload-hint">可同时选择 .fbd、同名 .PRO 和图片素材，单文件最大 50 MB</p>
          </Dragger>
          <List
            size="small"
            header={<Space><FileTextOutlined />文件清单<Text type="secondary">{files.length}</Text></Space>}
            loading={filesQuery.isLoading}
            dataSource={files}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="导入 FBD 文件开始预览" /> }}
            renderItem={(item: ShubanFile) => (
              <List.Item
                onClick={() => setSelectedFile(item.name)}
                style={{ cursor: 'pointer', paddingInline: 8, background: selectedFile === item.name ? 'var(--ant-color-primary-bg)' : undefined }}
              >
                <List.Item.Meta
                  avatar={<FileTextOutlined style={{ color: selectedFile === item.name ? 'var(--ant-color-primary)' : undefined }} />}
                  title={<Text strong={selectedFile === item.name} ellipsis>{item.name}</Text>}
                  description={formatSize(item.size)}
                />
              </List.Item>
            )}
          />
        </Col>
        <Col xs={24} lg={18} xl={19}>
          {file ? <>
            <Space style={{ marginBottom: 8 }}>
              <Text strong>{file}</Text>
              {reportQuery.data?.warnings.length ? <Tag color="warning">{reportQuery.data.warnings.length} 条告警</Tag> : reportQuery.data && <Tag color="success">校验通过</Tag>}
            </Space>
            <Alert
              type="info"
              showIcon
              message="此处为浏览器近似排版预览；实际成品以方正书版发排结果为准。"
              style={{ marginBottom: 8 }}
            />
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
          </> : <Empty description="选择左侧文件或导入 FBD 文件" style={{ marginTop: 120 }} />}
        </Col>
      </Row>
    </PageContainer>
  );
}

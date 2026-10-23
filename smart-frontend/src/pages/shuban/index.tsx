import {
  ArrowLeftOutlined,
  BookOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  InboxOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import {
  Alert,
  App,
  Button,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Grid,
  Input,
  Layout,
  Menu,
  Modal,
  Popover,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Splitter,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { MenuProps, TableColumnsType, UploadProps } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ShubanAst, ShubanFile, ShubanReport, ShubanToken } from './data';
import {
  convertWord,
  getAst,
  getPreview,
  getReport,
  getText,
  getTokens,
  getWordTemplates,
  listFiles,
  importFiles,
  saveWordConversion,
} from './service';
import type { WordConversionResult, WordTemplate } from './service';
import { useStyles } from './styles';
import { createQueryKeys } from './queryKeys';

const { Sider } = Layout;
const { Dragger } = Upload;
const { Text } = Typography;

type Area = 'import' | 'files' | 'document';
type ResultView = 'structure' | 'ast' | 'text' | 'report';
type MobilePane = 'layout' | ResultView;
type FileSearchValues = {
  name?: string;
  modifiedRange?: [Dayjs | null, Dayjs | null] | null;
};
type FileFilters = { name: string; from?: number; to?: number };

type PreviewPhase = 'rendering' | 'ready' | 'error';
const perRowStorageKey = (userId: string, file: string) => `smart-assistant-shuban-perrow:${userId}:${file}`;

const resultLabels: Record<ResultView, string> = {
  structure: '结构',
  ast: 'AST',
  text: '纯文本',
  report: '校验报告',
};

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(timestamp: number) {
  if (!timestamp) return '—';
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN');
}

function geometryValue(value: unknown, unit = '') {
  return typeof value === 'number' ? `${value}${unit}` : '—';
}

function ResultPanel({
  activeView,
  setActiveView,
  file,
  queryKeys,
  layoutStatus,
  previewNotes,
}: {
  activeView: ResultView;
  setActiveView: (view: ResultView) => void;
  file: ShubanFile;
  queryKeys: ReturnType<typeof createQueryKeys>;
  layoutStatus: string;
  previewNotes: string[];
}) {
  const { styles } = useStyles();
  const reportQuery = useQuery({
    queryKey: queryKeys.report(file),
    queryFn: ({ signal }) => getReport(file.id, signal),
    enabled: activeView === 'report',
  });
  const tokenQuery = useQuery({
    queryKey: queryKeys.tokens(file),
    queryFn: ({ signal }) => getTokens(file.id, signal),
    enabled: activeView === 'structure',
  });
  const astQuery = useQuery({
    queryKey: queryKeys.ast(file),
    queryFn: ({ signal }) => getAst(file.id, signal),
    enabled: activeView === 'ast',
  });
  const textQuery = useQuery({
    queryKey: queryKeys.text(file),
    queryFn: ({ signal }) => getText(file.id, true, signal),
    enabled: activeView === 'text',
  });

  const report = reportQuery.data;
  const geometry = (report?.geometry || {}) as Record<string, unknown>;
  const columns: TableColumnsType<ShubanToken> = [
    { title: '行', dataIndex: 'line', width: 66, sorter: (a, b) => a.line - b.line },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 92,
      render: (value: string) => <Tag>{value === 'annot' ? '注解' : value === 'ctrl' ? '控制符' : value === 'text' ? '文本' : '换行'}</Tag>,
    },
    { title: '名称', dataIndex: 'name', width: 112, render: (value: string) => value || '—' },
    { title: '内容', dataIndex: 'raw', ellipsis: true },
    { title: '说明', dataIndex: 'description', width: 220, ellipsis: true, render: (value: string) => value || '—' },
    { title: '置信度', dataIndex: 'confidence', width: 90, render: (value: string) => value || '—' },
  ];

  const tabs = [
    {
      key: 'structure',
      label: resultLabels.structure,
      children: tokenQuery.isLoading ? (
        <div className={styles.resultPad}><Spin /></div>
      ) : tokenQuery.data ? (
        <Table<ShubanToken>
          size="small"
          rowKey={(item) => `${item.offset}-${item.kind}`}
          dataSource={tokenQuery.data}
          columns={columns}
          pagination={{ pageSize: 40, showSizeChanger: true, size: 'small' }}
          scroll={{ x: 820, y: 'calc(100dvh - 208px)' }}
        />
      ) : <Empty description={tokenQuery.error?.message || '没有结构数据'} />,
    },
    {
      key: 'ast',
      label: resultLabels.ast,
      children: astQuery.isLoading ? (
        <div className={styles.resultPad}><Spin /></div>
      ) : astQuery.data ? (
        <AstResult ast={astQuery.data} />
      ) : <Empty description={astQuery.error?.message || '没有 AST 数据'} />,
    },
    {
      key: 'text',
      label: resultLabels.text,
      children: textQuery.isLoading ? (
        <div className={styles.resultPad}><Spin /></div>
      ) : textQuery.data ? (
        <pre className={styles.textResult}>{textQuery.data.text || '没有可显示的正文'}</pre>
      ) : <Empty description={textQuery.error?.message || '没有文本数据'} />,
    },
    {
      key: 'report',
      label: resultLabels.report,
      children: reportQuery.isLoading ? (
        <div className={styles.resultPad}><Spin /></div>
      ) : report ? (
        <ReportResult
          report={report}
          geometry={geometry}
          layoutStatus={layoutStatus}
          previewNotes={previewNotes}
        />
      ) : <Empty description={reportQuery.error?.message || '没有校验报告'} />,
    },
  ];

  return (
    <Tabs
      className={styles.resultTabs}
      activeKey={activeView}
      onChange={(key) => setActiveView(key as ResultView)}
      items={tabs}
      destroyOnHidden
    />
  );
}

function AstResult({ ast }: { ast: ShubanAst }) {
  const { styles } = useStyles();
  return (
    <div className={styles.resultPad}>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 3 }} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="节点数">{ast.summary.nodes}</Descriptions.Item>
        <Descriptions.Item label="最大嵌套">{ast.summary.max_depth}</Descriptions.Item>
        <Descriptions.Item label="宏展开">{ast.macros.expanded} / {ast.macros.calls}</Descriptions.Item>
      </Descriptions>
      {ast.warnings.map((warning) => (
        <Alert key={warning} type="warning" showIcon title={warning} style={{ marginBottom: 8 }} />
      ))}
      <pre className={styles.textResult}>{ast.text}</pre>
    </div>
  );
}

function ReportResult({
  report,
  geometry,
  layoutStatus,
  previewNotes,
}: {
  report: ShubanReport;
  geometry: Record<string, unknown>;
  layoutStatus: string;
  previewNotes: string[];
}) {
  const { styles } = useStyles();
  const warnings = report.warnings || [];
  return (
    <div className={styles.resultPad}>
      <div className={styles.reportStats}>
        <Statistic title="文件大小" value={formatSize(report.size)} />
        <Statistic title="行数" value={report.lines} />
        <Statistic title="注解数" value={report.annot_total} />
        <Statistic title="控制符种类" value={Object.keys(report.ctrl || {}).length} />
      </div>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="配套 PRO">{report.pro.exists ? report.pro.path || '已找到' : '未找到'}</Descriptions.Item>
        <Descriptions.Item label="注解名称">{report.annot_names}</Descriptions.Item>
        <Descriptions.Item label="页面尺寸">
          {geometryValue(geometry.page_w)} × {geometryValue(geometry.page_h)} mm
        </Descriptions.Item>
        <Descriptions.Item label="成品尺寸">
          {geometryValue(geometry.trim_w)} × {geometryValue(geometry.trim_h)} mm
        </Descriptions.Item>
        <Descriptions.Item label="版心尺寸" span={2}>
          {geometryValue(geometry.text_w)} × {geometryValue(geometry.text_h)} mm
        </Descriptions.Item>
        <Descriptions.Item label="控制符" span={2}>
          {Object.entries(report.ctrl || {}).map(([name, count]) => `${name} ${count}`).join('　') || '无'}
        </Descriptions.Item>
      </Descriptions>
      {warnings.length ? warnings.map((warning) => (
        <Alert key={warning} type="warning" showIcon title={warning} style={{ marginBottom: 8 }} />
      )) : <Alert type="success" showIcon title="未发现校验告警" />}
      <div className={styles.reportNotes}>
        <Text strong>预览说明</Text>
        {previewNotes.map((note) => <Alert key={note} type="info" showIcon title={note} />)}
        <Alert
          type={layoutStatus.includes('完成') ? 'success' : 'warning'}
          showIcon
          title={layoutStatus || '等待版面测量状态'}
        />
      </div>
    </div>
  );
}

export default function ShubanPage() {
  const { initialState } = useModel('@@initialState');
  const queryClient = useQueryClient();
  const userId = initialState?.currentUser?.userid;
  useEffect(() => {
    const predicate = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === 'shuban' && query.queryKey[1] !== userId;
    void queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [queryClient, userId]);
  return <App>{userId ? <ShubanWorkspace key={userId} userId={userId} /> : <Spin />}</App>;
}

function ShubanWorkspace({ userId }: { userId: string }) {
  const queryKeys = useMemo(() => createQueryKeys(userId), [userId]);
  const { styles } = useStyles();
  const { message: appMessage } = App.useApp();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const compact = screens.md === false;
  const [collapsed, setCollapsed] = useState(false);
  const [area, setArea] = useState<Area>('import');
  const [selectedDocument, setSelectedFile] = useState<ShubanFile>();
  const [showResults, setShowResults] = useState(false);
  const [resultView, setResultView] = useState<ResultView>('text');
  const [mobilePane, setMobilePane] = useState<MobilePane>('layout');
  const [fileSearchForm] = Form.useForm<FileSearchValues>();
  const [fileFilters, setFileFilters] = useState<FileFilters>({ name: '' });
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [pendingWordFile, setPendingWordFile] = useState<File>();
  const [wordModalOpen, setWordModalOpen] = useState(false);
  const [wordTemplateId, setWordTemplateId] = useState<string>();
  const [wordSubmitting, setWordSubmitting] = useState(false);
  const [wordSaving, setWordSaving] = useState(false);
  const [wordSaved, setWordSaved] = useState(false);
  const [wordResult, setWordResult] = useState<WordConversionResult>();
  const [wordResultOpen, setWordResultOpen] = useState(false);
  const [layoutStatus, setLayoutStatus] = useState('');
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>('rendering');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [uploadTargetId, setUploadTargetId] = useState<string>();
  const importController = useRef<AbortController | null>(null);
  useEffect(() => () => importController.current?.abort(), []);
  const onLayoutStart = useCallback(() => {
    setPreviewPhase('rendering');
    setLayoutStatus('正在加载字体和图片、计算行栏页坐标…');
  }, []);
  const onLayoutTimeout = useCallback(() => {
    setPreviewPhase('error');
    setLayoutStatus('排版等待超时，请重试；若仍失败，请检查字体、图片和文档大小');
  }, []);
  const [previewNotes, setPreviewNotes] = useState<string[]>([]);
  const previewFrame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onLayoutStatus = (event: MessageEvent<unknown>) => {
      if (event.source !== previewFrame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const data = event.data as { type?: string; status?: string; notes?: unknown; file?: unknown; value?: unknown; phase?: unknown; message?: unknown };
      if (data.type === 'shuban-layout-state' && typeof data.message === 'string'
        && (data.phase === 'rendering' || data.phase === 'ready' || data.phase === 'error')) {
        setPreviewPhase(data.phase);
        setLayoutStatus(data.message);
      } else if (data.type === 'shuban-preview-notes' && Array.isArray(data.notes)) {
        setPreviewNotes(data.notes.filter((note): note is string => typeof note === 'string'));
      } else if (data.type === 'shuban-layout-status' && typeof data.status === 'string') {
        setLayoutStatus(data.status);
      } else if (data.type === 'shuban-perrow-request' && typeof data.file === 'string') {
        let value = '1';
        try {
          value = localStorage.getItem(perRowStorageKey(userId, data.file)) === '2' ? '2' : '1';
        } catch {}
        previewFrame.current?.contentWindow?.postMessage({ type: 'shuban-perrow-setting', file: data.file, value }, '*');
      } else if (data.type === 'shuban-perrow-change' && typeof data.file === 'string' && (data.value === '1' || data.value === '2')) {
        try {
          localStorage.setItem(perRowStorageKey(userId, data.file), data.value);
        } catch {}
      }
    };
    window.addEventListener('message', onLayoutStatus);
    return () => window.removeEventListener('message', onLayoutStatus);
  }, [userId]);

  const filesQuery = useQuery({ queryKey: queryKeys.files, queryFn: ({ signal }) => listFiles(signal) });
  const selectedFile = filesQuery.data?.files.find((file) => file.id === selectedDocument?.id) || selectedDocument;
  const wordTemplatesQuery = useQuery({
    queryKey: queryKeys.templates,
    queryFn: getWordTemplates,
    enabled: wordModalOpen,
  });
  const selectedReport = useQuery({
    queryKey: queryKeys.report(selectedFile),
    queryFn: ({ signal }) => getReport(selectedFile?.id || '', signal),
    enabled: Boolean(selectedFile),
  });
  const previewQuery = useQuery({
    queryKey: queryKeys.preview(selectedFile),
    queryFn: ({ signal }) => getPreview(selectedFile?.id || '', signal),
    enabled: Boolean(selectedFile) && area === 'document',
  });

  const files = useMemo(
    () => [...(filesQuery.data?.files || [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [filesQuery.data],
  );
  const recentFiles = files.slice(0, 8);
  const filteredFiles = useMemo(() => {
    return files.filter((item) => {
      if (fileFilters.name && !item.name.toLocaleLowerCase().includes(fileFilters.name)) return false;
      if (fileFilters.from !== undefined && item.updatedAt < fileFilters.from) return false;
      if (fileFilters.to !== undefined && item.updatedAt > fileFilters.to) return false;
      return true;
    });
  }, [files, fileFilters]);

  const openFile = (file: ShubanFile) => {
    setSelectedFile(file);
    setPreviewPhase('rendering');
    setPreviewAttempt((attempt) => attempt + 1);
    setArea('document');
    setShowResults(false);
    setResultView('text');
    setMobilePane('layout');
    setLayoutStatus('正在加载字体和图片、计算行栏页坐标…');
    setPreviewNotes([]);
  };

  const finishUpload = async (documents: ShubanFile[] = []) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.scope });
    if (documents.length) openFile(documents[documents.length - 1]);
  };

  const retryPreview = () => {
    onLayoutStart();
    setPreviewAttempt((attempt) => attempt + 1);
    void queryClient.invalidateQueries({ queryKey: queryKeys.scope });
  };

  const startImport = async (files: File[]) => {
    if (importController.current) return;
    const controller = new AbortController();
    importController.current = controller;
    setUploadingCount(files.length);
    setUploadPercent(0);
    try {
      const result = await importFiles(files, uploadTargetId, setUploadPercent, controller.signal);
      if (controller.signal.aborted) return;
      await finishUpload(result.documents);
      setUploadTargetId(undefined);
      void appMessage.success(`${result.documents.length} 份文档已${result.unchanged ? '存在' : '导入'}${result.ignoredCount ? `，忽略 ${result.ignoredCount} 个不支持的文件` : ''}`);
    } catch (error) {
      if (!controller.signal.aborted) void appMessage.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      importController.current = null;
      setUploadingCount(0);
    }
  };

  const startWordConversion = async () => {
    if (!pendingWordFile || !wordTemplateId) return;
    setWordSubmitting(true);
    try {
      const result = await convertWord(pendingWordFile, wordTemplateId);
      setWordResult(result);
      setWordSaved(false);
      setWordModalOpen(false);
      setWordResultOpen(true);
      setPendingWordFile(undefined);
    } catch (error) {
      void appMessage.error(error instanceof Error ? error.message : 'Word 排版失败');
    } finally {
      setWordSubmitting(false);
    }
  };

  const saveWordTypesetting = async () => {
    if (!wordResult || wordSaving || wordSaved) return;
    setWordSaving(true);
    try {
      const result = await saveWordConversion(wordResult.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.scope });
      setWordSaved(true);
      void appMessage.success(
        result.unchanged
          ? `${result.fbdFileName} 已在文件清单中`
          : `${result.fbdFileName} 已保存到文件清单`,
      );
    } catch (error) {
      void appMessage.error(error instanceof Error ? error.message : '保存排版失败');
    } finally {
      setWordSaving(false);
    }
  };

  const uploadProps: UploadProps = {
    multiple: true,
    accept: '.docx,.zip,.fbd,.pro,.png,.jpg,.jpeg,.gif,.webp,.svg,.tif,.tiff,.bmp,.eps,.ps',
    disabled: uploadingCount > 0 || wordSubmitting,
    showUploadList: false,
    beforeUpload(file, fileList) {
      // antd 对每个文件调用一次；将同一次选择统一提交，配套素材不会先于 FBD 发布。
      if (file.uid !== fileList[0]?.uid) return Upload.LIST_IGNORE;
      const wordFiles = fileList.filter((item) => item.name.toLowerCase().endsWith('.docx'));
      if (wordFiles.length) {
        if (fileList.length !== 1) {
          void appMessage.warning('Word 排版请一次选择一份 DOCX；FBD 与配套素材可一起选择');
        } else {
          setPendingWordFile(wordFiles[0]);
          setWordTemplateId(undefined);
          setWordModalOpen(true);
        }
      } else {
        void startImport(fileList);
      }
      return Upload.LIST_IGNORE;
    },
  };

  const menuItems: MenuProps['items'] = [
    { key: 'import', icon: <PlusOutlined />, label: '新建预览' },
    { key: 'files', icon: <UnorderedListOutlined />, label: '文件清单' },
  ];

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'import' || key === 'files') {
      setArea(key);
      return;
    }
  };

  const tableColumns: TableColumnsType<ShubanFile> = [
    {
      title: '文件名称',
      dataIndex: 'name',
      render: (name: string, item) => (
        <Button type="link" className={styles.fileNameButton} onClick={() => openFile(item)}>
          <FileTextOutlined />
          <span className={styles.fileNameText}>{name}</span>
        </Button>
      ),
    },
    { title: '格式', width: 105, render: () => <Tag>FBD</Tag> },
    { title: '大小', dataIndex: 'size', width: 120, render: (size: number) => formatSize(size) },
    {
      title: '修改时间',
      dataIndex: 'updatedAt',
      width: 190,
      sorter: (a, b) => a.updatedAt - b.updatedAt,
      render: (time: number) => formatTime(time),
    },
    {
      title: '操作',
      width: 100,
      align: 'right',
      render: (_, item) => (
        <Tooltip title="打开预览">
          <Button type="text" icon={<FileSearchOutlined />} aria-label={`打开 ${item.name}`} onClick={() => openFile(item)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <Layout className={styles.app}>
      <Sider
        className={styles.sider}
        width={248}
        collapsedWidth={58}
        collapsed={collapsed}
        collapsible
        trigger={null}
        breakpoint="md"
        onCollapse={setCollapsed}
      >
        <div className={`${styles.brand} ${collapsed ? styles.brandCollapsed : ''}`}>
          {!collapsed && (
            <div className={styles.brandName}>
              <BookOutlined className={styles.brandIcon} />
              <span>书版预览</span>
            </div>
          )}
          <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'} placement="right">
            <Button
              type="text"
              size="small"
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
          </Tooltip>
        </div>
        <nav className={styles.nav} aria-label="书版工作台导航">
          <Menu
            mode="inline"
            inlineCollapsed={collapsed}
            tooltip={collapsed ? { placement: 'right' } : false}
            triggerSubMenuAction="hover"
            subMenuOpenDelay={0}
            subMenuCloseDelay={0.18}
            selectedKeys={[area === 'import' ? 'import' : 'files']}
            items={menuItems}
            onClick={handleMenuClick}
          />
        </nav>
        {!collapsed && (
          <div className={styles.recent}>
            <div className={styles.recentTitle}>
              <ClockCircleOutlined />
              <span>最近文件</span>
            </div>
            <div className={styles.recentList}>
              {recentFiles.length ? recentFiles.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.recentItem}
                  aria-current={selectedFile?.id === item.id ? 'page' : undefined}
                  onClick={() => openFile(item)}
                  title={item.name}
                >
                  <FileTextOutlined />
                  <span className={styles.recentMeta}>
                    <span className={styles.recentName}>{item.name}</span>
                    <span className={styles.recentSize}>{formatSize(item.size)}</span>
                  </span>
                </button>
              )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无文件" />}
            </div>
          </div>
        )}
      </Sider>

      <Layout className={styles.main}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            {area !== 'document' && (
              <>
                <BookOutlined />
                <span>方正书版小样</span>
                {!compact && <Text type="secondary">解析 · 校验 · 近似排版</Text>}
              </>
            )}
            {area === 'document' && selectedFile && (
              <div className={`${styles.currentFileSummary} ${styles.documentFileSummary}`}>
                <Tooltip title="返回文件清单">
                  <Button type="text" icon={<ArrowLeftOutlined />} aria-label="返回文件清单" onClick={() => setArea('files')} />
                </Tooltip>
                <Text className={styles.currentFileName} strong ellipsis title={selectedFile.name}>{selectedFile.name}</Text>
                {selectedReport.data?.warnings.length ? (
                  <Popover
                    trigger="click"
                    placement="bottomLeft"
                    title={`校验告警（${selectedReport.data.warnings.length}）`}
                    content={(
                      <div className={styles.warningContent}>
                        {selectedReport.data.warnings.map((warning) => (
                          <Alert key={warning} type="warning" showIcon title={warning} />
                        ))}
                      </div>
                    )}
                  >
                    <Button type="text" size="small" className={styles.warningButton}>
                      {selectedReport.data.warnings.length} 条告警
                    </Button>
                  </Popover>
                ) : selectedReport.data ? <Tag color="success">校验无告警</Tag> : null}
              </div>
            )}
          </div>
          <div className={styles.headerActions}>
            {area === 'document' && selectedFile && (
              <>
                <Tooltip title={showResults ? '隐藏解析结果' : '显示解析结果'}>
                  <Button
                    type="text"
                    icon={showResults ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    aria-label={showResults ? '隐藏解析结果' : '显示解析结果'}
                    onClick={() => {
                      const next = !showResults;
                      setShowResults(next);
                      if (compact) setMobilePane(next ? resultView : 'layout');
                    }}
                  />
                </Tooltip>
                <Tooltip title="打印或另存为 PDF">
                  <Button
                    type="text"
                    icon={<PrinterOutlined />}
                    aria-label="打印或另存为 PDF"
                    disabled={!previewQuery.data || previewQuery.isFetching || previewPhase !== 'ready'}
                    onClick={() => previewFrame.current?.contentWindow?.postMessage({ type: 'shuban-print' }, '*')}
                  />
                </Tooltip>
                <Tooltip title="导出 Word">
                  <Button
                    type="text"
                    icon={<DownloadOutlined />}
                    aria-label="导出 Word"
                    href={`/api/shuban/files/${encodeURIComponent(selectedFile.id)}/word`}
                  />
                </Tooltip>
                <Tooltip title="刷新文件与报告">
                  <Button
                    type="text"
                    icon={<ReloadOutlined />}
                    aria-label="刷新文件与报告"
                    onClick={() => {
                      retryPreview();
                    }}
                  />
                </Tooltip>
              </>
            )}
            {area === 'files' && (
              <Button icon={<ReloadOutlined />} loading={filesQuery.isFetching} onClick={() => void filesQuery.refetch()}>
                刷新
              </Button>
            )}
            {area !== 'document' && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setArea('import')}>
                新建预览
              </Button>
            )}
          </div>
        </div>

        <main className={styles.content}>
          {area === 'import' && (
            <section className={styles.page}>
              <div className={styles.pageHeading}>
                <h1>新建预览</h1>
                <p>导入方正书版小样及配套文件，生成结构检查和浏览器近似排版。</p>
              </div>
              <Form layout="vertical">
                <Form.Item label="导入方式">
                  <Select
                    allowClear
                    value={uploadTargetId}
                    placeholder="新建独立文档（同名文件可以并存）"
                    options={files.map((file) => ({ value: file.id, label: `更新：${file.name}（${file.id.slice(0, 6)}）` }))}
                    onChange={setUploadTargetId}
                    disabled={uploadingCount > 0}
                  />
                </Form.Item>
              </Form>
              <Dragger {...uploadProps} className={styles.upload}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">拖放文件到此处，或选择文件</p>
                <p className="ant-upload-hint">支持 .docx 按模板转 FBD、.zip 压缩包、.fbd、同名 .PRO 和版面图片；单个上传文件最大 500 MB。FBD 与配套文件可一并选择；只补充 PRO 或图片时，请先选择要更新的文档。</p>
                <div className={styles.uploadActions}>
                  <Button icon={<PlusOutlined />}>选择文件</Button>
                </div>
                {uploadingCount > 0 && (
                  <div className={styles.progressWrap}>
                    <Progress percent={uploadPercent} status="active" size="small" />
                    <Text type="secondary">正在导入 {uploadingCount} 个文件</Text>
                  </div>
                )}
              </Dragger>
              <Alert
                type="info"
                showIcon
                title="近似排版用于检查内容和版面结构；最终结果以方正书版实际发排为准。"
              />
            </section>
          )}

          {area === 'files' && (
            <section className={styles.filePage}>
              <div className={`${styles.pageHeading} ${styles.filePageHeading}`}>
                <h1>文件清单</h1>
                <p>当前账号已导入的 FBD 文件，共 {files.length} 个。</p>
              </div>
              <div className={styles.fileSearch}>
                <Form<FileSearchValues>
                  form={fileSearchForm}
                  className={styles.fileSearchForm}
                  layout="horizontal"
                  labelCol={{ flex: '80px' }}
                  wrapperCol={{ flex: 'auto' }}
                  onFinish={(values) => {
                    const [start, end] = values.modifiedRange || [];
                    setFileFilters({
                      name: values.name?.trim().toLocaleLowerCase() || '',
                      from: start?.startOf('day').unix(),
                      to: end?.endOf('day').unix(),
                    });
                  }}
                >
                  <div className={styles.fileSearchFields}>
                    <Form.Item name="name" label="文件名称">
                      <Input allowClear placeholder="请输入文件名称" />
                    </Form.Item>
                    <Form.Item name="modifiedRange" label="修改时间">
                      <DatePicker.RangePicker
                        allowEmpty={[true, true]}
                        placeholder={['开始日期', '结束日期']}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </div>
                  <Space className={styles.fileSearchActions}>
                    <Button
                      icon={<UndoOutlined />}
                      onClick={() => {
                        fileSearchForm.resetFields();
                        setFileFilters({ name: '' });
                      }}
                    >
                      重置
                    </Button>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                      查询
                    </Button>
                  </Space>
                </Form>
              </div>
              <div className={styles.fileResults}>
                <div className={styles.fileResultsToolbar}>
                  <div className={styles.fileResultsTitle}>
                    <Text strong>文件清单</Text>
                    <Text type="secondary">共 {filteredFiles.length} 个文件</Text>
                  </div>
                  <Space>
                    <Tooltip title="刷新文件清单">
                      <Button
                        type="text"
                        icon={<ReloadOutlined />}
                        aria-label="刷新文件清单"
                        loading={filesQuery.isFetching}
                        onClick={() => void filesQuery.refetch()}
                      />
                    </Tooltip>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setArea('import')}>
                      导入文件
                    </Button>
                  </Space>
                </div>
                <div className={styles.fileTable}>
                  <Table<ShubanFile>
                    rowKey="id"
                    size="middle"
                    loading={filesQuery.isLoading || filesQuery.isFetching}
                    dataSource={filteredFiles}
                    columns={tableColumns}
                    onRow={(record) => ({ onDoubleClick: () => openFile(record) })}
                    pagination={{ pageSize: 12, showSizeChanger: true, showTotal: (total) => `共 ${total} 个文件` }}
                    locale={{
                      emptyText: <Empty description={fileFilters.name || fileFilters.from || fileFilters.to ? '没有匹配的文件' : '暂无 FBD 文件'} />,
                    }}
                  />
                </div>
              </div>
              {filesQuery.error && <Alert type="error" showIcon title={filesQuery.error.message} style={{ marginTop: 16 }} />}
            </section>
          )}

          {area === 'document' && selectedFile && (
            <section className={styles.document}>
              {compact && showResults && (
                <div className={styles.mobileMode}>
                  <Segmented<MobilePane>
                    block
                    value={mobilePane}
                    options={[
                      { label: '版面预览', value: 'layout' },
                      ...Object.entries(resultLabels).map(([value, label]) => ({ label, value: value as ResultView })),
                    ]}
                    onChange={(value) => {
                      setMobilePane(value);
                      if (value !== 'layout') setResultView(value);
                    }}
                  />
                </div>
              )}
              <div className={styles.panes}>
                {!showResults ? (
                  <PreviewPane
                    file={selectedFile}
                    loading={previewQuery.isFetching}
                    preview={previewQuery.data}
                    error={previewQuery.error?.message}
                    frameRef={previewFrame}
                    phase={previewPhase}
                    status={layoutStatus}
                    attempt={previewAttempt}
                    onStart={onLayoutStart}
                    onTimeout={onLayoutTimeout}
                    onRetry={retryPreview}
                    />
                ) : compact ? (
                  mobilePane === 'layout' ? (
                    <PreviewPane
                      file={selectedFile}
                      loading={previewQuery.isFetching}
                      preview={previewQuery.data}
                      error={previewQuery.error?.message}
                      frameRef={previewFrame}
                      phase={previewPhase}
                      status={layoutStatus}
                      attempt={previewAttempt}
                      onStart={onLayoutStart}
                      onTimeout={onLayoutTimeout}
                      onRetry={retryPreview}
                      />
                  ) : (
                    <div className={styles.pane}>
                      <ResultPanel
                        activeView={resultView}
                        setActiveView={(view) => {
                          setResultView(view);
                          if (compact) setMobilePane(view);
                        }}
                        file={selectedFile}
                        queryKeys={queryKeys}
                        layoutStatus={layoutStatus}
                        previewNotes={previewNotes}
                      />
                    </div>
                  )
                ) : (
                  <Splitter orientation="horizontal">
                    <Splitter.Panel defaultSize="55%" min="34%" max="72%">
                      <PreviewPane
                        file={selectedFile}
                        loading={previewQuery.isFetching}
                        preview={previewQuery.data}
                        error={previewQuery.error?.message}
                        frameRef={previewFrame}
                        phase={previewPhase}
                        status={layoutStatus}
                        attempt={previewAttempt}
                        onStart={onLayoutStart}
                        onTimeout={onLayoutTimeout}
                        onRetry={retryPreview}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel defaultSize="45%" min="28%">
                      <div className={styles.pane}>
                        <ResultPanel
                          activeView={resultView}
                          setActiveView={setResultView}
                          file={selectedFile}
                          queryKeys={queryKeys}
                          layoutStatus={layoutStatus}
                          previewNotes={previewNotes}
                        />
                      </div>
                    </Splitter.Panel>
                  </Splitter>
                )}
              </div>
            </section>
          )}
        </main>
        <Modal
          title="选择 Word 排版模板"
          open={wordModalOpen}
          onCancel={() => {
            if (wordSubmitting) return;
            setWordModalOpen(false);
            setPendingWordFile(undefined);
          }}
          onOk={() => void startWordConversion()}
          okText="开始排版"
          cancelText="取消"
          confirmLoading={wordSubmitting}
          okButtonProps={{ disabled: !pendingWordFile || !wordTemplateId }}
          destroyOnHidden
        >
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Text>{pendingWordFile?.name || '已选择 Word 文档'}</Typography.Text>
            <Form layout="vertical">
              <Form.Item label="版式尺寸" required>
                <Select
                  value={wordTemplateId}
                  loading={wordTemplatesQuery.isLoading}
                  placeholder="选择已有版式模板"
                  options={(wordTemplatesQuery.data?.templates || []).map((template: WordTemplate) => ({
                    value: template.id,
                    label: `${template.name} · ${template.pageWidth}×${template.pageHeight} mm`,
                  }))}
                  onChange={setWordTemplateId}
                  notFoundContent={wordTemplatesQuery.isError ? '模板加载失败' : '暂无可用模板'}
                />
              </Form.Item>
            </Form>
            {(() => {
              const selected = wordTemplatesQuery.data?.templates.find((item) => item.id === wordTemplateId);
              return selected ? (
                <Descriptions size="small" bordered column={1}>
                  <Descriptions.Item label="页面尺寸">{selected.pageWidth}×{selected.pageHeight} mm</Descriptions.Item>
                  <Descriptions.Item label="分栏">{selected.columns} 栏，栏距 {selected.columnGap} mm</Descriptions.Item>
                  <Descriptions.Item label="模板说明">{selected.description}</Descriptions.Item>
                </Descriptions>
              ) : null;
            })()}
            <Alert
              type="info"
              showIcon
              title="转换会保留可识别的文字、表格、公式和图片；浏览器预览为近似排版，最终以方正书版发排为准。"
            />
          </Space>
        </Modal>

        <Modal
          title="Word 排版结果"
          open={wordResultOpen}
          footer={null}
          onCancel={() => setWordResultOpen(false)}
          destroyOnHidden
        >
          {wordResult && (
            <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
              <Descriptions size="small" bordered column={1}>
                <Descriptions.Item label="FBD 文件">{wordResult.fileName}</Descriptions.Item>
                <Descriptions.Item label="使用模板">{wordResult.templateName}</Descriptions.Item>
                <Descriptions.Item label="内容核对">{wordResult.contentVerified ? '通过' : '需要人工核对'}</Descriptions.Item>
              </Descriptions>
              {wordResult.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  title="转换告警"
                  description={(
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {wordResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  )}
                />
              )}
              <Space wrap>
                <Button type="primary" icon={<FileSearchOutlined />} href={wordResult.previewUrl} target="_blank">
                  打开预览
                </Button>
                <Button
                  icon={wordSaved ? <CheckOutlined /> : <SaveOutlined />}
                  loading={wordSaving}
                  disabled={wordSaved}
                  onClick={() => void saveWordTypesetting()}
                >
                  {wordSaved ? '已保存' : '保存排版'}
                </Button>
                <Button icon={<DownloadOutlined />} href={wordResult.downloadUrl}>
                  下载排版 ZIP
                </Button>
              </Space>
              <Typography.Text type="secondary" copyable={{ text: `${window.location.origin}${wordResult.previewUrl}` }}>
                预览地址：{window.location.origin}{wordResult.previewUrl}
              </Typography.Text>
            </Space>
          )}
        </Modal>
      </Layout>
    </Layout>
  );
}

function PreviewPane({
  file, loading, preview, error, frameRef, phase, status, attempt, onStart, onTimeout, onRetry,
}: {
  file: ShubanFile;
  loading: boolean;
  preview?: string;
  error?: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  phase: PreviewPhase;
  status: string;
  attempt: number;
  onStart: () => void;
  onTimeout: () => void;
  onRetry: () => void;
}) {
  const { styles } = useStyles();
  useLayoutEffect(() => {
    onStart();
  }, [file.id, file.version, attempt, preview, loading, onStart]);
  useEffect(() => {
    if (loading || !preview || phase !== 'rendering') return;
    const timer = window.setTimeout(onTimeout, 90000);
    return () => window.clearTimeout(timer);
  }, [loading, preview, phase, onTimeout]);
  const failed = error || (phase === 'error' ? status : undefined);
  return (
    <div className={styles.pane}>
      <div className={styles.paneBody}>
        {!loading && preview && (
          <iframe
            key={`${file.id}:${file.version}:${attempt}`}
            ref={frameRef}
            title={`${file.name} 近似版面`}
            className={styles.previewFrame}
            sandbox="allow-scripts allow-modals"
            srcDoc={preview}
          />
        )}
        {failed ? (
          <div className={styles.previewOverlay}>
            <Alert type="error" showIcon title="预览失败" description={failed} />
            <Button aria-label="重新加载" icon={<ReloadOutlined />} onClick={onRetry}>重新加载</Button>
          </div>
        ) : loading || (preview && phase !== 'ready') ? (
          <div className={styles.previewOverlay} role="status">
            <Spin description={loading ? '正在读取文档…' : '正在加载字体、图片并排版…'} />
          </div>
        ) : !preview ? <Empty description="版面预览暂不可用" /> : null}
      </div>
    </div>
  );
}

import {
  DownloadOutlined,
  ReloadOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@umijs/max';
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import QuestionContentView from '../components/QuestionContentView';
import type { SnapshotQuestion } from '../data';
import { getSnapshot } from '../service';
import { downloadTextFile } from '../utils/exportUtils';

const { Text } = Typography;

function buildQuestionMarkdown(q: SnapshotQuestion): string {
  const lines: string[] = [];
  if (q.questionImageUrl)
    lines.push('【题目图片】', `![](${q.questionImageUrl})`);
  if (q.stemText) lines.push('【题干】', q.stemText);
  for (const url of q.figures || []) lines.push(`![](${url})`);
  for (const text of q.optionTexts || []) lines.push(text);
  for (const text of q.subquestionTexts || []) lines.push(text);
  return lines.join('\n\n');
}

export default function QietiQuestionsPage() {
  const navigate = useNavigate();
  const [activeFile, setActiveFile] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['qieti-snapshot'],
    queryFn: getSnapshot,
  });

  const snapshot = data?.snapshot;

  const visibleQuestions = useMemo(() => {
    const list = snapshot?.questions || [];
    const sorted = list.slice().sort((a, b) => (a.no || 0) - (b.no || 0));
    const byFile =
      activeFile === 'all'
        ? sorted
        : sorted.filter((item) => item.pageId === activeFile);
    const text = keyword.trim();
    if (!text) return byFile;
    return byFile.filter((item) => {
      const source = [
        item.stemText,
        item.fullText,
        ...(item.optionTexts || []),
        ...(item.subquestionTexts || []),
      ]
        .filter(Boolean)
        .join('\n');
      return source.includes(text);
    });
  }, [snapshot, activeFile, keyword]);

  const downloadAll = async () => {
    const all = snapshot?.questions || [];
    if (!all.length || exporting) return;
    setExporting(true);
    try {
      const markdownBlocks = all
        .slice()
        .sort((a, b) => (a.no || 0) - (b.no || 0))
        .map((q, idx) => {
          const source = q.pageName || `第 ${Number(q.pageIndex || 0) + 1} 页`;
          const head = [
            `## 第 ${q.no || idx + 1} 题`,
            `- 题型：${q.type || '未分类'}`,
            `- 来源：${source}`,
          ];
          const body = buildQuestionMarkdown(q);
          return body ? `${head.join('\n')}\n\n${body}` : head.join('\n');
        });
      downloadTextFile(
        markdownBlocks.join('\n\n'),
        `全部题目_${new Date().toISOString().slice(0, 10)}.md`,
        'text/markdown',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageContainer
      title="题目列表"
      subTitle={`共 ${snapshot?.totalQuestions || 0} 题 · 来自云端快照`}
      extra={
        <>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetch()}
            loading={isFetching}
          >
            刷新
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={downloadAll}
            loading={exporting}
            disabled={!snapshot?.questions?.length}
          >
            下载全部题目
          </Button>
          <Button
            type="primary"
            icon={<ScissorOutlined />}
            onClick={() => navigate('/qieti/cut')}
          >
            前往切题
          </Button>
        </>
      }
    >
      <Row gutter={16}>
        <Col xs={24} md={6} lg={5}>
          <Card size="small" title="目录" styles={{ body: { padding: 8 } }}>
            <Button
              block
              type={activeFile === 'all' ? 'primary' : 'text'}
              style={{ justifyContent: 'left', marginBottom: 4 }}
              onClick={() => setActiveFile('all')}
            >
              全部题目（{snapshot?.questions?.length || 0}）
            </Button>
            <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {(snapshot?.files || []).map((file) => (
                <Button
                  key={file.pageId}
                  block
                  type={activeFile === file.pageId ? 'primary' : 'text'}
                  style={{ justifyContent: 'left', textAlign: 'left' }}
                  onClick={() => setActiveFile(file.pageId)}
                  title={file.name}
                >
                  <span
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.name}（{file.questionCount}）
                  </span>
                </Button>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <Link to="/qieti/records">上传记录 →</Link>
            </div>
          </Card>
        </Col>

        <Col xs={24} md={18} lg={19}>
          <Card size="small">
            <Input.Search
              allowClear
              placeholder="输入关键词筛选题干"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ maxWidth: 360 }}
            />
            <Text type="secondary" style={{ marginLeft: 12 }}>
              当前显示 {visibleQuestions.length} 题
            </Text>
          </Card>

          <div style={{ marginTop: 16 }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <Spin tip="加载中..." />
              </div>
            ) : null}
            {!isLoading && !visibleQuestions.length ? (
              <Empty
                description={
                  snapshot
                    ? '当前筛选条件下没有题目'
                    : '暂无云端快照，请先在切题工作台上传并识别题目'
                }
              />
            ) : null}
            {visibleQuestions.map((q, idx) => (
              <Card
                key={q.id || `${q.no}_${idx}`}
                size="small"
                style={{ marginBottom: 12 }}
                hoverable
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <Text strong>
                    第 {q.no || idx + 1} 题 ·{' '}
                    {q.pageName || `第 ${q.pageIndex + 1} 页`}
                  </Text>
                  {q.type ? <Tag color="blue">{q.type}</Tag> : null}
                </div>
                <QuestionContentView
                  mergedImage={q.mergedImage || q.questionImageUrl}
                  stemText={q.stemText}
                  figures={q.figures}
                  optionTexts={q.optionTexts}
                  subquestionTexts={q.subquestionTexts}
                />
              </Card>
            ))}
          </div>
        </Col>
      </Row>
    </PageContainer>
  );
}

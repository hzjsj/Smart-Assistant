import {
  BookOutlined,
  CheckCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Flex,
  Form,
  message,
  Select,
  Slider,
  Space,
  Spin,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { createStyles } from 'antd-style';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BlockMath, InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';

/**
 * 渲染深度思考文本：支持 LaTeX 公式（$...$ 行内、$$...$$ 块级）。
 * 流式生成时公式可能未闭合（$ 只出现一半），此时按纯文本显示，避免 KaTeX 报错。
 */
const renderThinkingText = (text: string) => {
  const nodes: React.ReactNode[] = [];
  let key = 0;

  // 先按块级公式 $$...$$ 拆分
  const blockParts = text.split(/(\$\$[\s\S]*?\$\$)/g);
  for (const part of blockParts) {
    if (!part) continue;
    const blockMatch = part.match(/^\$\$([\s\S]*?)\$\$$/);
    if (blockMatch) {
      // 块级公式：KaTeX 渲染，失败回退纯文本
      try {
        nodes.push(
          <div key={key++} style={{ margin: '4px 0' }}>
            <BlockMath math={blockMatch[1]} />
          </div>,
        );
      } catch {
        nodes.push(<span key={key++}>{part}</span>);
      }
      continue;
    }

    // 行内公式 $...$ 拆分（成对才渲染）
    const inlineParts = part.split(/(\$[^$\n]*?\$)/g);
    for (const ip of inlineParts) {
      if (!ip) continue;
      const inlineMatch = ip.match(/^\$([^$\n]*?)\$$/);
      if (inlineMatch && ip.includes('$')) {
        try {
          nodes.push(<InlineMath key={key++} math={inlineMatch[1]} />);
        } catch {
          nodes.push(<span key={key++}>{ip}</span>);
        }
      } else {
        nodes.push(<span key={key++}>{ip}</span>);
      }
    }
  }

  return nodes;
};
import {
  DEFAULT_QUESTION_TYPES,
  EXAM_TYPES,
  GRADES,
  getSectionTitle,
  SUBJECTS,
} from './constants';
import type { ExamType, QuestionItem, QuestionType, Subject } from './data';
import PdfPreview from './PdfPreview';
import {
  generateQuestionsStream,
  getKnowledgeTree,
  getQuestionTypes,
  saveExam,
} from './service';

const { Text } = Typography;

// ─── Styles (antd token 驱动) ───────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  page: css`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  `,
  body: css`
    flex: 1;
    display: flex;
    gap: ${token.marginMD}px;
    overflow: hidden;
  `,

  // ── Left Panel ──
  leftCard: css`
    width: 380px;
    min-width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    .ant-card-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 0;
    }
  `,
  leftScroll: css`
    flex: 1;
    overflow-y: auto;
    padding: ${token.paddingLG}px;
    padding-bottom: 6px;
    scrollbar-width: none; /* Firefox：隐藏滚动条 */
    -ms-overflow-style: none; /* IE / 旧版 Edge */
    &::-webkit-scrollbar {
      display: none; /* Chrome / Safari / Edge Chromium */
    }
  `,
  leftFooter: css`
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: ${token.marginMD}px;
    padding: ${token.paddingSM}px ${token.paddingLG}px;
    border-top: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
  remainTip: css`
    text-align: center;
    font-size: ${token.fontSizeSM}px;
    color: ${token.colorTextTertiary};
    margin-top: ${token.marginXS}px;
  `,
  customToggle: css`
    margin-top: ${token.marginXXS}px;
    padding: 0;
    height: auto;
  `,

  // ── Right Panel ──
  rightCard: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    .ant-card-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 0;
    }
  `,
  rightScroll: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: ${token.paddingLG}px;
  `,
  rightToolbar: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: ${token.paddingSM}px ${token.paddingLG}px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorFillAlter};
  `,
  rightFooter: css`
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${token.marginMD}px;
    padding: ${token.paddingSM}px ${token.paddingLG}px;
    border-top: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
  emptyWrap: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 320px;
  `,

  // ── Question rendering ──
  sectionTitle: css`
    font-size: ${token.fontSizeLG}px;
    font-weight: 600;
    color: ${token.colorTextHeading};
    margin: ${token.marginLG}px 0 ${token.marginSM}px 0;
    padding-bottom: ${token.paddingXS}px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    &:first-of-type {
      margin-top: 0;
    }
  `,
  sectionCount: css`
    margin-left: ${token.marginSM}px;
    font-size: ${token.fontSizeSM}px;
    font-weight: 400;
    color: ${token.colorTextSecondary};
  `,
  card: css`
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    padding: ${token.paddingSM}px ${token.paddingMD}px;
    margin-bottom: ${token.marginSM}px;
    transition: all 0.2s ease;
    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
      box-shadow: ${token.boxShadowTertiary};
    }
  `,
  cardInner: css`
    display: flex;
    gap: ${token.marginSM}px;
    align-items: flex-start;
  `,
  cardContent: css`
    flex: 1;
    min-width: 0;
  `,
  questionText: css`
    font-size: ${token.fontSize}px;
    line-height: 1.9;
    color: ${token.colorText};
    .katex {
      font-size: 1.05em;
    }
  `,
  questionIndex: css`
    margin-right: ${token.marginXS}px;
    color: ${token.colorTextSecondary};
  `,
  optionsRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${token.marginXS}px ${token.marginLG}px;
    margin-top: ${token.marginXS}px;
  `,
  optionItem: css`
    display: inline-flex;
    align-items: center;
    gap: ${token.marginXS}px;
    font-size: ${token.fontSize}px;
    color: ${token.colorText};
  `,
  optionLabel: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid ${token.colorBorder};
    font-size: ${token.fontSizeSM}px;
    color: ${token.colorTextSecondary};
    flex-shrink: 0;
  `,
  answerBlock: css`
    margin-top: ${token.marginSM}px;
    padding: ${token.paddingSM}px ${token.paddingMD}px;
    background: ${token.colorInfoBg};
    border-left: 3px solid ${token.colorPrimary};
    border-radius: 0 ${token.borderRadiusSM}px ${token.borderRadiusSM}px 0;
    font-size: ${token.fontSizeSM}px;
    color: ${token.colorText};
    line-height: 1.8;
  `,
  answerLabel: css`
    color: ${token.colorPrimary};
    font-weight: 600;
    margin-right: ${token.marginXXS}px;
  `,
  chartBox: css`
    margin-top: ${token.marginSM}px;
    padding: ${token.paddingSM}px;
    background: ${token.colorFillAlter};
    border: 1px dashed ${token.colorBorder};
    border-radius: ${token.borderRadiusSM}px;
    text-align: center;
  `,
}));

// ─── Math Rendering Helper ───────────────────────────────────────────────────
const MathText: React.FC<{ text: string; className?: string }> = ({
  text,
  className,
}) => {
  const parts = useMemo(() => {
    const textStr = typeof text === 'string' ? text : String(text || '');
    const result: React.ReactNode[] = [];
    const blockRegex = /\$\$(.+?)\$\$/g;
    const inlineRegex = /\$(.+?)\$/g;
    let key = 0;

    const blockSplit = textStr.split(blockRegex);
    for (let i = 0; i < blockSplit.length; i++) {
      if (i % 2 === 0) {
        const inlineSplit = blockSplit[i].split(inlineRegex);
        for (let j = 0; j < inlineSplit.length; j++) {
          if (j % 2 === 0) {
            if (inlineSplit[j])
              result.push(<span key={key++}>{inlineSplit[j]}</span>);
          } else {
            try {
              result.push(<InlineMath key={key++} math={inlineSplit[j]} />);
            } catch {
              result.push(<span key={key++}>({inlineSplit[j]})</span>);
            }
          }
        }
      } else {
        try {
          result.push(<BlockMath key={key++} math={blockSplit[i]} />);
        } catch {
          result.push(
            <div key={key++} style={{ textAlign: 'center', margin: '8px 0' }}>
              ({blockSplit[i]})
            </div>,
          );
        }
      }
    }
    return result;
  }, [text]);

  return <span className={className}>{parts}</span>;
};

// ─── SVG Chart Placeholders（已改用 antd 中性色 token） ─────────────────────
const NumberLineChart: React.FC = () => {
  const line = '#1677ff';
  const text = '#8c8c8c';
  return (
    <svg
      role="img"
      aria-label="数轴"
      width="100%"
      height="60"
      viewBox="0 0 400 60"
      style={{ maxWidth: 400 }}
    >
      <line
        x1="30"
        y1="30"
        x2="370"
        y2="30"
        stroke={line}
        strokeWidth="1.5"
        opacity="0.6"
      />
      <polygon points="370,30 362,26 362,34" fill={line} opacity="0.6" />
      {[-1, 0, 1, 2, 3].map((v, i) => {
        const x = 110 + i * 60;
        return (
          <g key={v}>
            <line
              x1={x}
              y1="24"
              x2={x}
              y2="36"
              stroke={line}
              strokeWidth="1"
              opacity="0.5"
            />
            <text x={x} y="50" textAnchor="middle" fill={text} fontSize="11">
              {v}
            </text>
          </g>
        );
      })}
      <line
        x1="50"
        y1="30"
        x2="230"
        y2="30"
        stroke={line}
        strokeWidth="4"
        opacity="0.4"
      />
      <circle
        cx="50"
        cy="30"
        r="4"
        fill="none"
        stroke={line}
        strokeWidth="1.5"
      />
      <circle cx="230" cy="30" r="4" fill={line} />
    </svg>
  );
};

const FunctionChart: React.FC = () => {
  const line = '#1677ff';
  const grid = '#f0f0f0';
  const text = '#8c8c8c';
  return (
    <svg
      role="img"
      aria-label="函数图像"
      width="100%"
      height="140"
      viewBox="0 0 280 140"
      style={{ maxWidth: 280 }}
    >
      {[40, 70, 100, 130].map((y) => (
        <line
          key={`h${y}`}
          x1="20"
          y1={y}
          x2="260"
          y2={y}
          stroke={grid}
          strokeWidth="0.5"
        />
      ))}
      {[60, 100, 140, 180, 220].map((x) => (
        <line
          key={`v${x}`}
          x1={x}
          y1="15"
          x2={x}
          y2="125"
          stroke={grid}
          strokeWidth="0.5"
        />
      ))}
      <line x1="20" y1="70" x2="260" y2="70" stroke={text} strokeWidth="1" />
      <line x1="140" y1="15" x2="140" y2="125" stroke={text} strokeWidth="1" />
      <text x="265" y="74" fill={text} fontSize="10">
        x
      </text>
      <text x="144" y="14" fill={text} fontSize="10">
        y
      </text>
      <path
        d="M 20,25 Q 80,50 140,70 Q 200,90 260,115"
        fill="none"
        stroke={line}
        strokeWidth="2"
      />
      <circle cx="140" cy="70" r="3" fill={line} />
      <text x="146" y="66" fill={line} fontSize="10">
        (2,0)
      </text>
    </svg>
  );
};

const FlowChart: React.FC = () => {
  const line = '#1677ff';
  const stroke = (
    <>
      <line
        x1="80"
        y1="48"
        x2="100"
        y2="48"
        stroke={line}
        strokeWidth="1"
        opacity="0.5"
      />
      <polygon points="100,48 95,44 95,52" fill={line} opacity="0.5" />
    </>
  );
  return (
    <svg
      role="img"
      aria-label="解题流程图"
      width="100%"
      height="100"
      viewBox="0 0 320 100"
      style={{ maxWidth: 320 }}
    >
      <rect
        x="10"
        y="30"
        width="70"
        height="36"
        rx="6"
        fill="none"
        stroke={line}
        strokeWidth="1"
        opacity="0.6"
      />
      <text x="45" y="52" textAnchor="middle" fill={line} fontSize="11">
        设未知数
      </text>
      {stroke}
      <rect
        x="100"
        y="30"
        width="70"
        height="36"
        rx="6"
        fill="none"
        stroke={line}
        strokeWidth="1"
        opacity="0.6"
      />
      <text x="135" y="52" textAnchor="middle" fill={line} fontSize="11">
        列不等式
      </text>
      <line
        x1="170"
        y1="48"
        x2="190"
        y2="48"
        stroke={line}
        strokeWidth="1"
        opacity="0.5"
      />
      <polygon points="190,48 185,44 185,52" fill={line} opacity="0.5" />
      <rect
        x="190"
        y="30"
        width="70"
        height="36"
        rx="6"
        fill="none"
        stroke={line}
        strokeWidth="1"
        opacity="0.6"
      />
      <text x="225" y="52" textAnchor="middle" fill={line} fontSize="11">
        求解作答
      </text>
    </svg>
  );
};

const ChartPlaceholder: React.FC<{
  type: 'numberLine' | 'function' | 'flowChart';
}> = ({ type }) => {
  const { styles } = useStyles();
  const Chart =
    type === 'numberLine'
      ? NumberLineChart
      : type === 'function'
        ? FunctionChart
        : FlowChart;
  return (
    <div className={styles.chartBox}>
      <Chart />
    </div>
  );
};

// ─── Question Card ───────────────────────────────────────────────────────────
const QuestionCard: React.FC<{
  question: QuestionItem;
  index: number;
  selected: boolean;
  showAnswer: boolean;
  onToggle: (id: string) => void;
}> = ({ question, index, selected, showAnswer, onToggle }) => {
  const { styles } = useStyles();

  return (
    <div className={styles.card}>
      <div className={styles.cardInner}>
        <Checkbox
          checked={selected}
          onChange={() => onToggle(question.id)}
          style={{ marginTop: 2 }}
        />
        <div className={styles.cardContent}>
          <div className={styles.questionText}>
            <span className={styles.questionIndex}>{index}.</span>
            <MathText text={question.content} />
          </div>

          {question.options && (
            <div className={styles.optionsRow}>
              {question.options.map((opt) => (
                <div key={opt.label} className={styles.optionItem}>
                  <span className={styles.optionLabel}>{opt.label}</span>
                  <MathText text={opt.content} />
                </div>
              ))}
            </div>
          )}

          {question.hasChart && question.chartType && (
            <ChartPlaceholder type={question.chartType} />
          )}

          {showAnswer && question.answer && (
            <div className={styles.answerBlock}>
              <span className={styles.answerLabel}>答案：</span>
              <MathText text={question.answer} />
              {question.analysis && (
                <>
                  <br />
                  <span className={styles.answerLabel}>解析：</span>
                  <MathText text={question.analysis} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 难度等级辅助 ─────────────────────────────────────────────────────────────
const getDifficultyMeta = (
  difficulty: number,
): { text: string; color: string } => {
  if (difficulty <= 3) return { text: '基础', color: 'success' };
  if (difficulty <= 6) return { text: '中等', color: 'processing' };
  if (difficulty <= 8) return { text: '较难', color: 'warning' };
  return { text: '竞赛难题', color: 'error' };
};

// ─── Main Page ───────────────────────────────────────────────────────────────
const ChuJuanJiPage: React.FC = () => {
  const { styles } = useStyles();
  const [messageApi, contextHolder] = message.useMessage();

  // Form state
  const [subject, setSubject] = useState<Subject>('数学');
  const [grade, setGrade] = useState('初中一年级');
  const [knowledgePoints, setKnowledgePoints] = useState<string[]>([]);
  const [knowledgeTree, setKnowledgeTree] = useState<any[]>([]);
  const [isCustomKP, setIsCustomKP] = useState(false);
  const [questionTypeOptions, setQuestionTypeOptions] = useState<string[]>([]);
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>(
    DEFAULT_QUESTION_TYPES,
  );
  const [quantity, setQuantity] = useState(10);
  const [difficulty, setDifficulty] = useState(5);
  const [examType, setExamType] = useState<ExamType>('期末考试');
  const [showAnswer, setShowAnswer] = useState(true);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [remainCount, setRemainCount] = useState(5);
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  // 深度思考过程（流式累积；生成中展开，完成后折叠）
  const [thinkingText, setThinkingText] = useState('');
  // 深度思考面板展开状态（用户可点击展开/关闭）
  const [thinkExpanded, setThinkExpanded] = useState(true);
  // 是否显示深度思考过程（出题时可关闭）
  const [showThinking, setShowThinking] = useState(true);

  // 获取知识点树和题型列表
  useEffect(() => {
    const fetchData = async () => {
      const tree = await getKnowledgeTree(subject, grade);
      setKnowledgeTree(tree);
      setKnowledgePoints([]);

      const types = await getQuestionTypes(subject, grade);
      setQuestionTypeOptions(types.map((t) => t.name));
      setQuestionTypes([]);
    };
    fetchData();
  }, [subject, grade]);

  // 将知识树的 value 改为名称
  const treeDataWithName = useMemo(() => {
    const convertTree = (nodes: any[]): any[] => {
      return nodes.map((node) => ({
        ...node,
        value: node.title,
        key: node.title,
        children: node.children ? convertTree(node.children) : undefined,
      }));
    };
    return convertTree(knowledgeTree);
  }, [knowledgeTree]);

  const selectedCount = questions.length > 0 ? selectedIds.size : 0;

  const handleGenerate = useCallback(() => {
    if (remainCount <= 0 || generating) return;

    setGenerating(true);
    setQuestions([]);
    setSelectedIds(new Set());
    setThinkingText('');
    setThinkExpanded(true);

    const kpLabel =
      knowledgePoints.length > 0 ? knowledgePoints.join('、') : '';

    const request = {
      subject,
      grade,
      knowledge_point: kpLabel,
      question_types: questionTypes,
      quantity,
      difficulty,
      exam_type: examType,
    };

    generateQuestionsStream(
      request,
      (question: QuestionItem) => {
        setQuestions((prev) => {
          if (prev.some((q) => q.id === question.id)) return prev;
          return [...prev, question];
        });
        setSelectedIds((prev) => new Set([...prev, question.id]));
      },
      async (parsedQuestions: QuestionItem[]) => {
        if (parsedQuestions.length > 0) {
          const title = `${subject}${examType}试卷`;
          const saveResult = await saveExam({
            title,
            subject,
            grade,
            exam_type: examType,
            knowledge_point: kpLabel,
            question_types: questionTypes,
            quantity,
            difficulty,
            questions: parsedQuestions,
          });

          if (saveResult.success) {
            console.log('试卷已保存，ID:', saveResult.id);
          } else {
            console.error('试卷保存失败:', saveResult.error);
          }
        }
        setGenerating(false);
        // 深度思考结束：自动折叠思考面板（用户可点击重新展开查看）
        setThinkExpanded(false);
        setRemainCount((c) => c - 1);
      },
      (error: string) => {
        console.error('生成失败:', error);
        setGenerating(false);
        setThinkExpanded(false);
        messageApi.error(`生成失败：${error}`);
      },
      // 深度思考增量回调：累积思维链文本
      (reasoning: string) => {
        console.log('[DEBUG] onReasoning 收到:', reasoning.slice(0, 30));
        setThinkingText((prev) => prev + reasoning);
      },
    );
  }, [
    remainCount,
    generating,
    subject,
    grade,
    knowledgePoints,
    questionTypes,
    quantity,
    difficulty,
    examType,
    messageApi,
  ]);

  const handleToggleQuestion = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) setSelectedIds(new Set(questions.map((q) => q.id)));
      else setSelectedIds(new Set());
    },
    [questions],
  );

  // Group questions by type
  const groupedQuestions = useMemo(() => {
    const groups: Record<string, QuestionItem[]> = {};
    for (const q of questions) {
      if (!groups[q.type]) groups[q.type] = [];
      groups[q.type].push(q);
    }
    return groups;
  }, [questions]);

  const difficultyMeta = useMemo(
    () => getDifficultyMeta(difficulty),
    [difficulty],
  );

  return (
    <PageContainer
      title={false}
      childrenContentStyle={{
        paddingBlock: 0,
        height: 'calc(100vh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {contextHolder}
      <div className={styles.page}>
        <div className={styles.body}>
          {/* ── 左侧：配置参数 ── */}
          <Card
            className={styles.leftCard}
            title="基于 AI 的智能出卷工具"
            variant="outlined"
          >
            <div className={styles.leftScroll}>
              <Form layout="vertical" colon={false}>
                <Form.Item
                  label={
                    <Space size={6}>
                      <BookOutlined />
                      科目
                    </Space>
                  }
                >
                  <Select
                    value={subject}
                    onChange={setSubject}
                    options={SUBJECTS.map((s) => ({ label: s, value: s }))}
                  />
                </Form.Item>

                <Form.Item
                  label={
                    <Space size={6}>
                      <FileTextOutlined />
                      年级
                    </Space>
                  }
                >
                  <Select
                    value={grade}
                    onChange={setGrade}
                    options={GRADES.map((g) => ({ label: g, value: g }))}
                    showSearch
                  />
                </Form.Item>

                <Form.Item
                  label={
                    <Space size={6}>
                      <RobotOutlined />
                      知识点
                    </Space>
                  }
                  extra={
                    <Space separator=" · " size={0}>
                      <Button
                        type="link"
                        size="small"
                        className={styles.customToggle}
                        icon={<EditOutlined />}
                        onClick={() => setIsCustomKP(!isCustomKP)}
                      >
                        {isCustomKP ? '切换回列表选择' : '手动输入知识点'}
                      </Button>
                      {isCustomKP && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          支持输入任意知识点，不局限于列表
                        </Text>
                      )}
                    </Space>
                  }
                >
                  {!isCustomKP ? (
                    <TreeSelect
                      treeData={treeDataWithName}
                      value={knowledgePoints}
                      onChange={(value) => setKnowledgePoints(value)}
                      treeCheckable
                      showCheckedStrategy={TreeSelect.SHOW_PARENT}
                      placeholder="搜索或选择知识点"
                      maxTagCount={3}
                      maxTagPlaceholder={(omittedValues) =>
                        `+${omittedValues.length}...`
                      }
                      notFoundContent={
                        knowledgeTree.length === 0 ? '加载中...' : '暂无数据'
                      }
                      showSearch
                      filterTreeNode={(inputValue, treeNode) => {
                        return (treeNode.title as string)
                          .toLowerCase()
                          .includes(inputValue.toLowerCase());
                      }}
                      treeNodeFilterProp="title"
                    />
                  ) : (
                    <Select
                      mode="tags"
                      value={knowledgePoints}
                      onChange={(value) => setKnowledgePoints(value)}
                      placeholder="输入知识点，按回车或逗号分隔"
                      tokenSeparators={[',', '，']}
                      maxTagCount={3}
                      maxTagPlaceholder={(omittedValues) =>
                        `+${omittedValues.length}...`
                      }
                    />
                  )}
                </Form.Item>

                <Form.Item
                  label={
                    <Space size={6}>
                      <CheckCircleOutlined />
                      题型
                    </Space>
                  }
                  extra="已选题型将优先显示，未选但生成的题型也会展示"
                >
                  <Select
                    mode="tags"
                    value={questionTypes}
                    onChange={(value) =>
                      setQuestionTypes(value as QuestionType[])
                    }
                    placeholder="选择或输入题型，逗号分隔"
                    options={questionTypeOptions.map((t) => ({
                      label: t,
                      value: t,
                    }))}
                    tokenSeparators={[',', '，']}
                    maxTagCount={3}
                    maxTagPlaceholder={(omittedValues) =>
                      `+${omittedValues.length}...`
                    }
                    notFoundContent={
                      questionTypeOptions.length === 0
                        ? '请先选择科目和年级'
                        : undefined
                    }
                  />
                </Form.Item>

                <Form.Item label={`数量：${quantity} 题`}>
                  <Slider
                    min={1}
                    max={50}
                    value={quantity}
                    onChange={(v) => setQuantity(v)}
                  />
                </Form.Item>

                <Form.Item
                  label={
                    <Space>
                      难度
                      <Tag color={difficultyMeta.color}>
                        {difficulty} · {difficultyMeta.text}
                      </Tag>
                    </Space>
                  }
                >
                  <Slider
                    min={1}
                    max={10}
                    value={difficulty}
                    onChange={(v) => setDifficulty(v)}
                    marks={{ 1: '1', 3: '3', 5: '5', 7: '7', 10: '10' }}
                  />
                </Form.Item>

                <Form.Item
                  label={
                    <Space size={6}>
                      <FileTextOutlined />
                      试卷类型
                    </Space>
                  }
                >
                  <Select
                    value={examType}
                    onChange={setExamType}
                    options={EXAM_TYPES.map((t) => ({ label: t, value: t }))}
                  />
                </Form.Item>
              </Form>
            </div>

            <div className={styles.leftFooter}>
              <Button
                type="primary"
                block
                size="large"
                icon={<ThunderboltOutlined />}
                onClick={handleGenerate}
                loading={generating}
                disabled={generating}
              >
                {generating ? 'AI 生成中...' : '生成题目'}
              </Button>
            </div>
          </Card>

          {/* ── 右侧：题目列表与组卷 ── */}
          <Card className={styles.rightCard} variant="outlined">
            {questions.length > 0 && (
              <div className={styles.rightToolbar}>
                <Space>
                  <Checkbox
                    checked={selectedIds.size === questions.length}
                    indeterminate={
                      selectedIds.size > 0 &&
                      selectedIds.size < questions.length
                    }
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  >
                    全选（{selectedIds.size}/{questions.length}）
                  </Checkbox>
                  <Checkbox
                    checked={showAnswer}
                    onChange={(e) => setShowAnswer(e.target.checked)}
                  >
                    显示答案和解析
                  </Checkbox>
                  <Checkbox
                    checked={showThinking}
                    onChange={(e) => setShowThinking(e.target.checked)}
                  >
                    显示深度思考过程
                  </Checkbox>
                </Space>
                <Text type="secondary">共 {questions.length} 题</Text>
              </div>
            )}

            <div className={styles.rightScroll}>
              {/* 深度思考过程：生成中/完成都可查看，可展开关闭；显示开关控制 */}
              {showThinking && thinkingText && (
                <Collapse
                  ghost
                  size="small"
                  activeKey={thinkExpanded ? ['think'] : []}
                  onChange={(keys) => setThinkExpanded(keys.includes('think'))}
                  style={{ marginBottom: 16 }}
                  items={[
                    {
                      key: 'think',
                      label: generating ? '🤔 深度思考中...' : '💡 深度思考过程',
                      children: (
                        <div
                          style={{
                            whiteSpace: 'pre-wrap',
                            color: 'rgba(0,0,0,0.45)',
                            fontSize: 13,
                            lineHeight: 1.8,
                          }}
                        >
                          {renderThinkingText(thinkingText)}
                        </div>
                      ),
                    },
                  ]}
                />
              )}
              {generating && questions.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <Spin size="large" description="AI 正在生成题目，请稍候...">
                    <div style={{ minHeight: 120, width: 240 }} />
                  </Spin>
                </div>
              ) : questions.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <Flex vertical gap={4} align="center">
                        <Text>尚未生成题目</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          在左侧配置参数后，点击「生成题目」开始
                        </Text>
                      </Flex>
                    }
                  />
                </div>
              ) : (
                <>
                  {generating && (
                    <Alert
                      type="info"
                      showIcon
                      title={`已生成 ${questions.length} 题，继续生成中...`}
                      style={{ marginBottom: 16 }}
                    />
                  )}
                  {(() => {
                    let gi = 0;
                    const typesToShow = questionTypes.filter(
                      (t) => groupedQuestions[t]?.length,
                    );
                    Object.keys(groupedQuestions).forEach((t) => {
                      if (
                        !typesToShow.includes(t as QuestionType) &&
                        groupedQuestions[t]?.length
                      ) {
                        typesToShow.push(t as QuestionType);
                      }
                    });

                    return typesToShow.map((type, index) => (
                      <div key={type}>
                        <div className={styles.sectionTitle}>
                          {getSectionTitle(type, index)}
                          <span className={styles.sectionCount}>
                            （共 {groupedQuestions[type].length} 题）
                          </span>
                        </div>
                        {groupedQuestions[type].map((q) => {
                          gi++;
                          return (
                            <QuestionCard
                              key={q.id}
                              question={q}
                              index={gi}
                              selected={selectedIds.has(q.id)}
                              showAnswer={showAnswer}
                              onToggle={handleToggleQuestion}
                            />
                          );
                        })}
                      </div>
                    ));
                  })()}
                </>
              )}
            </div>

            <div className={styles.rightFooter}>
              <Space size={12}>
                <Text strong>已选 {selectedCount} 题</Text>
                {questions.length > 0 ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    题目已生成，可组卷
                  </Tag>
                ) : (
                  <Text type="secondary">等待生成题目...</Text>
                )}
              </Space>
              <Button
                type="primary"
                disabled={selectedCount === 0}
                onClick={() => setPdfPreviewVisible(true)}
              >
                组卷
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* PDF 预览弹窗 */}
      <PdfPreview
        visible={pdfPreviewVisible}
        onClose={() => setPdfPreviewVisible(false)}
        questions={questions}
        selectedIds={selectedIds}
        showAnswer={showAnswer}
        subject={subject}
        grade={grade}
        examType={examType}
      />
    </PageContainer>
  );
};

export default ChuJuanJiPage;

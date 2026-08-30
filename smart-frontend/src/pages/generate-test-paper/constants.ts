import type {
  ExamType,
  KnowledgePointItem,
  QuestionItem,
  QuestionType,
  Subject,
} from './data';

export const SUBJECTS: Subject[] = [
  '数学',
  '语文',
  '英语',
  '物理',
  '化学',
  '生物',
  '历史',
  '地理',
  '政治',
];

export const GRADES: string[] = [
  '小学一年级',
  '小学二年级',
  '小学三年级',
  '小学四年级',
  '小学五年级',
  '小学六年级',
  '初中一年级',
  '初中二年级',
  '初中三年级',
  '高中一年级',
  '高中二年级',
  '高中三年级',
];

// 所有可用的题型选项（用于下拉选择）
export const ALL_QUESTION_TYPES: QuestionType[] = [
  '单项选择题',
  '选择题',
  '填空题',
  '解答题',
  '应用题',
  '计算题',
  '判断题',
  '多选题',
];

// 默认题型
export const DEFAULT_QUESTION_TYPES: QuestionType[] = ['选择题', '填空题'];

// 题型显示标题映射（动态生成）
export const getSectionTitle = (type: string, index: number): string => {
  const titles: Record<string, string> = {
    单项选择题: '单项选择题',
    选择题: '选择题',
    填空题: '填空题',
    解答题: '解答题',
    应用题: '应用题',
    计算题: '计算题',
    判断题: '判断题',
    多选题: '多选题',
    未知: '其他题目',
  };
  const title = titles[type] || type;
  const prefixes = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const prefix = index < prefixes.length ? prefixes[index] : `${index + 1}`;
  return `${prefix}、${title}`;
};

export const EXAM_TYPES: ExamType[] = [
  '期末考试',
  '随堂小测',
  '单元测试',
  '期中考试',
  '模拟考试',
];

export const KNOWLEDGE_POINTS: KnowledgePointItem[] = [
  {
    label: '一元一次方程：解法与应用',
    value: 'equation-linear',
    testPoints: [
      { label: '一元一次方程解法', value: 'equation-linear-solve' },
      { label: '一元一次方程应用', value: 'equation-linear-app' },
      { label: '等式的基本性质', value: 'equation-property' },
    ],
  },
  {
    label: '整式的加减',
    value: 'polynomial-add-sub',
    testPoints: [
      { label: '整式的加减运算', value: 'polynomial-calc' },
      { label: '合并同类项', value: 'polynomial-merge' },
      { label: '去括号法则', value: 'polynomial-bracket' },
    ],
  },
  {
    label: '一元一次不等式',
    value: 'inequality-linear',
    testPoints: [
      { label: '不等式解法', value: 'inequality-solve' },
      { label: '不等式组', value: 'inequality-group' },
      { label: '不等式应用', value: 'inequality-app' },
    ],
  },
  {
    label: '二元一次方程组',
    value: 'equation-system',
    testPoints: [
      { label: '代入消元法', value: 'equation-substitute' },
      { label: '加减消元法', value: 'equation-eliminate' },
      { label: '方程组应用题', value: 'equation-app' },
    ],
  },
  {
    label: '数据的收集与整理',
    value: 'data-collection',
    testPoints: [
      { label: '频数与频率', value: 'data-freq' },
      { label: '统计图表', value: 'data-chart' },
    ],
  },
  {
    label: '几何图形初步',
    value: 'geometry-intro',
    testPoints: [
      { label: '点线面体', value: 'geo-basics' },
      { label: '角的度量', value: 'geo-angle' },
      { label: '余角与补角', value: 'geo-complement' },
    ],
  },
];

export const MOCK_QUESTIONS: QuestionItem[] = [
  {
    id: 'q1',
    type: '单项选择题',
    content: '解方程 \\frac{x-1}{2} = 3，则 x 的值为',
    options: [
      { label: 'A', content: '5' },
      { label: 'B', content: '7' },
      { label: 'C', content: '-5' },
      { label: 'D', content: '-7' },
    ],
    answer: 'B',
    analysis: '方程两边同乘2，得 x-1=6，解得 x=7。',
  },
  {
    id: 'q2',
    type: '单项选择题',
    content: '已知 |x-2| = 3，则 x 的值为',
    options: [
      { label: 'A', content: '5' },
      { label: 'B', content: '-1' },
      { label: 'C', content: '5 或 -1' },
      { label: 'D', content: '无解' },
    ],
    answer: 'C',
    analysis: '由绝对值的定义，x-2=3 或 x-2=-3，解得 x=5 或 x=-1。',
    hasChart: true,
    chartType: 'numberLine',
  },
  {
    id: 'q3',
    type: '单项选择题',
    content: '下列运算正确的是',
    options: [
      { label: 'A', content: '3a + 2b = 5ab' },
      { label: 'B', content: '3a^2 - a^2 = 2' },
      { label: 'C', content: '3a^2b - 2ba^2 = a^2b' },
      { label: 'D', content: '2a^2 + 3a^2 = 5a^4' },
    ],
    answer: 'C',
    analysis: '合并同类项时，系数相加减，字母和字母的指数不变。',
  },
  {
    id: 'q4',
    type: '单项选择题',
    content: '函数 y = -2x + 4 的图像与 x 轴的交点坐标为',
    options: [
      { label: 'A', content: '(0, 4)' },
      { label: 'B', content: '(2, 0)' },
      { label: 'C', content: '(4, 0)' },
      { label: 'D', content: '(-2, 0)' },
    ],
    answer: 'B',
    analysis: '令 y=0，则 -2x+4=0，解得 x=2，交点为 (2, 0)。',
    hasChart: true,
    chartType: 'function',
  },
  {
    id: 'q5',
    type: '单项选择题',
    content: '不等式 2x - 1 > 3 的解集为',
    options: [
      { label: 'A', content: 'x > 1' },
      { label: 'B', content: 'x > 2' },
      { label: 'C', content: 'x < 2' },
      { label: 'D', content: 'x < 1' },
    ],
    answer: 'B',
    analysis: '移项得 2x > 4，两边同除以2得 x > 2。',
  },
  {
    id: 'q6',
    type: '填空题',
    content:
      '计算：3x^2 - 2x + 1 - (x^2 + 2x - 3) = \\underline{\\hspace{3cm}}',
    answer: '2x^2 - 4x + 4',
    analysis:
      '去括号得 3x^2 - 2x + 1 - x^2 - 2x + 3，合并同类项得 2x^2 - 4x + 4。',
  },
  {
    id: 'q7',
    type: '填空题',
    content: '若 2x + 1 = 7，则 x = \\underline{\\hspace{3cm}}',
    answer: '3',
    analysis: '移项得 2x = 6，解得 x = 3。',
  },
  {
    id: 'q8',
    type: '填空题',
    content:
      '已知 a = 2，b = -1，则 a^2 - 2ab + b^2 的值为 \\underline{\\hspace{3cm}}',
    answer: '9',
    analysis: 'a^2 - 2ab + b^2 = (a-b)^2 = (2-(-1))^2 = 9。',
  },
  {
    id: 'q9',
    type: '填空题',
    content:
      '若关于 x 的方程 3x - k = 0 的解为 x = 2，则 k = \\underline{\\hspace{3cm}}',
    answer: '6',
    analysis: '将 x=2 代入方程得 3 × 2 - k = 0，解得 k = 6。',
  },
  {
    id: 'q10',
    type: '填空题',
    content:
      '不等式组 \\begin{cases} x > -1 \\\\ x \\leq 2 \\end{cases} 的整数解为 \\underline{\\hspace{3cm}}',
    answer: '0, 1, 2',
    analysis: '不等式组的解集为 -1 < x ≤ 2，整数解为 0, 1, 2。',
    hasChart: true,
    chartType: 'numberLine',
  },
  {
    id: 'q11',
    type: '解答题',
    content: '解方程组：\\begin{cases} 2x + y = 5 \\\\ x - y = 1 \\end{cases}',
    answer: 'x = 2, y = 1',
    analysis:
      '由②得 x = y + 1，代入①得 2(y+1) + y = 5，解得 y = 1，回代得 x = 2。',
  },
  {
    id: 'q12',
    type: '解答题',
    content:
      '解不等式组并写出所有整数解：\\begin{cases} 2x + 1 > 0 \\\\ 3x - 2 < 7 \\end{cases}',
    answer: '-1/2 < x < 3，整数解为 0, 1, 2',
    analysis:
      '由①得 x > -1/2，由②得 x < 3，取交集得 -1/2 < x < 3，整数解为 0, 1, 2。',
    hasChart: true,
    chartType: 'numberLine',
  },
  {
    id: 'q13',
    type: '解答题',
    content: '已知 |a - 2| + (b + 3)^2 = 0，求 a^2 - 2b 的值。',
    answer: '10',
    analysis:
      '由非负数性质得 a - 2 = 0，b + 3 = 0，即 a = 2，b = -3。代入得 4 - 2 × (-3) = 10。',
  },
  {
    id: 'q14',
    type: '应用题',
    content:
      '小明有 50 元，买了若干本笔记本，每本 8 元，找回的钱不少于 10 元且不超过 26 元。问小明最多可以买多少本笔记本？最少买多少本？',
    answer: '最多 5 本，最少 3 本',
    analysis: '设买 x 本笔记本，则 10 ≤ 50 - 8x ≤ 26，解得 3 ≤ x ≤ 5。',
    hasChart: true,
    chartType: 'flowChart',
  },
  {
    id: 'q15',
    type: '应用题',
    content:
      '甲乙两车同时从 A 地出发前往 B 地，甲车速度为 60km/h，乙车速度为 80km/h。B 地距 A 地 240km。问乙车比甲车早到多少小时？',
    answer: '1 小时',
    analysis:
      '甲车用时 240/60 = 4 小时，乙车用时 240/80 = 3 小时，早到 1 小时。',
    hasChart: true,
    chartType: 'function',
  },
];

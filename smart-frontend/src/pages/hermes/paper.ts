import type { ExamType, Subject } from '../generate-test-paper/data';

export interface PaperConfig {
  subject: Subject;
  grade: string;
  knowledgePoints: string[];
  questionTypes: string[];
  quantity: number;
  difficulty: number;
  examType: ExamType;
  remarks: string;
}

export const defaultPaperConfig: PaperConfig = {
  subject: '数学',
  grade: '初中一年级',
  knowledgePoints: [],
  questionTypes: [],
  quantity: 30,
  difficulty: 5,
  examType: '期末考试',
  remarks: '',
};

export const normalizePaperTags = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

export const buildPaperSummary = (config: PaperConfig): string => {
  const knowledgePoints = normalizePaperTags(config.knowledgePoints);
  const questionTypes = normalizePaperTags(config.questionTypes);
  return `请根据以下选择生成题库：

【组卷要求】
- 科目：${config.subject}
- 年级：${config.grade}
- 知识点：${knowledgePoints.join('、') || '未指定'}
- 题型：${questionTypes.join('、') || '未指定'}
- 总题数：${config.quantity} 题
- 难度：${config.difficulty}/10
- 试卷类型：${config.examType}
${config.remarks.trim() ? `\n【备注】\n${config.remarks.trim()}` : ''}`.trim();
};

/** Business data only; generation rules are owned by the backend. */
export interface PaperRequestConfig {
  subject: Subject;
  grade: string;
  knowledge_points: string[];
  question_types: string[];
  quantity: number;
  difficulty: number;
  exam_type: ExamType;
  remarks: string;
}

export const copyPaperRequestConfig = (
  config: PaperRequestConfig,
): PaperRequestConfig => ({
  ...config,
  knowledge_points: [...config.knowledge_points],
  question_types: [...config.question_types],
});

export const toPaperRequestConfig = (
  config: PaperConfig,
): PaperRequestConfig => ({
  subject: config.subject,
  grade: config.grade.trim(),
  knowledge_points: normalizePaperTags(config.knowledgePoints),
  question_types: normalizePaperTags(config.questionTypes),
  quantity: config.quantity,
  difficulty: config.difficulty,
  exam_type: config.examType,
  remarks: config.remarks.trim(),
});

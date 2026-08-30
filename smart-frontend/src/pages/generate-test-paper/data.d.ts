export type Subject =
  | '数学'
  | '语文'
  | '英语'
  | '物理'
  | '化学'
  | '生物'
  | '历史'
  | '地理'
  | '政治';

export type QuestionType =
  | '单项选择题'
  | '选择题'
  | '填空题'
  | '解答题'
  | '应用题'
  | '计算题'
  | '判断题'
  | '多选题'
  | '未知';

export type ExamType =
  | '期末考试'
  | '随堂小测'
  | '单元测试'
  | '期中考试'
  | '模拟考试';

export interface TestPointItem {
  label: string;
  value: string;
}

export interface KnowledgePointItem {
  label: string;
  value: string;
  testPoints: TestPointItem[];
}

export interface QuestionOption {
  label: string;
  content: string;
}

export interface QuestionItem {
  id: string;
  type: QuestionType;
  content: string;
  options?: QuestionOption[];
  answer?: string;
  analysis?: string;
  hasChart?: boolean;
  chartType?: 'numberLine' | 'function' | 'flowChart';
}

export interface GenerateRequest {
  subject: Subject;
  grade: string;
  knowledge_point: string;
  test_point?: string;
  question_types: QuestionType[];
  quantity: number;
  difficulty: number;
  exam_type: ExamType;
}

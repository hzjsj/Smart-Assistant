export interface QuestionBankCardData {
  type: 'question_bank';
  version: 1;
  id: string;
  name: string;
  url: string;
  question_count?: number;
  subject?: string;
  grade?: string;
  exam_type?: string;
  difficulty?: number;
}

export interface BankQuestion {
  id: string;
  type: string;
  content: string;
  options: { label: string; content: string }[];
  answer: string;
  analysis: string;
  score: number | null;
  knowledge_points: string[];
  cognitive_level: string;
  difficulty: number | null;
}

export interface QuestionBankDocument {
  type: 'question_bank';
  version: 1;
  id: string;
  title: string;
  subject: string;
  grade: string;
  exam_type: string;
  difficulty: number | null;
  questions: BankQuestion[];
}

export interface QuestionBankResponse {
  id: string;
  question_count: number;
  total_score: number | null;
  document: QuestionBankDocument;
}

export interface PaperResponse extends QuestionBankResponse {
  bank_id: string;
  title: string;
  include_answers: boolean;
}

export interface ExportResponse {
  id: string;
  paper_id: string;
  format: string;
  status: 'generating' | 'ready' | 'failed';
  filename: string;
  download_url: string | null;
  error: string | null;
}

export interface QuestionBankEntry {
  key: string;
  card: QuestionBankCardData;
  bank: QuestionBankResponse;
  selectedIds: string[];
  showAnswers: boolean;
  title: string;
}

export interface QuestionBankReply {
  markdown: string;
  cards: QuestionBankCardData[];
  pending: boolean;
  errors: string[];
}

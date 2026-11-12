import { downloadMessageAttachment } from '../attachments';
import { groupQuestions } from './protocol';
import type {
  ExportResponse,
  PaperResponse,
  QuestionBankCardData,
  QuestionBankEntry,
  QuestionBankResponse,
} from './types';

const API = '/api/hermes/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...init,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    const detail = value.detail;
    throw new Error(
      typeof detail === 'string'
        ? detail
        : response.status === 422
          ? '题库或选题数据校验失败，请检查文件格式'
          : `请求失败（${response.status}）`,
    );
  }
  return value;
}

export function importQuestionBank(
  card: QuestionBankCardData,
  signal?: AbortSignal,
): Promise<QuestionBankResponse> {
  return request('/question-banks/import', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: card.url,
      title: card.name.replace(/\.json$/i, ''),
      subject: card.subject,
      grade: card.grade,
      exam_type: card.exam_type,
      difficulty: card.difficulty,
    }),
  });
}

export function saveQuestionPaper(
  entry: QuestionBankEntry,
): Promise<PaperResponse> {
  const selected = new Set(entry.selectedIds);
  const orderedIds = groupQuestions(entry.bank.document.questions).flatMap(
    ([, questions]) =>
      questions
        .filter((question) => selected.has(question.id))
        .map((question) => question.id),
  );
  return request('/papers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bank_id: entry.bank.id,
      selected_ids: orderedIds,
      title: entry.title.trim(),
      include_answers: entry.showAnswers,
    }),
  });
}

export function createPaperExport(
  id: string,
  format: 'docx' | 'xlsx' | 'json',
): Promise<ExportResponse> {
  return request(`/papers/${encodeURIComponent(id)}/exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  });
}

export function storePaperPdf(id: string, pdf: Blob): Promise<ExportResponse> {
  const body = new FormData();
  body.append('file', pdf, 'paper.pdf');
  return request(`/papers/${encodeURIComponent(id)}/exports/pdf`, {
    method: 'POST',
    body,
  });
}

export function downloadExport(file: ExportResponse) {
  if (!file.download_url || file.status !== 'ready')
    throw new Error(file.error || '文件尚未生成');
  return downloadMessageAttachment({
    url: file.download_url,
    name: file.filename,
    extension: file.format,
    label: '试卷文件',
    icon: 'default',
  });
}

export async function downloadQuestionBank(card: QuestionBankCardData) {
  const bank = await importQuestionBank(card);
  return downloadMessageAttachment({
    url: `${API}/question-banks/${bank.id}/download`,
    name: card.name,
    extension: 'json',
    label: '题库 JSON',
    icon: 'default',
  });
}

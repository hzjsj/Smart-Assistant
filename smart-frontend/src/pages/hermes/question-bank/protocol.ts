import type {
  BankQuestion,
  QuestionBankCardData,
  QuestionBankReply,
} from './types';

export function validateQuestionBankCard(value: unknown): QuestionBankCardData {
  if (!value || typeof value !== 'object')
    throw new Error('题库卡片必须是 JSON 对象');
  const card = value as Record<string, unknown>;
  if (card.type !== 'question_bank' || card.version !== 1)
    throw new Error('不支持的题库卡片类型或版本');
  for (const key of ['id', 'name', 'url'] as const) {
    if (
      typeof card[key] !== 'string' ||
      !card[key].trim() ||
      card[key].length > (key === 'url' ? 10000 : 300)
    )
      throw new Error(`题库卡片缺少有效的 ${key}`);
  }
  const url = new URL(card.url as string);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('题库必须提供 HTTP/HTTPS 文件地址');
  if (
    card.question_count !== undefined &&
    (!Number.isInteger(card.question_count) ||
      Number(card.question_count) < 1 ||
      Number(card.question_count) > 500)
  )
    throw new Error('题库声明的题数必须在 1～500 之间');
  for (const key of ['subject', 'grade', 'exam_type'] as const) {
    if (card[key] !== undefined && typeof card[key] !== 'string')
      throw new Error(`${key} 必须是文字`);
  }
  if (
    card.difficulty !== undefined &&
    (typeof card.difficulty !== 'number' ||
      card.difficulty < 1 ||
      card.difficulty > 10)
  )
    throw new Error('题库难度必须在 1～10 之间');
  return {
    type: 'question_bank',
    version: 1,
    id: card.id as string,
    name: (card.name as string).toLowerCase().endsWith('.json')
      ? (card.name as string)
      : `${card.name}.json`,
    url: url.href,
    ...(card.question_count !== undefined
      ? { question_count: Number(card.question_count) }
      : {}),
    ...(typeof card.subject === 'string' ? { subject: card.subject } : {}),
    ...(typeof card.grade === 'string' ? { grade: card.grade } : {}),
    ...(typeof card.exam_type === 'string'
      ? { exam_type: card.exam_type }
      : {}),
    ...(typeof card.difficulty === 'number'
      ? { difficulty: card.difficulty }
      : {}),
  };
}

/** Dedicated fenced blocks only; ordinary JSON and code examples stay Markdown. */
export function parseQuestionBankReply(content: string): QuestionBankReply {
  const result: QuestionBankReply = {
    markdown: '',
    cards: [],
    pending: false,
    errors: [],
  };
  const lines = content.split('\n');
  let ordinaryFence = '';
  let collecting: string[] | null = null;
  for (const line of lines) {
    if (collecting) {
      if (/^\s*```\s*$/.test(line)) {
        try {
          const card = validateQuestionBankCard(
            JSON.parse(collecting.join('\n')),
          );
          if (
            !result.cards.some(
              (existing) =>
                existing.id === card.id && existing.url === card.url,
            )
          )
            result.cards.push(card);
        } catch (error) {
          result.errors.push(
            error instanceof Error ? error.message : '题库卡片格式不正确',
          );
        }
        collecting = null;
      } else collecting.push(line);
      continue;
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    const trimmed = line.trim();
    const opening =
      /^```q/.test(trimmed) &&
      ['```question-bank', '```question_bank'].some((marker) =>
        marker.startsWith(trimmed),
      );
    if (
      !ordinaryFence &&
      (/^\s*```(?:question-bank|question_bank)\s*$/.test(line) || opening)
    ) {
      collecting = [];
      continue;
    }
    if (fence) {
      if (!ordinaryFence) ordinaryFence = fence[1];
      else if (
        fence[1][0] === ordinaryFence[0] &&
        fence[1].length >= ordinaryFence.length &&
        !fence[2].trim()
      )
        ordinaryFence = '';
    }
    result.markdown += `${result.markdown ? '\n' : ''}${line}`;
  }
  result.pending = collecting !== null;
  return result;
}

export function groupQuestions(
  questions: BankQuestion[],
): [string, BankQuestion[]][] {
  const groups = new Map<string, BankQuestion[]>();
  for (const question of questions) {
    const group = groups.get(question.type) || [];
    group.push(question);
    groups.set(question.type, group);
  }
  return [...groups];
}

export function totalScore(
  questions: readonly Pick<BankQuestion, 'score'>[],
): number | null {
  if (questions.some((question) => question.score === null)) return null;
  return (
    Math.round(
      questions.reduce((sum, question) => sum + (question.score || 0), 0) * 1e6,
    ) / 1e6
  );
}

function chineseSectionNumber(value: number): string {
  const digits = '零一二三四五六七八九';
  let result = '';
  let zero = false;
  for (const [unit, label] of [
    [100, '百'],
    [10, '十'],
    [1, ''],
  ] as const) {
    const digit = Math.floor(value / unit);
    value %= unit;
    if (digit) {
      if (zero) result += '零';
      if (!(unit === 10 && digit === 1 && !result)) result += digits[digit];
      result += label;
      zero = false;
    } else if (result && value) zero = true;
  }
  return result;
}

export function questionSectionHeading(
  type: string,
  questions: readonly Pick<BankQuestion, 'score'>[],
  sectionIndex: number,
): string {
  const total = totalScore(questions);
  const sameScore =
    questions.length > 0 &&
    questions.every((question) => question.score === questions[0].score);
  const detail =
    total === null
      ? '部分小题未标注分值'
      : sameScore
        ? `每小题${questions[0].score}分，满分${total}分`
        : `各小题分值不等，满分${total}分`;
  return `${chineseSectionNumber(sectionIndex + 1)}、${type}（本大题共${questions.length}小题，${detail}）`;
}

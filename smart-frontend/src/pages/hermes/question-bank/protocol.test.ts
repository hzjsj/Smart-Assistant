import { expect, it } from 'vitest';
import {
  parseQuestionBankReply,
  questionSectionHeading,
  validateQuestionBankCard,
} from './protocol';

const cardFixture = {
  type: 'question_bank',
  version: 1,
  id: 'bank-1',
  name: '数学题库.json',
  url: 'https://files.example.com/bank.json?sig=a%2Bb',
  question_count: 2,
  subject: '数学',
  grade: '初中一年级',
};

it('extracts only dedicated bank blocks and preserves signed URLs', () => {
  const value = parseQuestionBankReply(
    `已生成题库。\n\n\`\`\`question-bank\n${JSON.stringify(cardFixture)}\n\`\`\`\n点击查看。`,
  );
  expect(value.cards).toHaveLength(1);
  expect(value.cards[0].url).toContain('sig=a%2Bb');
  expect(value.markdown).not.toContain('question_count');
  expect(value.markdown).toContain('点击查看');
  expect(value.pending).toBe(false);
});

it('buffers incomplete JSON and reports invalid or unknown bank versions', () => {
  const incomplete = parseQuestionBankReply(
    '说明\n```question-bank\n{"type":"question_bank",',
  );
  expect(incomplete.markdown).toBe('说明');
  expect(incomplete.pending).toBe(true);
  expect(incomplete.cards).toEqual([]);
  expect(
    parseQuestionBankReply('```question-bank\nnot json\n```').errors,
  ).toHaveLength(1);
  expect(() =>
    validateQuestionBankCard({ ...cardFixture, version: 2 }),
  ).toThrow();
  expect(() =>
    validateQuestionBankCard({ ...cardFixture, url: 'javascript:alert(1)' }),
  ).toThrow();
});

it('does not interpret examples nested inside longer code fences', () => {
  const example = `\`\`\`\`markdown\n\`\`\`question-bank\n${JSON.stringify(cardFixture)}\n\`\`\`\n\`\`\`\``;
  const parsed = parseQuestionBankReply(example);
  expect(parsed.cards).toEqual([]);
  expect(parsed.markdown).toBe(example);
});

it('summarizes real section counts and uniform scores using exam headings', () => {
  expect(
    questionSectionHeading(
      '选择题',
      Array.from({ length: 8 }, () => ({ score: 4 })),
      0,
    ),
  ).toBe('一、选择题（本大题共8小题，每小题4分，满分32分）');
  expect(
    questionSectionHeading(
      '填空题',
      Array.from({ length: 4 }, () => ({ score: 5 })),
      1,
    ),
  ).toBe('二、填空题（本大题共4小题，每小题5分，满分20分）');
  expect(
    questionSectionHeading('计算题', [{ score: 0.1 }, { score: 0.2 }], 9),
  ).toBe('十、计算题（本大题共2小题，各小题分值不等，满分0.3分）');
});

it('does not invent equal scores or totals when section scores vary or are missing', () => {
  expect(
    questionSectionHeading('解答题', [{ score: 3 }, { score: 7 }], 0),
  ).toBe('一、解答题（本大题共2小题，各小题分值不等，满分10分）');
  expect(
    questionSectionHeading('解答题', [{ score: 3 }, { score: null }], 0),
  ).toBe('一、解答题（本大题共2小题，部分小题未标注分值）');
  expect(questionSectionHeading('填空题', [{ score: 0 }], 100)).toBe(
    '一百零一、填空题（本大题共1小题，每小题0分，满分0分）',
  );
});

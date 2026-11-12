import { expect, it } from 'vitest';
import {
  buildPaperSummary,
  copyPaperRequestConfig,
  defaultPaperConfig,
  normalizePaperTags,
  toPaperRequestConfig,
} from './paper';

it('shows only the selected form values and remarks in the user message', () => {
  const prompt = buildPaperSummary({
    ...defaultPaperConfig,
    subject: '物理',
    grade: '初中三年级',
    knowledgePoints: [' 电路 ', '欧姆定律', '电路', ' '],
    questionTypes: ['选择题', '实验探究题'],
    quantity: 12,
    difficulty: 8,
    examType: '模拟考试',
    remarks: '  考试时长 90 分钟\n侧重实验探究  ',
  });
  for (const text of [
    '物理',
    '初中三年级',
    '电路、欧姆定律',
    '选择题、实验探究题',
    '12 题',
    '8/10',
    '模拟考试',
  ]) {
    expect(prompt).toContain(text);
  }
  expect(prompt).not.toContain('电路、欧姆定律、电路');
  expect(prompt).toContain('【备注】\n考试时长 90 分钟\n侧重实验探究');
  for (const internal of [
    'question-bank',
    'question_bank',
    '实际执行与文件发布',
    '题目数据要求',
    '最终回复格式',
    '组卷文件交付',
  ]) {
    expect(prompt).not.toContain(internal);
  }
});

it('gives explicit defaults for optional empty knowledge and question types', () => {
  const prompt = buildPaperSummary(defaultPaperConfig);
  expect(prompt).toContain('知识点：未指定');
  expect(prompt).toContain('题型：未指定');
  expect(prompt).not.toContain('【备注】');
  expect(normalizePaperTags([' ', ' 自定义题型 ', '自定义题型'])).toEqual([
    '自定义题型',
  ]);
});

it('takes independent normalized snapshots for requests and retries', () => {
  const form = {
    ...defaultPaperConfig,
    knowledgePoints: [' 数与式 ', '数与式'],
    questionTypes: ['填空题'],
    quantity: 9,
    remarks: ' 测试要求 ',
  };
  const payload = toPaperRequestConfig(form);
  const copy = copyPaperRequestConfig(payload);
  form.knowledgePoints.push('函数');
  payload.question_types.push('计算题');
  expect(payload.knowledge_points).toEqual(['数与式']);
  expect(copy.question_types).toEqual(['填空题']);
  expect(copy.quantity).toBe(9);
  expect(copy.remarks).toBe('测试要求');
});

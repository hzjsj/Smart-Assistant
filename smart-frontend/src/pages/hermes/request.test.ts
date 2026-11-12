import { expect, it, vi } from 'vitest';
import type { HermesMessage } from './data';
import { HermesChatProvider } from './HermesChatProvider';
import { defaultPaperConfig, toPaperRequestConfig } from './paper';
import { buildRetryParams } from './request';

const message = (
  role: HermesMessage['role'],
  content: string,
): HermesMessage => ({ role, content, activities: [] });
const provider = () =>
  new HermesChatProvider({
    request: {
      manual: true,
      options: {},
      run: vi.fn(),
    } as unknown as HermesChatProvider['request'],
  });

it('sends form configuration only for that request and stores an independent user snapshot', () => {
  const chat = provider();
  const config = toPaperRequestConfig({
    ...defaultPaperConfig,
    quantity: 9,
    knowledgePoints: ['数与式'],
  });
  const formRequest = {
    task: 'question_bank' as const,
    paper_config: config,
    messages: [{ role: 'user', content: '表单摘要' }],
  };
  const local = chat.transformLocalMessage(formRequest);
  config.quantity = 20;
  config.knowledge_points.push('函数');
  expect(local[0].paperConfig?.quantity).toBe(9);
  expect(local[0].paperConfig?.knowledge_points).toEqual(['数与式']);
  chat.injectGetMessages(() => [
    ...local,
    message('assistant', '题库卡片'),
    message('user', '请解释第2题'),
  ]);
  const followup = chat.transformParams(
    { messages: [{ role: 'user', content: '请解释第2题' }] },
    { params: formRequest },
  );
  expect(followup.task).toBe('chat');
  expect(followup).not.toHaveProperty('paper_config');
  expect(followup.messages?.map((item) => item.content)).toEqual([
    '表单摘要',
    '题库卡片',
    '请解释第2题',
  ]);
  expect(followup.messages?.[0]).not.toHaveProperty('paperConfig');
  expect(
    chat.transformLocalMessage({
      messages: [{ role: 'user', content: '正常聊天' }],
    })[0],
  ).not.toHaveProperty('paperConfig');
});

it('retries the selected reply with its original form and excludes later history', () => {
  const chat = provider();
  const form = {
    ...message('user', '表单摘要'),
    paperConfig: toPaperRequestConfig({ ...defaultPaperConfig, quantity: 9 }),
  };
  const history = [
    { id: 'form', message: form },
    { id: 'generated', message: message('assistant', '题库卡片') },
    { id: 'followup', message: message('user', '请解释第2题') },
    { id: 'answer', message: message('assistant', '普通回答') },
  ];
  chat.injectGetMessages(() => history.map((item) => item.message));
  const request = chat.transformParams(
    buildRetryParams(history, 'generated'),
    {},
  );
  expect(request.task).toBe('question_bank');
  expect(request.paper_config?.quantity).toBe(9);
  expect(request.messages).toEqual([{ role: 'user', content: '表单摘要' }]);
  expect(request).not.toHaveProperty('retryHistory');
  const followup = chat.transformParams(
    buildRetryParams(history, 'answer'),
    {},
  );
  expect(followup.task).toBe('chat');
  expect(followup).not.toHaveProperty('paper_config');
  expect(followup.messages?.at(-1)?.content).toBe('请解释第2题');
});

it('starts a separate provider with clean chat defaults', () => {
  const chat = provider();
  chat.injectGetMessages(() => [message('user', '你好')]);
  const request = chat.transformParams({}, {});
  expect(request.task).toBe('chat');
  expect(request).not.toHaveProperty('paper_config');
  expect(request.messages).toEqual([{ role: 'user', content: '你好' }]);
});

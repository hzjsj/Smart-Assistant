// 原测试要求 jsdom 环境（antd Select 可访问名称在 happy-dom 下不稳定）
// @vitest-environment jsdom

import { MessageChannel } from 'node:worker_threads';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import * as React from 'react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const { useState } = React;

import {
  getKnowledgeTree,
  getQuestionTypes,
} from '../../generate-test-paper/service';
import { defaultPaperConfig } from '../paper';
import PaperForm from './PaperForm';

vi.mock('../../generate-test-paper/service', () => ({
  getKnowledgeTree: vi.fn(),
  getQuestionTypes: vi.fn(),
}));
vi.mock('../style', () => ({ useStyles: () => ({ styles: {} }) }));

const channels: {
  port1: { close: () => void };
  port2: { close: () => void };
}[] = [];
const originalMessageChannel = Object.getOwnPropertyDescriptor(
  globalThis,
  'MessageChannel',
);
class TestMessageChannel extends MessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
}

const Harness = ({ onChange }: { onChange: (value: object) => void }) => {
  const [value, setValue] = useState({
    ...defaultPaperConfig,
    knowledgePoints: ['方程'],
    questionTypes: ['选择题'],
  });
  return (
    <PaperForm
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      onSubmit={vi.fn()}
      busy={false}
    />
  );
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'MessageChannel', {
    value: TestMessageChannel,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.mocked(getKnowledgeTree).mockReset().mockResolvedValue([]);
  vi.mocked(getQuestionTypes).mockReset().mockResolvedValue([]);
});

afterAll(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  if (originalMessageChannel)
    Object.defineProperty(globalThis, 'MessageChannel', originalMessageChannel);
  else Reflect.deleteProperty(globalThis, 'MessageChannel');
});

it('submits defaults and keeps the same form available when busy', async () => {
  const submit = vi.fn();
  const { rerender } = render(
    <PaperForm
      value={defaultPaperConfig}
      onChange={vi.fn()}
      onSubmit={submit}
      busy
    />,
  );
  await waitFor(() =>
    expect(getKnowledgeTree).toHaveBeenCalledWith('数学', '初中一年级'),
  );
  expect(
    (screen.getByRole('button', { name: /生成试卷/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /生成试卷/ }));
  expect(submit).not.toHaveBeenCalled();
  rerender(
    <PaperForm
      value={defaultPaperConfig}
      onChange={vi.fn()}
      onSubmit={submit}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /生成试卷/ }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(defaultPaperConfig));
});

it('clears dependent selections and ignores stale option responses', async () => {
  let resolveOld: (
    value: {
      id: string;
      name: string;
      type_category: string;
      answer_gap: number;
    }[],
  ) => void = () => {};
  vi.mocked(getQuestionTypes).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  vi.mocked(getQuestionTypes).mockResolvedValue([
    { id: 'new', name: '实验题', type_category: '', answer_gap: 0 },
  ]);
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /科目/ }));
  fireEvent.click(
    await screen.findByText('物理', {
      selector: '.ant-select-item-option-content',
    }),
  );
  await waitFor(() =>
    expect(getQuestionTypes).toHaveBeenLastCalledWith('物理', '初中一年级'),
  );
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      subject: '物理',
      knowledgePoints: [],
      questionTypes: [],
    }),
  );
  await act(async () => {
    resolveOld([
      { id: 'old', name: '过期题型', type_category: '', answer_gap: 0 },
    ]);
  });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /题型/ }));
  expect(
    await screen.findByText('实验题', {
      selector: '.ant-select-item-option-content',
    }),
  ).toBeTruthy();
  expect(screen.queryByText('过期题型')).toBeNull();
});

it('uses matching tree identities and submits knowledge names instead of IDs', async () => {
  vi.mocked(getKnowledgeTree).mockResolvedValue([
    { key: '8262', value: '8262', title: '数与式' },
    { key: '8372', value: '8372', title: '方程与不等式' },
  ]);
  const errors = vi.spyOn(console, 'error');
  const submit = vi.fn();
  try {
    render(
      <PaperForm
        value={defaultPaperConfig}
        onChange={vi.fn()}
        onSubmit={submit}
        busy={false}
      />,
    );
    await waitFor(() => expect(getKnowledgeTree).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /知识点/ }));
    const title = await screen.findByText('数与式', {
      selector: '.ant-select-tree-title',
    });
    const checkbox = title
      .closest('.ant-select-tree-treenode')
      ?.querySelector('.ant-select-tree-checkbox');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox as Element);
    fireEvent.click(screen.getByRole('button', { name: /生成试卷/ }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ knowledgePoints: ['数与式'] }),
      ),
    );
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(
      /TreeNode|Tree missing follow keys/,
    );
  } finally {
    errors.mockRestore();
  }
});

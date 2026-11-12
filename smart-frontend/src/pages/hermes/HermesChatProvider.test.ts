import { expect, it } from 'vitest';
import type { HermesMessage } from './data';
import {
  finalizeHermesMessage,
  HermesChatProvider,
} from './HermesChatProvider';

const createStream = () => {
  let message: HermesMessage | undefined;
  const send = (payload: unknown, event = '') => {
    message = HermesChatProvider.prototype.transformMessage({
      originMessage: message,
      chunk: { data: JSON.stringify(payload), event },
      chunks: [],
      status: 'updating',
      responseHeaders: {} as Headers,
    });
    return message;
  };
  return {
    think: (text: string) =>
      send({ choices: [{ delta: { reasoning_content: text } }] }),
    answer: (text: string) => send({ choices: [{ delta: { content: text } }] }),
    tool: (id: string, status = 'running', event = 'hermes.tool.progress') =>
      send({ tool: 'terminal', toolCallId: id, status }, event),
  };
};

it('keeps initial and per-tool reasoning separate across repeated tool names', () => {
  const stream = createStream();
  stream.think('initial');
  stream.tool('a');
  stream.tool('a', 'completed');
  stream.think('after A');
  stream.think(' continued');
  stream.tool('b');
  stream.tool('b', 'completed');
  stream.think('after B');
  const message = stream.answer('answer');

  expect(message.activities.map((activity) => activity.type)).toEqual([
    'reasoning',
    'tool',
    'reasoning',
    'tool',
    'reasoning',
  ]);
  expect(
    message.activities.filter((activity) => activity.type === 'reasoning'),
  ).toEqual([
    expect.objectContaining({ text: 'initial', status: 'done' }),
    expect.objectContaining({
      text: 'after A continued',
      toolKey: 'tool:a',
      status: 'done',
    }),
    expect.objectContaining({
      text: 'after B',
      toolKey: 'tool:b',
      status: 'done',
    }),
  ]);
});

it('updates a late tool completion in place without closing live reasoning', () => {
  const stream = createStream();
  stream.tool('a');
  stream.think('first');
  stream.tool('a', 'completed');
  const message = stream.think(' second');

  expect(message.activities).toEqual([
    expect.objectContaining({ type: 'tool', status: 'completed' }),
    expect.objectContaining({
      text: 'first second',
      status: 'active',
      toolKey: 'tool:a',
    }),
  ]);
});

it('keeps ambiguous reasoning independent after overlapping tools', () => {
  const stream = createStream();
  stream.tool('a');
  stream.tool('b');
  stream.tool('a', 'completed');
  stream.tool('b', 'completed');
  const message = stream.think('shared phase');
  const reasoning = message.activities.at(-1);

  expect(reasoning).toMatchObject({ isStageReasoning: true, status: 'active' });
  expect(reasoning).not.toHaveProperty('toolKey');
});

it('starts a fresh active reasoning block after answer text', () => {
  const stream = createStream();
  stream.think('before');
  stream.answer('interim answer');
  const message = stream.think('next response');

  expect(message.activities).toEqual([
    expect.objectContaining({ text: 'before', status: 'done' }),
    expect.objectContaining({ text: 'next response', status: 'active' }),
  ]);
  expect(
    finalizeHermesMessage(message, 'abort').activities.at(-1),
  ).toMatchObject({ text: 'next response', status: 'abort' });
});

it('remembers tool overlap even when both completions arrive before reasoning', () => {
  const stream = createStream();
  stream.tool('a');
  stream.think('while A is running');
  stream.tool('b');
  stream.tool('b', 'completed');
  stream.tool('a', 'completed');
  const message = stream.think('review both tools');

  expect(message.activities.at(-1)).toMatchObject({ isStageReasoning: true });
  expect(message.activities.at(-1)).not.toHaveProperty('toolKey');
});

it.each([
  ['error', 'error'],
  ['failed', 'error'],
  ['abort', 'abort'],
  ['cancelled', 'abort'],
  ['completed', 'completed'],
])('keeps tool status %s terminal for both supported event names', (incoming, expected) => {
  for (const event of ['hermes.tool.progress', 'tool.progress']) {
    const stream = createStream();
    stream.tool('a', 'running', event);
    const terminal = stream.tool('a', incoming, event);
    expect(terminal.activities[0]).toMatchObject({
      type: 'tool',
      status: expected,
    });
    const lateProgress = stream.tool('a', 'running', event);
    expect(lateProgress.activities[0]).toMatchObject({ status: expected });
    expect(
      finalizeHermesMessage(lateProgress, 'done').activities[0],
    ).toMatchObject({ status: expected });
  }
});

it('preserves a late failure instead of changing it back to success', () => {
  const stream = createStream();
  stream.tool('a', 'completed');
  stream.tool('a', 'error');
  expect(stream.tool('a', 'completed').activities[0]).toMatchObject({
    status: 'error',
  });
});

import { expect, test } from 'vitest';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createCrewAgent } from '../src/create-agent.js';

test('executes todo_create and exposes its actual result in the canonical transcript', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const calls: string[] = [];
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('todo_create', { title: 'Изучить pi' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('Задача создана'),
  ]);
  const agent = createCrewAgent({
    models, model: faux.getModel(), messages: [], runId: 'r', chatId: 'c',
    todos: { apply: (_context, name) => { calls.push(name); return { id: 't', title: 'Изучить pi' }; } },
    requireTodoRefresh: false, onEvent: async () => {}, onTurnLimit: () => {},
  });
  expect(agent.state.tools.map(t => t.name)).toEqual(['todo_create', 'todo_list', 'todo_update', 'todo_delete']);
  expect(agent.state.messages[0]?.role).toBe('system');
  await agent.prompt('Создай задачу');
  expect(calls).toEqual(['todo_create']);
  expect(agent.state.messages.filter(m => m.role === 'system')).toHaveLength(1);
  expect(agent.state.messages.find(m => m.role === 'toolResult')).toMatchObject({
    isError: false, content: [{ type: 'text', text: '{"id":"t","title":"Изучить pi"}' }],
    details: { id: 't', title: 'Изучить pi' },
  });
  expect(faux.state.callCount).toBe(2);
});

import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { FauxResponseStep } from '@earendil-works/pi-ai';
import type { TodoPort } from '../src/todo-port.js';
import { createTodoTools } from '../src/tools/todos.js';

function setup(responses: FauxResponseStep[], todos: TodoPort, overrides: {
  requireTodoRefresh?: boolean; messages?: AgentMessage[];
  onEvent?: (event: AgentEvent, signal: AbortSignal) => Promise<void>;
  onTurnLimit?: () => void;
} = {}) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const agent = createCrewAgent({ models, model: faux.getModel(), messages: [],
    runId: 'run', chatId: 'chat', todos, requireTodoRefresh: false,
    onEvent: async () => {}, onTurnLimit: () => {}, ...overrides });
  return { agent, faux };
}
const toolTurn = (name: string, args: Record<string, unknown>, id: string) =>
  fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: 'toolUse' });
const toolResults = (messages: AgentMessage[]) => messages.filter(m => m.role === 'toolResult');

test('executes each call before starting the next including awaited result events', async () => {
  const order: string[] = [];
  const contexts: unknown[] = [];
  const { agent } = setup([
    fauxAssistantMessage([
      fauxToolCall('todo_create', { title: 'first' }, { id: 'one' }),
      fauxToolCall('todo_create', { title: 'second' }, { id: 'two' }),
    ], { stopReason: 'toolUse' }), fauxAssistantMessage('done'),
  ], { apply: (context, _name, input, signal) => {
    contexts.push(context); expect(signal).toBeInstanceOf(AbortSignal);
    order.push((input as { title: string }).title); return { id: context.toolCallId };
  } }, { onEvent: async event => {
    if (event.type === 'tool_execution_end') {
      await new Promise(resolve => setTimeout(resolve, 1));
      order.push(`end:${event.toolCallId}`);
    }
  } });
  await agent.prompt('create two');
  expect(order).toEqual(['first', 'end:one', 'second', 'end:two']);
  expect(contexts).toEqual([
    { chatId: 'chat', runId: 'run', toolCallId: 'one' },
    { chatId: 'chat', runId: 'run', toolCallId: 'two' },
  ]);
});

test('rejects unknown tools without entering the todo port', async () => {
  let calls = 0;
  const { agent } = setup([toolTurn('shell', { command: 'pwd' }, 'unknown'), fauxAssistantMessage('unavailable')],
    { apply: () => { calls++; return null; } });
  await agent.prompt('run shell');
  expect(calls).toBe(0);
  expect(toolResults(agent.state.messages)).toMatchObject([{ toolName: 'shell', isError: true }]);
});

test.each([
  ['todo_create', { title: {} }],
  ['todo_list', { completed: 'yes' }],
  ['todo_update', { title: 'missing id' }],
  ['todo_delete', { id: 't', extra: true }],
])('rejects malformed %s arguments before service execution', async (name, args) => {
  let calls = 0;
  const { agent } = setup([toolTurn(name, args, 'bad'), fauxAssistantMessage('invalid')],
    { apply: () => { calls++; return null; } });
  await agent.prompt('invalid');
  expect(calls).toBe(0);
  expect(toolResults(agent.state.messages)[0]?.isError).toBe(true);
});

test('passes shape-valid update without changes to business validation and exposes the thrown error', async () => {
  let input: unknown;
  const { agent } = setup([toolTurn('todo_update', { id: 't' }, 'update'), fauxAssistantMessage('failed')],
    { apply: (_ctx, _name, args) => { input = args; throw new Error('No changes supplied'); } });
  await agent.prompt('update');
  expect(input).toEqual({ id: 't' });
  expect(toolResults(agent.state.messages)[0]).toMatchObject({ isError: true,
    content: [{ type: 'text', text: 'No changes supplied' }] });
});

test('does not enforce the trimmed title limit on raw whitespace', async () => {
  const rawTitle = ` ${'x'.repeat(500)} `;
  let received: unknown;
  const { agent } = setup([toolTurn('todo_create', { title: rawTitle }, 'title'), fauxAssistantMessage('done')],
    { apply: (_ctx, _name, input) => { received = input; return { title: 'x'.repeat(500) }; } });
  await agent.prompt('create');
  expect(received).toEqual({ title: rawTitle });
  expect(toolResults(agent.state.messages)[0]?.isError).toBe(false);
});

test('preserves an actual canonical leading system and tool declarations once across restoration', async () => {
  const first = setup([fauxAssistantMessage('first')], { apply: () => null });
  const canonical = structuredClone(first.agent.state.messages[0]);
  expect(canonical).toMatchObject({ role: 'system', toolsAdded: [
    { name: 'todo_create' }, { name: 'todo_list' }, { name: 'todo_update' }, { name: 'todo_delete' },
  ] });
  await first.agent.prompt('hello');
  const history = structuredClone(first.agent.state.messages);
  const restored = setup([context => {
    expect(context.messages.filter(m => m.role === 'system')).toEqual([canonical]);
    return fauxAssistantMessage('second');
  }], { apply: () => null }, { messages: history });
  expect(restored.agent.state.messages[0]).toEqual(canonical);
  await restored.agent.prompt('again');
  expect(restored.agent.state.messages.filter(m => m.role === 'system')).toEqual([canonical]);
});

test('executes turn twenty tools and ends before request twenty one', async () => {
  const calls: string[] = [];
  let limits = 0;
  const { agent, faux } = setup(Array.from({ length: 21 }, (_, i) => toolTurn('todo_list', {}, `t${i + 1}`)),
    { apply: ctx => { calls.push(ctx.toolCallId); return []; } }, { onTurnLimit: () => { limits++; } });
  await agent.prompt('loop');
  expect(faux.state.callCount).toBe(20);
  expect(calls).toHaveLength(20);
  expect(calls[19]).toBe('t20');
  expect(toolResults(agent.state.messages)).toHaveLength(20);
  expect(limits).toBe(1);
});

test('allows a final text response on turn twenty without reporting a turn limit', async () => {
  let limits = 0;
  const { agent, faux } = setup([
    ...Array.from({ length: 19 }, (_, i) => toolTurn('todo_list', {}, `t${i}`)),
    fauxAssistantMessage('finished'),
  ], { apply: () => [] }, { onTurnLimit: () => { limits++; } });
  await agent.prompt('finish');
  expect(faux.state.callCount).toBe(20);
  expect(limits).toBe(0);
  expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'finished' }] });
});

test('blocks all mutations until a successful recovery list, including after a failed list', async () => {
  const calls: string[] = [];
  let listCalls = 0;
  const { agent } = setup([
    toolTurn('todo_create', { title: 'blocked' }, 'before'),
    toolTurn('todo_update', { id: 't', completed: true }, 'before-update'),
    toolTurn('todo_delete', { id: 't' }, 'before-delete'),
    toolTurn('todo_list', {}, 'failed-list'),
    toolTurn('todo_create', { title: 'still blocked' }, 'after-failure'),
    toolTurn('todo_list', { completed: false }, 'good-list'),
    toolTurn('todo_create', { title: 'allowed' }, 'after-success'),
    fauxAssistantMessage('done'),
  ], { apply: (ctx, name) => {
    calls.push(ctx.toolCallId);
    if (name === 'todo_list' && ++listCalls === 1) throw new Error('Read failed');
    return [];
  } }, { requireTodoRefresh: true });
  await agent.prompt('recover');
  expect(calls).toEqual(['failed-list', 'good-list', 'after-success']);
  expect(toolResults(agent.state.messages).map(m => m.isError)).toEqual([true, true, true, true, true, false, false]);
});

test('direct executors throw service errors and forward the supplied signal', async () => {
  const controller = new AbortController();
  const tools = createTodoTools({ chatId: 'chat', runId: 'run', requireTodoRefresh: false,
    todos: { apply: (ctx, name, input, signal) => {
      expect(ctx).toEqual({ chatId: 'chat', runId: 'run', toolCallId: 'delete' });
      expect(name).toBe('todo_delete'); expect(input).toEqual({ id: 'missing' });
      expect(signal).toBe(controller.signal); throw new Error('Todo not found');
    } } });
  await expect(tools[3].execute('delete', { id: 'missing' }, controller.signal)).rejects.toThrow('Todo not found');
});

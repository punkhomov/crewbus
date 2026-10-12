import { expect, test } from 'vitest';
import type { ChatSnapshot, CrewEvent, MessageView, Todo, ToolView } from '@crewbus/contracts';
import { reduceChat } from '../src/chat/reducer.js';

function createSnapshot(): ChatSnapshot {
  return {
    chat: { id: 'c', title: 'Чат', providerId: 'faux', modelId: 'faux-model', createdAt: 0, updatedAt: 0 },
    todos: [],
    messages: [{ id: 'm', role: 'assistant', text: '', state: 'streaming', tools: [] }],
    run: { id: 'r', chatId: 'c', status: 'running', reason: null, error: null, startedAt: 0, endedAt: null },
    lastEventId: 0,
  };
}

function event(snapshot: ChatSnapshot, id: number, data: CrewEvent['data']): CrewEvent {
  return { id, runId: snapshot.run!.id, chatId: snapshot.chat.id, data };
}

test('delta applies once and events for another chat or run are ignored', () => {
  const snapshot = createSnapshot();
  const delta = event(snapshot, 1, { type: 'message.delta', messageId: 'm', delta: 'Привет' });
  const next = reduceChat(snapshot, delta);

  expect(reduceChat(next, delta)).toBe(next);
  expect(reduceChat(next, { ...delta, id: 2, chatId: 'other' })).toBe(next);
  expect(reduceChat(next, { ...delta, id: 2, runId: 'other' })).toBe(next);
  expect(next.messages[0].text).toBe('Привет');
});

test('a repeated message.started preserves fuller text already shown', () => {
  const snapshot = createSnapshot();
  const fuller: MessageView = { id: 'm', role: 'assistant', text: 'already streamed', state: 'streaming', tools: [] };
  const next = reduceChat({ ...snapshot, messages: [fuller], lastEventId: 1 }, event(snapshot, 2, {
    type: 'message.started', message: { ...fuller, text: '', tools: [] },
  }));

  expect(next.messages[0]).toEqual(fuller);
});

test('message.completed replaces the full message after deltas', () => {
  const snapshot = createSnapshot();
  const withDelta = reduceChat(snapshot, event(snapshot, 1, { type: 'message.delta', messageId: 'm', delta: 'partial' }));
  const completed: MessageView = { id: 'm', role: 'assistant', text: 'authoritative', state: 'completed', tools: [] };

  expect(reduceChat(withDelta, event(snapshot, 2, { type: 'message.completed', message: completed })).messages[0]).toEqual(completed);
});

test('tool results update by ID while separate tool calls remain independent', () => {
  const snapshot = createSnapshot();
  const first: ToolView = { id: 'call-1', name: 'todo_create', state: 'running', input: {}, output: null, error: null };
  const second: ToolView = { id: 'call-2', name: 'todo_list', state: 'running', input: {}, output: null, error: null };
  let next = reduceChat(snapshot, event(snapshot, 1, { type: 'tool.started', messageId: 'm', tool: first }));
  next = reduceChat(next, event(snapshot, 2, { type: 'tool.started', messageId: 'm', tool: second }));
  const done: ToolView = { ...first, state: 'completed', output: ['created'] };
  next = reduceChat(next, event(snapshot, 3, { type: 'tool.completed', messageId: 'm', tool: done }));

  expect(next.messages[0].tools).toEqual([done, second]);
});

test('todos.changed replaces the todo list', () => {
  const snapshot = createSnapshot();
  const todos: Todo[] = [{ id: 't', chatId: 'c', title: 'Prepare release', completed: false, createdAt: 1, updatedAt: 1 }];

  expect(reduceChat(snapshot, event(snapshot, 1, { type: 'todos.changed', todos })).todos).toEqual(todos);
});

test('run.finished interrupts unfinished work and preserves completed results', () => {
  const snapshot = createSnapshot();
  const completedMessage: MessageView = { id: 'done', role: 'assistant', text: 'saved', state: 'completed', tools: [
    { id: 'ok', name: 'todo_create', state: 'completed', input: {}, output: { id: 't' }, error: null },
  ] };
  const runningMessage: MessageView = { id: 'm', role: 'assistant', text: 'partial', state: 'streaming', tools: [
    { id: 'active', name: 'todo_update', state: 'running', input: {}, output: null, error: null },
  ] };
  const run = { ...snapshot.run!, status: 'aborted' as const, reason: 'user_abort' as const, endedAt: 10 };
  const next = reduceChat({ ...snapshot, messages: [completedMessage, runningMessage] }, event(snapshot, 1, { type: 'run.finished', run }));

  expect(next.run).toEqual(run);
  expect(next.messages).toEqual([completedMessage, { ...runningMessage, state: 'interrupted', tools: [{ ...runningMessage.tools[0], state: 'interrupted' }] }]);
});

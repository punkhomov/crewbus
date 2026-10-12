import { expect, test } from 'vitest';
import { createStorage } from '../src/storage/index.js';
test('tool result is atomic and repeated calls do not repeat effects', () => {
  const s = createStorage(':memory:');
  try {
    const chat = s.chats.create({
      providerId: 'faux', modelId: 'faux-model'
    });
    const { run } = s.runs.accept(chat.id, {
      text: 'create', clientRequestId: crypto.randomUUID()
    }, 'system');
    const ctx = {
      chatId: chat.id, runId: run.id, toolCallId: 'call-1'
    };
    const first = s.todos.apply(ctx, 'todo_create', {
      title: ' Learn pi '
    });
    expect(s.todos.apply(ctx, 'todo_create', {
      title: ' Learn pi '
    })).toEqual(first);
    expect(s.todos.list(chat.id)).toHaveLength(1);
    expect(s.todos.list(chat.id)[0]?.title).toBe('Learn pi');
    expect(() => s.todos.apply(ctx, 'todo_create', {
      title: 'different'
    })).toThrow();
    expect(s.todos.list(chat.id)).toHaveLength(1);
  }
  finally {
    s.close();
  }
});
test('journal normalizes key order, snapshots lists, rejects scope and aborts before effect', () => {
  const s = createStorage(':memory:');
  try {
    const a = s.chats.create({
      providerId: 'faux', modelId: 'model'
    }), b = s.chats.create({
      providerId: 'faux', modelId: 'model'
    });
    const { run } = s.runs.accept(a.id, {
      text: 'x', clientRequestId: 'r'
    }, 'system');
    const ctx = {
      chatId: a.id, runId: run.id, toolCallId: 'update'
    };
    const todo = s.todos.create(a.id, {
      title: 'x'
    });
    const first = s.todos.apply(ctx, 'todo_update', {
      id: todo.id, title: 'y', completed: true
    });
    expect(s.todos.apply(ctx, 'todo_update', {
      completed: true, title: 'y', id: todo.id
    })).toEqual(first);
    expect(() => s.todos.update(b.id, todo.id, {
      title: 'z'
    })).toThrow();
    expect(() => s.todos.delete(b.id, todo.id)).toThrow();
    expect(() => s.todos.apply({
      ...ctx, chatId: b.id
    }, 'todo_create', {
      title: 'z'
    })).toThrow();
    const abort = new AbortController();
    abort.abort();
    expect(() => s.todos.apply({
      ...ctx, toolCallId: 'abort'
    }, 'todo_create', {
      title: 'z'
    }, abort.signal)).toThrow();
    expect(() => s.todos.create(a.id, {
      title: ' '
    })).toThrow();
    expect(() => s.todos.update(a.id, todo.id, {})).toThrow();
    expect(s.todos.create(a.id, {
      title: ' '.repeat(600) + 'z' + ' '.repeat(600)
    }).title).toBe('z');
    const listCtx = {
      ...ctx, toolCallId: 'list'
    };
    const snapshot = s.todos.apply(listCtx, 'todo_list', {});
    s.todos.create(a.id, {
      title: 'next'
    });
    expect(s.todos.apply(listCtx, 'todo_list', {})).toEqual(snapshot);
  }
  finally {
    s.close();
  }
});
test('journal INSERT failure rolls back todo effect and journal', () => {
  const s = createStorage(':memory:');
  try {
    const c = s.chats.create({
      providerId: 'faux', modelId: 'm'
    });
    const { run } = s.runs.accept(c.id, {
      text: 'x', clientRequestId: 'r'
    }, 'system');
    s.database.exec("CREATE TRIGGER fail_journal BEFORE INSERT ON tool_results BEGIN SELECT RAISE(ABORT, 'injected'); END");
    expect(() => s.todos.apply({
      chatId: c.id, runId: run.id, toolCallId: 'x'
    }, 'todo_create', {
      title: 'x'
    })).toThrow('injected');
    expect(s.todos.list(c.id)).toEqual([]);
    expect(s.database.prepare('SELECT * FROM tool_results').all()).toEqual([]);
  }
  finally {
    s.close();
  }
});
test('update and delete results replay, filtering and validation use chat scope', () => {
  const s = createStorage(':memory:');
  try {
    const chat = s.chats.create({ providerId: 'faux', modelId: 'm' });
    const { run } = s.runs.accept(chat.id, { text: 'x', clientRequestId: 'r' }, 'system');
    const context = { chatId: chat.id, runId: run.id, toolCallId: 'delete' };
    const todo = s.todos.create(chat.id, { title: 'first' });
    s.todos.update(chat.id, todo.id, { completed: true });
    expect(s.todos.list(chat.id, false)).toEqual([]);
    expect(s.todos.list(chat.id, true)).toHaveLength(1);
    expect(() => s.todos.create(chat.id, { title: 'x'.repeat(501) })).toThrow();
    expect(() => s.todos.update(chat.id, todo.id, { completed: 'yes' as unknown as boolean })).toThrow();
    const result = s.todos.apply(context, 'todo_delete', { id: todo.id });
    expect(s.todos.apply(context, 'todo_delete', { id: todo.id })).toEqual(result);
    expect(() => s.todos.apply(context, 'todo_create', { title: 'different' })).toThrow(expect.objectContaining({ statusCode: 409, code: 'conflict' }));
    expect(s.todos.list(chat.id)).toEqual([]);
  }
  finally {
    s.close();
  }
});

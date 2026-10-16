import { expect, test } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage } from '../src/storage/index.js';
test('file reopen preserves chats and todos with private permissions', () => {
  const parent = mkdtempSync(join(tmpdir(), 'crewbus-'));
  const dir = join(parent, 'data');
  try {
    let s = createStorage(dir);
    const c = s.chats.create({
      providerId: 'faux', modelId: 'm'
    });
    const t = s.todos.create(c.id, {
      title: 'save'
    });
    s.close();
    s = createStorage(dir);
    try {
      expect(s.chats.get(c.id)).toEqual(c);
      expect(s.todos.list(c.id)).toEqual([t]);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, 'crewbus.sqlite')).mode & 0o777).toBe(0o600);
    }
    finally {
      s.close();
    }
  }
  finally {
    rmSync(parent, {
      recursive: true, force: true
    });
  }
});
test('accept is idempotent, snapshots selection, reserves system ordinal, and composed transactions roll back', () => {
  const s = createStorage(':memory:');
  try {
    const c = s.chats.create({
      providerId: 'faux', modelId: 'm'
    });
    const input = {
      text: 'hi', clientRequestId: 'r'
    };
    const accepted = s.runs.accept(c.id, input, 'system');
    expect(s.runs.accept(c.id, input, 'different').created).toBe(false);
    expect(() => s.runs.accept(c.id, {
      ...input, text: 'other'
    }, 'system')).toThrow();
    expect(() => s.runs.accept(c.id, {
      ...input, clientRequestId: 'other'
    }, 'system')).toThrow();
    expect(() => s.chats.setModel(c.id, {
      providerId: 'p', modelId: 'm'
    })).toThrow();
    expect(s.runs.details(accepted.run.id).systemPrompt).toBe('system');
    expect(s.runs.messages(c.id)).toMatchObject([{
        id: accepted.userMessageId, ordinal: 1, role: 'user'
      }]);
    s.runs.saveMessage({
      id: 'system', chatId: c.id, runId: null, role: 'system', canonical: {
        role: 'system', content: 'actual'
      }
    });
    expect(s.runs.messages(c.id)[0]?.ordinal).toBe(0);
    expect(() => s.transaction(() => {
      s.events.append(accepted.run.id, {
        type: 'todos.changed', todos: []
      });
      s.runs.finish(accepted.run.id, 'completed');
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(s.events.cursor(accepted.run.id)).toBe(0);
    expect(s.runs.get(accepted.run.id).status).toBe('running');
    s.transaction(() => {
      s.events.append(accepted.run.id, {
        type: 'todos.changed', todos: []
      });
      s.runs.finish(accepted.run.id, 'completed');
    });
    expect(s.events.since(accepted.run.id, 0)).toMatchObject([{
        id: 1, chatId: c.id
      }]);
    expect(s.runs.accept(c.id, input, 'system')).toEqual({
      run: s.runs.get(accepted.run.id), userMessageId: accepted.userMessageId, created: false
    });
    expect(() => s.transaction(() => Promise.resolve())).toThrow('synchronous');
  }
  finally {
    s.close();
  }
});
test('message upsert keeps ordinal and accept preserves canonical leading system', () => {
  const s = createStorage(':memory:');
  try {
    const c = s.chats.create({ providerId: 'faux', modelId: 'm' });
    const { run, userMessageId } = s.runs.accept(c.id, { text: 'one', clientRequestId: 'one' }, 'prompt');
    s.runs.saveMessage({ id: 'system', chatId: c.id, runId: null, role: 'system', canonical: { role: 'system', content: 'canonical tools' } });
    s.runs.saveMessage({ id: userMessageId, chatId: c.id, runId: run.id, role: 'user', ordinal: 50, canonical: { role: 'user', content: 'updated' } });
    expect(s.runs.messages(c.id)[1]).toMatchObject({ id: userMessageId, ordinal: 1, canonical: { content: 'updated' } });
    s.runs.finish(run.id, 'completed');
    s.chats.setModel(c.id, { providerId: 'next', modelId: 'new' });
    const next = s.runs.accept(c.id, { text: 'two', clientRequestId: 'two' }, 'changed');
    expect(s.runs.details(run.id).providerId).toBe('faux');
    expect(s.runs.details(next.run.id).providerId).toBe('next');
    expect(s.runs.messages(c.id).map(m => m.ordinal)).toEqual([0, 1, 2]);
    expect(s.runs.messages(c.id)[0]?.canonical).toEqual({ role: 'system', content: 'canonical tools' });
  }
  finally {
    s.close();
  }
});

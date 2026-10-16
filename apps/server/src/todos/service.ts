import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue, Todo, TodoToolName, UpdateTodoInput } from '@crewbus/contracts';
import { transaction } from '../storage/database.js';
import { invalid, missing, conflict } from '../lib/error.js';
export interface ToolContext {
  chatId: string;
  runId: string;
  toolCallId: string;
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return invalid();
  return input as Record<string, unknown>;
}
function title(input: unknown): string {
  if (typeof input !== 'string')
    return invalid();
  const t = input.trim();
  if (!t.length || t.length > 500)
    return invalid('Title must contain 1–500 characters');
  return t;
}
function json(input: unknown): JsonValue {
  if (input === null || typeof input === 'string' || typeof input === 'boolean')
    return input;
  if (typeof input === 'number' && Number.isFinite(input))
    return input;
  if (Array.isArray(input))
    return input.map(json);
  if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
    const result: {
      [key: string]: JsonValue;
    } = {};
    for (const [k, v] of Object.entries(input))
      Object.defineProperty(result, k, {
        value: json(v), enumerable: true
      });
    return result;
  }
  return invalid('Input must be JSON');
}
function stableJson(v: JsonValue): string {
  if (v === null || typeof v !== 'object')
    return JSON.stringify(v);
  if (Array.isArray(v))
    return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson(v[k]!)}`).join(',')}}`;
}
const dto = (r: Record<string, unknown>): Todo => ({
  id: String(r.id), chatId: String(r.chat_id), title: String(r.title), completed: r.completed === 1, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at)
});
export class TodoService {
  constructor(private db: DatabaseSync) {
  }
  private chat(id: string): void {
    if (!this.db.prepare('SELECT 1 FROM chats WHERE id=?').get(id))
      missing();
  }
  private get(chatId: string, id: string): Todo {
    const r = this.db.prepare('SELECT * FROM todos WHERE chat_id=? AND id=?').get(chatId, id);
    if (!r)
      return missing();
    return dto(r);
  }
  create(chatId: string, input: {
    title: string;
  }): Todo {
    const t = title(input?.title);
    return transaction(this.db, () => {
      this.chat(chatId);
      const id = randomUUID(), now = Date.now();
      this.db.prepare('INSERT INTO todos VALUES (?,?,?,0,?,?)').run(id, chatId, t, now, now);
      return this.get(chatId, id);
    });
  }
  list(chatId: string, completed?: boolean): Todo[] {
    this.chat(chatId);
    if (completed !== undefined && typeof completed !== 'boolean')
      invalid();
    return (completed === undefined ? this.db.prepare('SELECT * FROM todos WHERE chat_id=? ORDER BY created_at,id').all(chatId) : this.db.prepare('SELECT * FROM todos WHERE chat_id=? AND completed=? ORDER BY created_at,id').all(chatId, Number(completed))).map(dto);
  }
  update(chatId: string, id: string, input: UpdateTodoInput): Todo {
    const value = object(input);
    if (value.title === undefined && value.completed === undefined)
      invalid();
    const t = value.title === undefined ? undefined : title(value.title);
    if (value.completed !== undefined && typeof value.completed !== 'boolean')
      invalid();
    return transaction(this.db, () => {
      const prev = this.get(chatId, id);
      this.db.prepare('UPDATE todos SET title=?,completed=?,updated_at=? WHERE chat_id=? AND id=?').run(t ?? prev.title, Number(value.completed ?? prev.completed), Date.now(), chatId, id);
      return this.get(chatId, id);
    });
  }
  delete(chatId: string, id: string): {
    id: string;
  } {
    return transaction(this.db, () => {
      this.get(chatId, id);
      this.db.prepare('DELETE FROM todos WHERE chat_id=? AND id=?').run(chatId, id);
      return {
        id
      };
    });
  }
  apply(context: ToolContext, name: TodoToolName, input: unknown, signal?: AbortSignal): JsonValue {
    if (!context || ![context.chatId, context.runId, context.toolCallId].every(v => typeof v === 'string' && v.trim().length))
      invalid();
    const args = object(input), inputJson = stableJson(json(input));
    const keys = name === 'todo_create' ? ['title'] : name === 'todo_list' ? ['completed'] : name === 'todo_update' ? ['id', 'title', 'completed'] : name === 'todo_delete' ? ['id'] : invalid('Unknown tool');
    if (Object.keys(args).some(k => !keys.includes(k)))
      invalid();
    if (name === 'todo_create')
      title(args.title);
    if (name === 'todo_update' || name === 'todo_delete') {
      if (typeof args.id !== 'string' || !args.id.trim())
        invalid();
    }
    if (name === 'todo_update') {
      if (args.title === undefined && args.completed === undefined)
        invalid();
      if (args.title !== undefined)
        title(args.title);
    }
    if (args.completed !== undefined && typeof args.completed !== 'boolean')
      invalid();
    const run = this.db.prepare('SELECT chat_id FROM runs WHERE id=?').get(context.runId);
    if (!run)
      missing();
    if (run?.chat_id !== context.chatId)
      invalid('Run does not belong to chat');
    signal?.throwIfAborted();
    return transaction(this.db, () => {
      const saved = this.db.prepare('SELECT * FROM tool_results WHERE run_id=? AND tool_call_id=?').get(context.runId, context.toolCallId);
      if (saved) {
        if (saved.name !== name || saved.input_json !== inputJson)
          conflict('Tool call input differs');
        return JSON.parse(String(saved.result_json)) as JsonValue;
      }
      let result: unknown;
      switch (name) {
        case 'todo_create':
          result = this.create(context.chatId, {
            title: args.title as string
          });
          break;
        case 'todo_list':
          result = this.list(context.chatId, args.completed as boolean | undefined);
          break;
        case 'todo_update': {
          const patch: UpdateTodoInput = {};
          if (args.title !== undefined)
            patch.title = args.title as string;
          if (args.completed !== undefined)
            patch.completed = args.completed as boolean;
          result = this.update(context.chatId, args.id as string, patch);
          break;
        }
        case 'todo_delete':
          result = this.delete(context.chatId, args.id as string);
          break;
      }
      const resultJson = JSON.stringify(result);
      this.db.prepare('INSERT INTO tool_results VALUES (?,?,?,?,?,?)').run(context.runId, context.toolCallId, name, inputJson, resultJson, Date.now());
      return JSON.parse(resultJson) as JsonValue;
    });
  }
}

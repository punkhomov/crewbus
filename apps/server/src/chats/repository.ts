import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ChatSummary, CreateChatInput, RunSummary, StartRunInput, JsonValue } from '@crewbus/contracts';
import { transaction } from '../storage/database.js';
import { invalid, missing, conflict } from '../lib/error.js';
type Row = Record<string, string | number | null>;
const chatDTO = (r: Row): ChatSummary => ({
  id: String(r.id), title: String(r.title), providerId: String(r.provider_id), modelId: String(r.model_id), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at)
});
const runDTO = (r: Row): RunSummary => ({
  id: String(r.id), chatId: String(r.chat_id), status: r.status as RunSummary['status'], reason: r.reason as RunSummary['reason'], error: r.error as string | null, startedAt: Number(r.started_at), endedAt: r.ended_at === null ? null : Number(r.ended_at)
});
function selection(s: CreateChatInput): void {
  if (!s || typeof s.providerId !== 'string' || !s.providerId.trim() || typeof s.modelId !== 'string' || !s.modelId.trim())
    invalid();
}
export class ChatRepository {
  constructor(private db: DatabaseSync) {
  }
  create(s: CreateChatInput): ChatSummary {
    selection(s);
    return transaction(this.db, () => {
      const id = randomUUID(), now = Date.now();
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?,?)').run(id, 'New chat', s.providerId, s.modelId, now, now);
      return this.get(id);
    });
  }
  get(id: string): ChatSummary {
    const r = this.db.prepare('SELECT * FROM chats WHERE id=?').get(id);
    if (!r)
      return missing();
    return chatDTO(r as Row);
  }
  list(): ChatSummary[] {
    return this.db.prepare('SELECT * FROM chats ORDER BY updated_at DESC,id').all().map(r => chatDTO(r as Row));
  }
  setModel(id: string, s: CreateChatInput): ChatSummary {
    selection(s);
    return transaction(this.db, () => {
      this.get(id);
      if (this.db.prepare("SELECT 1 FROM runs WHERE chat_id=? AND status='running'").get(id))
        conflict('Chat is running');
      this.db.prepare('UPDATE chats SET provider_id=?,model_id=?,updated_at=? WHERE id=?').run(s.providerId, s.modelId, Date.now(), id);
      return this.get(id);
    });
  }
}
export interface StoredMessage {
  id: string;
  chatId: string;
  runId: string | null;
  ordinal: number;
  role: string;
  canonical: JsonValue;
}
export class RunRepository {
  constructor(private db: DatabaseSync, private chats: ChatRepository) {
  }
  get(id: string): RunSummary {
    return runDTO(this.row(id));
  }
  row(id: string): Row {
    const r = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    if (!r)
      return missing();
    return r as Row;
  }
  details(id: string) {
    const r = this.row(id);
    return {
      run: runDTO(r), text: String(r.input_text), userMessageId: String(r.user_message_id), providerId: String(r.provider_id), modelId: String(r.model_id), systemPrompt: String(r.system_prompt)
    };
  }
  list(chatId: string): RunSummary[] {
    this.chats.get(chatId);
    return this.db.prepare('SELECT * FROM runs WHERE chat_id=? ORDER BY ordinal').all(chatId).map(r => runDTO(r as Row));
  }
  unfinished(): RunSummary[] {
    return this.db.prepare("SELECT * FROM runs WHERE status='running' ORDER BY ordinal").all().map(r => runDTO(r as Row));
  }
  findRequest(chatId: string, input: StartRunInput): { runId: string; created: false } | undefined {
    if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000 || typeof input.clientRequestId !== 'string' || !input.clientRequestId.trim()) invalid();
    this.chats.get(chatId);
    const prior = this.db.prepare('SELECT id,input_text FROM runs WHERE chat_id=? AND client_request_id=?').get(chatId, input.clientRequestId);
    if (!prior) return;
    if (prior.input_text !== input.text) conflict();
    return {runId:String(prior.id),created:false};
  }
  accept(chatId: string, input: StartRunInput, systemPrompt: string) {
    if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000 || typeof input.clientRequestId !== 'string' || !input.clientRequestId.trim() || typeof systemPrompt !== 'string')
      invalid();
    return transaction(this.db, () => {
      const chat = this.chats.get(chatId);
      const prior = this.db.prepare('SELECT * FROM runs WHERE chat_id=? AND client_request_id=?').get(chatId, input.clientRequestId) as Row | undefined;
      if (prior) {
        if (prior.input_text !== input.text)
          conflict();
        return {
          run: runDTO(prior), created: false, userMessageId: String(prior.user_message_id)
        };
      }
      if (this.db.prepare("SELECT 1 FROM runs WHERE chat_id=? AND status='running'").get(chatId))
        conflict('Chat is running');
      const id = randomUUID(), userMessageId = randomUUID(), now = Date.now();
      this.db.prepare("INSERT INTO runs (id,chat_id,client_request_id,input_text,user_message_id,provider_id,model_id,system_prompt,status,started_at) VALUES (?,?,?,?,?,?,?,?,'running',?)").run(id, chatId, input.clientRequestId, input.text, userMessageId, chat.providerId, chat.modelId, systemPrompt, now);
      this.saveMessage({
        id: userMessageId, chatId, runId: id, role: 'user', canonical: {
          role: 'user', content: input.text, timestamp: now
        }
      });
      this.db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(now, chatId);
      return {
        run: this.get(id), created: true, userMessageId
      };
    });
  }
  finish(id: string, status: Exclude<RunSummary['status'], 'running'>, reason: RunSummary['reason'] = null, error: string | null = null): RunSummary {
    return transaction(this.db, () => {
      this.get(id);
      this.db.prepare("UPDATE runs SET status=?,reason=?,error=?,ended_at=? WHERE id=? AND status='running'").run(status, reason, error, Date.now(), id);
      return this.get(id);
    });
  }
  messages(chatId: string): StoredMessage[] {
    this.chats.get(chatId);
    return this.db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY ordinal').all(chatId).map(r => ({
      id: String(r.id), chatId: String(r.chat_id), runId: r.run_id as string | null, ordinal: Number(r.ordinal), role: String(r.role), canonical: JSON.parse(String(r.canonical_json)) as JsonValue
    }));
  }
  saveMessage(m: Omit<StoredMessage, 'ordinal'> & {
    ordinal?: number;
  }): void {
    transaction(this.db, () => {
      this.chats.get(m.chatId);
      if (m.runId && this.get(m.runId).chatId !== m.chatId)
        invalid('Run does not belong to chat');
      const existing = this.db.prepare('SELECT * FROM messages WHERE id=?').get(m.id);
      if (existing && existing.chat_id !== m.chatId)
        conflict();
      const ordinal = existing ? Number(existing.ordinal) : m.ordinal ?? (m.role === 'system' ? 0 : Number(this.db.prepare('SELECT MAX(ordinal) AS n FROM messages WHERE chat_id=?').get(m.chatId)?.n ?? 0) + 1);
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_json=excluded.canonical_json').run(m.id, m.chatId, m.runId, ordinal, m.role, JSON.stringify(m.canonical));
    });
  }
}

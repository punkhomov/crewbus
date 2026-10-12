import type { DatabaseSync } from 'node:sqlite';
export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
    if (!db.prepare('SELECT version FROM schema_version').get()) {
      db.exec(`
 CREATE TABLE credentials (provider_id TEXT PRIMARY KEY, credential_json TEXT NOT NULL);
 CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
 CREATE TABLE runs (ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, chat_id TEXT NOT NULL REFERENCES chats(id), client_request_id TEXT NOT NULL, input_text TEXT NOT NULL, user_message_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, system_prompt TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, error TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, UNIQUE(chat_id, client_request_id));
 CREATE UNIQUE INDEX one_running_per_chat ON runs(chat_id) WHERE status = 'running';
 CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id), run_id TEXT REFERENCES runs(id), ordinal INTEGER NOT NULL, role TEXT NOT NULL, canonical_json TEXT NOT NULL, UNIQUE(chat_id, ordinal));
 CREATE TABLE todos (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id), title TEXT NOT NULL, completed INTEGER NOT NULL CHECK(completed IN (0, 1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
 CREATE TABLE tool_results (run_id TEXT NOT NULL REFERENCES runs(id), tool_call_id TEXT NOT NULL, name TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(run_id,tool_call_id));
 CREATE TABLE events (run_id TEXT NOT NULL REFERENCES runs(id), id INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(run_id,id));
 CREATE INDEX todo_chat_order ON todos(chat_id,created_at,id);
 INSERT INTO schema_version VALUES (1);
 `);
    }
    db.exec('COMMIT');
  }
  catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

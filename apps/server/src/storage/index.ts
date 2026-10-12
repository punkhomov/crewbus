import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, transaction } from './database.js';
import { ChatRepository, RunRepository } from '../chats/repository.js';
import { EventRepository } from '../events/repository.js';
import { loadContext, saveMessage, type AgentMessage } from './context.js';
import { TodoService } from '../todos/service.js';
export interface Storage {
  readonly database: DatabaseSync;
  readonly chats: ChatRepository;
  readonly runs: RunRepository;
  readonly events: EventRepository;
  readonly todos: TodoService;
  transaction<T>(fn: () => T): T;
  loadContext(chatId: string, beforeRunId: string): AgentMessage[];
  saveMessage(chatId: string, runId: string | null, messageId: string, message: AgentMessage): void;
  close(): void;
}
export function createStorage(dataDir: string): Storage {
  const database = openDatabase(dataDir), chats = new ChatRepository(database), runs = new RunRepository(database, chats);
  return {
    loadContext: (chatId, beforeRunId) => loadContext(runs, chatId, beforeRunId),
    saveMessage: (chatId, runId, messageId, message) => saveMessage(runs, chatId, runId, messageId, message),
    database, chats, runs, events: new EventRepository(database), todos: new TodoService(database), transaction: <T>(fn: () => T) => transaction(database, fn), close: () => database.close()
  };
}

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, transaction } from './database.js';
import { ChatRepository, RunRepository } from '../chats/repository.js';
import { EventRepository } from '../events/repository.js';
import { TodoService } from '../todos/service.js';
export interface Storage {
  readonly database: DatabaseSync;
  readonly chats: ChatRepository;
  readonly runs: RunRepository;
  readonly events: EventRepository;
  readonly todos: TodoService;
  transaction<T>(fn: () => T): T;
  close(): void;
}
export function createStorage(dataDir: string): Storage {
  const database = openDatabase(dataDir), chats = new ChatRepository(database);
  return {
    database, chats, runs: new RunRepository(database, chats), events: new EventRepository(database), todos: new TodoService(database), transaction: <T>(fn: () => T) => transaction(database, fn), close: () => database.close()
  };
}

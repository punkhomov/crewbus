export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type TodoToolName = 'todo_create' | 'todo_list' | 'todo_update' | 'todo_delete';

export interface Todo {
  id: string;
  chatId: string;
  title: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}

export interface RunSummary {
  id: string;
  chatId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted';
  reason: null | 'turn_limit' | 'timeout' | 'user_abort' | 'provider_error' | 'storage_error' | 'process_restart';
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface ToolView {
  id: string;
  name: string;
  state: 'running' | 'completed' | 'failed' | 'interrupted';
  input: JsonValue;
  output: JsonValue | null;
  error: string | null;
}

export interface MessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  state: 'streaming' | 'completed' | 'interrupted';
  tools: ToolView[];
}

export interface ChatSnapshot {
  chat: ChatSummary;
  todos: Todo[];
  messages: MessageView[];
  run: RunSummary | null;
  lastEventId: number;
}

export interface CreateChatInput {
  providerId: string;
  modelId: string;
}

export interface StartRunInput {
  text: string;
  clientRequestId: string;
}

export interface UpdateTodoInput {
  title?: string;
  completed?: boolean;
}

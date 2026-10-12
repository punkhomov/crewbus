import type { MessageView, RunSummary, Todo, ToolView } from './domain.js';

export type EventData =
  | { type: 'message.started'; message: MessageView }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.completed'; message: MessageView }
  | { type: 'tool.started'; messageId: string; tool: ToolView }
  | { type: 'tool.completed'; messageId: string; tool: ToolView }
  | { type: 'todos.changed'; todos: Todo[] }
  | { type: 'run.finished'; run: RunSummary };

export interface CrewEvent {
  id: number;
  runId: string;
  chatId: string;
  data: EventData;
}

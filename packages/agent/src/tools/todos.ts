import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TodoToolName } from '@crewbus/contracts';
import { Type } from 'typebox';
import type { TodoPort } from '../todo-port.js';

// Title length is a business rule after trim, so schemas only constrain its shape.
export const todoSchemas = {
  todo_create: Type.Object({ title: Type.String() }, { additionalProperties: false }),
  todo_list: Type.Object({ completed: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  todo_update: Type.Object({ id: Type.String(), title: Type.Optional(Type.String()), completed: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  todo_delete: Type.Object({ id: Type.String() }, { additionalProperties: false }),
};

export interface TodoToolOptions {
  runId: string;
  chatId: string;
  todos: TodoPort;
  requireTodoRefresh: boolean;
}

const definitions: { name: TodoToolName; label: string; description: string }[] = [
  { name: 'todo_create', label: 'Create todo', description: 'Create a task in the current chat. Title must contain 1–500 characters after trimming.' },
  { name: 'todo_list', label: 'List todos', description: 'Read current chat tasks, optionally filtered by completion. Read first after an interrupted run.' },
  { name: 'todo_update', label: 'Update todo', description: 'Update a current chat task by id, supplying a title or completion status. Title must contain 1–500 characters after trimming.' },
  { name: 'todo_delete', label: 'Delete todo', description: 'Delete a task by id from the current chat.' },
];

export function createTodoTools(options: TodoToolOptions): AgentTool[] {
  let refreshed = !options.requireTodoRefresh;
  return definitions.map(({ name, label, description }) => ({
    name, label, description, parameters: todoSchemas[name],
    async execute(toolCallId, params, signal) {
      if (name !== 'todo_list' && !refreshed) {
        throw new Error('Read current tasks with todo_list before making changes after an interrupted run');
      }
      const result = options.todos.apply(
        { chatId: options.chatId, runId: options.runId, toolCallId }, name, params, signal,
      );
      if (name === 'todo_list') refreshed = true;
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  }));
}

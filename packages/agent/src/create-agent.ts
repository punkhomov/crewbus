import { Agent, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model, Models } from '@earendil-works/pi-ai';
import { SYSTEM_PROMPT } from './system-prompt.js';
import type { TodoPort } from './todo-port.js';
import { createTodoTools } from './tools/todos.js';

export interface CrewAgentOptions {
  models: Models;
  model: Model<Api>;
  messages: AgentMessage[];
  runId: string;
  chatId: string;
  todos: TodoPort;
  requireTodoRefresh: boolean;
  onEvent(event: AgentEvent, signal: AbortSignal): Promise<void>;
  onTurnLimit(): void;
}

export function createCrewAgent(options: CrewAgentOptions): Agent {
  let turns = 0;
  const agent = new Agent({
    initialState: {
      model: options.model, messages: options.messages,
      systemPrompt: SYSTEM_PROMPT, tools: createTodoTools(options),
    },
    streamFn: options.models.streamSimple.bind(options.models),
    toolExecution: 'sequential',
    finishTurn: turn => {
      turns += 1;
      if (turn.message.stopReason === 'error' || turn.message.stopReason === 'aborted') return;
      // pi calls this after executing the entire tool batch, including turn twenty.
      if (turns >= 20 && turn.message.content.some(block => block.type === 'toolCall')) {
        options.onTurnLimit();
        return { action: 'end' };
      }
    },
  });
  agent.subscribe(options.onEvent);
  return agent;
}

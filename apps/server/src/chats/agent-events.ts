import { isContextOverflow } from '@earendil-works/pi-ai';
import type { CrewAgentOptions } from '@crewbus/agent';
import type { CrewEvent, EventData, JsonValue, MessageView, ToolView } from '@crewbus/contracts';
import type { Storage } from '../storage/index.js';
import type { AgentMessage } from '../storage/context.js';
import type { EventBroker } from '../events/broker.js';

type AgentEvent = Parameters<CrewAgentOptions['onEvent']>[0];
const json = (value: unknown): JsonValue => value === undefined ? null : JSON.parse(JSON.stringify(value)) as JsonValue;
const text = (message: AgentMessage): string => {
  if (!('content' in message)) return '';
  return typeof message.content === 'string' ? message.content : message.content.filter(b => b.type === 'text').map(b => b.text).join('');
};

export function persistAndPublish(storage: Storage, broker: EventBroker, runId: string, data: EventData, save: () => void = () => {}): CrewEvent {
  const event = storage.transaction(() => { save(); return storage.events.append(runId, data); });
  broker.publish(event);
  return event;
}

/** Identity derives from run-local event order, never provider message IDs. */
export function createAgentEvents(options: {
  storage: Storage; broker: EventBroker; chatId: string; runId: string; userMessageId: string;
  onProviderError(reason: 'provider_error' | 'context_overflow'): void; onEnd(): void;
}): (event: AgentEvent) => Promise<void> {
  const {storage, broker, chatId, runId, userMessageId} = options;
  let userStarted = false, assistantIndex = 0, resultIndex = 0;
  let assistant: MessageView | undefined;
  const tools = new Map<string, {message: MessageView; tool: ToolView}>();
  const emit = (data: EventData, save?: () => void) => persistAndPublish(storage, broker, runId, data, save);
  return async event => {
    switch (event.type) {
      case 'message_start':
        if (event.message.role === 'user' && !userStarted) {
          emit({type:'message.started',message:{id:userMessageId,role:'user',text:text(event.message),state:'completed',tools:[]}});
          userStarted = true;
        } else if (event.message.role === 'assistant') {
          assistant = {id:`${runId}:assistant:${assistantIndex++}`,role:'assistant',text:'',state:'streaming',tools:[]};
          emit({type:'message.started',message:assistant});
        }
        break;
      case 'message_update':
        if (assistant && event.assistantMessageEvent.type === 'text_delta') {
          const delta = event.assistantMessageEvent.delta;
          assistant.text += delta;
          emit({type:'message.delta',messageId:assistant.id,delta});
        }
        break;
      case 'message_end': {
        const message = event.message;
        if (message.role === 'assistant' && assistant) {
          if (message.stopReason === 'error') options.onProviderError(isContextOverflow(message) ? 'context_overflow' : 'provider_error');
          assistant.text = text(message);
          assistant.state = message.stopReason === 'aborted' || message.stopReason === 'error' ? 'interrupted' : 'completed';
          for (const block of message.content) {
            if (block.type !== 'toolCall') continue;
            const tool: ToolView = {id:block.id,name:block.name,state:'running',input:json(block.arguments),output:null,error:null};
            assistant.tools.push(tool);
            tools.set(block.id, {message:assistant,tool});
          }
          emit({type:'message.completed',message:assistant}, () => storage.saveMessage(chatId,runId,assistant!.id,message));
        } else if (message.role === 'toolResult') {
          const safe = structuredClone(message);
          if (safe.isError) { safe.content = [{type:'text',text:'Tool execution failed'}]; safe.details = undefined; }
          storage.transaction(() => storage.saveMessage(chatId,runId,`${runId}:toolResult:${resultIndex++}`,safe));
        }
        break;
      }
      case 'tool_execution_start': {
        const entry = tools.get(event.toolCallId);
        if (!entry) throw new Error('Missing parent assistant for tool');
        entry.tool.input = json(event.args);
        emit({type:'tool.started',messageId:entry.message.id,tool:entry.tool});
        break;
      }
      case 'tool_execution_end': {
        const entry = tools.get(event.toolCallId);
        if (!entry) throw new Error('Missing parent assistant for tool');
        entry.tool = {...entry.tool,state:event.isError ? 'failed' : 'completed',output:event.isError ? null : json(event.result?.details),error:event.isError ? 'Tool execution failed' : null};
        entry.message.tools = entry.message.tools.map(tool => tool.id === entry.tool.id ? entry.tool : tool);
        emit({type:'tool.completed',messageId:entry.message.id,tool:entry.tool});
        if (!event.isError && ['todo_create', 'todo_update', 'todo_delete'].includes(event.toolName)) emit({type:'todos.changed',todos:storage.todos.list(chatId)});
        break;
      }
      case 'agent_end': options.onEnd(); break;
    }
  };
}

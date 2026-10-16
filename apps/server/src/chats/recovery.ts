import type { JsonValue, MessageView, ToolView } from '@crewbus/contracts';
import type { Storage } from '../storage/index.js';
import type { AgentMessage } from '../storage/context.js';
import { snapshot } from './snapshot.js';

/** Reconcile durable facts only. Never resume a provider or re-execute a tool. */
export function recoverInterrupted(storage: Storage): void {
  for (const pending of storage.runs.unfinished()) {
    storage.transaction(() => {
      const { id: runId, chatId } = pending;
      if (storage.runs.get(runId).status !== 'running') return;
      const messages = storage.runs.messages(chatId).filter(m => m.runId === runId);
      const view = snapshot(storage, chatId);
      for (const stored of messages) {
        const assistant = stored.canonical as unknown as AgentMessage;
        if (assistant.role !== 'assistant') continue;
        let parent = view.messages.find(m => m.id === stored.id);
        if (!parent) {
          parent = {id:stored.id,role:'assistant',text:assistant.content.filter(b => b.type === 'text').map(b => b.text).join(''),state:assistant.stopReason === 'aborted' || assistant.stopReason === 'error' ? 'interrupted' : 'completed',tools:[]} satisfies MessageView;
          storage.events.append(runId,{type:'message.started',message:parent});
          view.messages.push(parent);
        }
        for (const call of assistant.content) {
          if (call.type !== 'toolCall') continue;
          const prior = parent.tools.find(t => t.id === call.id);
          const started: ToolView = {id:call.id,name:call.name,input:call.arguments as JsonValue,state:'running',output:null,error:null};
          if (!prior) {
            storage.events.append(runId,{type:'tool.started',messageId:stored.id,tool:started});
            parent.tools.push(started);
          }
          const journal = storage.database.prepare('SELECT * FROM tool_results WHERE run_id=? AND tool_call_id=?').get(runId, call.id);
          if (!journal || journal.name !== call.name) continue;
          const result = JSON.parse(String(journal.result_json)) as JsonValue;
          const exists = messages.some(m => {
            const value = m.canonical as unknown as AgentMessage;
            return value.role === 'toolResult' && value.toolCallId === call.id;
          });
          if (!exists) storage.saveMessage(chatId, runId, `${runId}:recovered:${call.id}`, {
            role:'toolResult', toolCallId:call.id, toolName:call.name,
            content:[{type:'text',text:JSON.stringify(result)}], details:result,
            isError:false, timestamp:Number(journal.created_at)
          });
          const tool: ToolView = {...started,state:'completed',output:result};
          if (prior?.state !== 'completed' || JSON.stringify(prior.output) !== JSON.stringify(result)) {
            storage.events.append(runId,{type:'tool.completed',messageId:stored.id,tool});
          }
          if (call.name !== 'todo_list') storage.events.append(runId,{type:'todos.changed',todos:storage.todos.list(chatId)});
        }
      }
      const run = storage.runs.finish(runId,'interrupted','process_restart');
      storage.events.append(runId,{type:'run.finished',run});
    });
  }
}

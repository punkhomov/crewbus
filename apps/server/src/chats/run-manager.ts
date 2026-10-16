import { createCrewAgent, SYSTEM_PROMPT, type TodoPort } from '@crewbus/agent';
import type { Api, Model, Models } from '@earendil-works/pi-ai';
import type { ChatSnapshot, CrewEvent, RunSummary, StartRunInput } from '@crewbus/contracts';
import type { Storage } from '../storage/index.js';
import type { CatalogService } from '../providers/catalog.js';
import { EventBroker } from '../events/broker.js';
import { AppError, conflict } from '../lib/error.js';
import { createAgentEvents } from './agent-events.js';
import { snapshot } from './snapshot.js';

export interface RunManagerOptions {
  storage: Storage;
  models: Models;
  catalog: CatalogService;
  timeoutMs?: number;
  todoPort?: TodoPort;
}
export interface RunManager {
  readonly broker: EventBroker;
  start(chatId: string, input: StartRunInput): Promise<{runId: string; created: boolean}>;
  abort(runId: string): void;
  wait(runId: string): Promise<void>;
  snapshot(chatId: string): ChatSnapshot;
  isChatBusy(chatId: string): boolean;
  isProviderBusy(providerId: string): boolean;
  close(): Promise<void>;
}
interface ActiveRun {
  runId: string;
  chatId: string;
  providerId: string;
  model: Model<Api>;
  userMessageId: string;
  agent?: ReturnType<typeof createCrewAgent>;
  promise: Promise<void>;
  resolve(): void;
  timer?: ReturnType<typeof setTimeout>;
  reason: RunSummary['reason'];
  terminal?: CrewEvent;
  storageFailed: boolean;
}

export function createRunManager(options: RunManagerOptions): RunManager {
  const {storage, models, catalog} = options;
  const broker = new EventBroker();
  const active = new Map<string, ActiveRun>();
  const starting = new Set<Promise<unknown>>();
  let closed = false;

  function finish(slot: ActiveRun): void {
    if (slot.terminal) return;
    const reason = slot.reason;
    const status = reason === 'timeout' || reason === 'user_abort' ? 'aborted' : reason ? 'failed' : 'completed';
    const error = reason === 'provider_error' ? 'Provider request failed' : reason === 'storage_error' ? 'Unable to save run' : null;
    slot.terminal = storage.transaction(() => {
      const run = storage.runs.finish(slot.runId, status, reason, error);
      return storage.events.append(slot.runId,{type:'run.finished',run});
    });
  }
  function abort(slot: ActiveRun, reason: 'timeout' | 'user_abort'): void {
    if (slot.terminal || slot.reason) return;
    slot.reason = reason;
    slot.agent?.abort();
  }
  function readOrSave<T>(slot: ActiveRun, operation: () => T): T {
    try { return operation(); }
    catch {
      slot.storageFailed = true;
      slot.reason = 'storage_error';
      throw new Error('Unable to save run');
    }
  }
  async function execute(slot: ActiveRun): Promise<void> {
    try {
      const messages = readOrSave(slot, () => storage.loadContext(slot.chatId,slot.runId));
      const previous = readOrSave(slot, () => storage.runs.list(slot.chatId).at(-2));
      const events = createAgentEvents({storage,broker,chatId:slot.chatId,runId:slot.runId,userMessageId:slot.userMessageId,
        onProviderError: reason => { slot.reason ??= reason; }, onEnd: () => finish(slot)});
      slot.agent = createCrewAgent({models,model:slot.model,messages,runId:slot.runId,chatId:slot.chatId,
        todos:options.todoPort ?? storage.todos, requireTodoRefresh:previous?.status === 'interrupted',
        onTurnLimit: () => { slot.reason ??= 'turn_limit'; },
        onEvent: async event => {
          if (slot.storageFailed) {
            if (event.type === 'agent_end') finish(slot);
            return;
          }
          try { await events(event); }
          catch {
            slot.storageFailed = true;
            slot.reason = 'storage_error';
            slot.agent?.abort();
            throw new Error('Unable to save run');
          }
        }
      });
      if (!messages.some(message => message.role === 'system')) {
        const system = slot.agent.state.messages[0];
        if (!system || system.role !== 'system') throw new Error('Missing canonical system');
        readOrSave(slot, () => storage.saveMessage(slot.chatId,null,`${slot.chatId}:system`,system));
      }
      const user = readOrSave(slot, () => storage.runs.messages(slot.chatId).find(message => message.id === slot.userMessageId)!);
      if (slot.reason) finish(slot);
      else await slot.agent.prompt(user.canonical as unknown as Parameters<Storage['saveMessage']>[3]);
    } catch {
      // Event persistence failures take precedence over pi's synthetic aborted message.
      slot.reason ??= 'provider_error';
      try { finish(slot); } catch { /* No terminal notification without a durable commit. */ }
    } finally {
      clearTimeout(slot.timer);
      active.delete(slot.runId);
      // prompt has resolved: all awaited pi listeners and runtime cleanup have settled.
      if (slot.terminal) broker.publish(slot.terminal);
      slot.resolve();
    }
  }

  const manager: RunManager = {
    broker,
    start(chatId, input) {
      const operation = (async () => {
        const prior = storage.runs.findRequest(chatId,input);
        if (prior) return prior;
        if (closed) conflict('Run manager is closed');
        const chat = storage.chats.get(chatId);
        const accepted = await catalog.withProviderLock(chat.providerId, async () => {
          const retried = storage.runs.findRequest(chatId,input);
          if (retried) return retried;
          const current = storage.chats.get(chatId);
          if (current.providerId !== chat.providerId) conflict('Chat selection changed');
          const model = catalog.assertSelection(current.providerId,current.modelId);
          let auth;
          try { auth = await models.getAuth(model); }
          catch { throw new AppError(400,'provider_unavailable','Provider authentication unavailable'); }
          if (!auth) throw new AppError(400,'provider_unavailable','Provider is not configured');
          if (closed) conflict('Run manager is closed');
          const selection = storage.chats.get(chatId);
          if (selection.providerId !== current.providerId || selection.modelId !== current.modelId) conflict('Chat selection changed');
          if (manager.isChatBusy(chatId)) conflict('Chat is running');
          const accepted = storage.runs.accept(chatId,input,SYSTEM_PROMPT);
          if (!accepted.created) return {runId:accepted.run.id,created:false};
          let resolve!: () => void;
          const promise = new Promise<void>(done => { resolve = done; });
          const slot: ActiveRun = {runId:accepted.run.id,chatId,providerId:current.providerId,model,userMessageId:accepted.userMessageId,
            promise,resolve,reason:null,storageFailed:false};
          active.set(slot.runId,slot);
          slot.timer = setTimeout(() => abort(slot,'timeout'),options.timeoutMs ?? 300_000);
          return {runId:slot.runId,created:true};
        });
        // The provider lock protects only admission; prompt/network never hold it.
        if (accepted.created) void execute(active.get(accepted.runId)!);
        return accepted;
      })();
      starting.add(operation);
      void operation.then(() => starting.delete(operation),() => starting.delete(operation));
      return operation;
    },
    abort(runId) { const slot = active.get(runId); if (slot) abort(slot,'user_abort'); },
    async wait(runId) { await active.get(runId)?.promise; },
    snapshot: chatId => snapshot(storage,chatId),
    isChatBusy: chatId => [...active.values()].some(slot => slot.chatId === chatId) || storage.runs.unfinished().some(run => run.chatId === chatId),
    isProviderBusy: providerId => [...active.values()].some(slot => slot.providerId === providerId) || storage.runs.unfinished().some(run => storage.runs.details(run.id).providerId === providerId),
    async close() {
      closed = true;
      const slots = [...active.values()];
      for (const slot of slots) abort(slot,'user_abort');
      await Promise.allSettled([...starting]);
      await Promise.all(slots.map(slot => slot.promise));
    }
  };
  return manager;
}

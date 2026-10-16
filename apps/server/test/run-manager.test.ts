import { afterEach, expect, test, vi } from 'vitest';
import { createModels, fauxProvider, fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai';
import { createStorage } from '../src/storage/index.js';
import { createCatalog } from '../src/providers/catalog.js';
import { SqliteCredentialStore } from '../src/storage/credential-store.js';
import { createRunManager } from '../src/chats/run-manager.js';

test('repeat start does not make a second model request', async () => {
  const storage = createStorage(':memory:');
  const faux = fauxProvider();
  const models = createModels(); models.setProvider(faux.provider);
  const catalog = createCatalog(models, new SqliteCredentialStore(storage));
  const manager = createRunManager({ storage, models, catalog });
  try {
    const model = faux.getModel();
    const chat = storage.chats.create({ providerId: model.provider, modelId: model.id });
    faux.setResponses([fauxAssistantMessage([fauxText('Привет')])]);
    const input = { text: 'Привет', clientRequestId: crypto.randomUUID() };
    const first = await manager.start(chat.id, input);
    await manager.wait(first.runId);
    const second = await manager.start(chat.id, input);
    expect(second).toEqual({ runId: first.runId, created: false });
    expect(faux.state.callCount).toBe(1);
    expect(manager.snapshot(chat.id).messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(manager.snapshot(chat.id).run?.status).toBe('completed');
  } finally { await manager.close(); storage.close(); }
});

import { fauxToolCall } from '@earendil-works/pi-ai';
import type { FauxResponseStep } from '@earendil-works/pi-ai';
import type { CrewEvent } from '@crewbus/contracts';

function fixture(responses: FauxResponseStep[], timeoutMs?: number) {
  const storage = createStorage(':memory:');
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses(responses);
  const catalog = createCatalog(models, new SqliteCredentialStore(storage));
  const manager = createRunManager({ storage, models, catalog, timeoutMs });
  const chat = () => storage.chats.create({providerId:faux.getModel().provider,modelId:faux.getModel().id});
  return { storage, faux, models, catalog, manager, chat,
    close: async () => { await manager.close(); storage.close(); } };
}
const input = (text = 'hello') => ({text,clientRequestId:crypto.randomUUID()});
const toolTurn = (id: string, name = 'todo_list', args: Record<string, unknown> = {}) =>
  fauxAssistantMessage([fauxToolCall(name, args, {id})], {stopReason:'toolUse'});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise,release};
}

test('reserves busy chat, resolves retries before auth, and keeps two chats independent', async () => {
  const blocked = gate();
  const response = async () => { await blocked.promise; return fauxAssistantMessage('answer'); };
  const f = fixture([response,response]);
  try {
    const a = f.chat(), b = f.chat(), request = input();
    const first = await f.manager.start(a.id, request);
    const second = await f.manager.start(b.id, input());
    expect(f.manager.isChatBusy(a.id)).toBe(true);
    expect(f.manager.isProviderBusy(a.providerId)).toBe(true);
    await expect(f.manager.start(a.id, input())).rejects.toMatchObject({statusCode:409});
    await expect(f.manager.start(a.id, {...request,text:'different'})).rejects.toMatchObject({statusCode:409});
    await new Promise(resolve => setTimeout(resolve,0));
    f.models.getAuth = async () => { throw new Error('secret credential'); };
    expect(await f.manager.start(a.id, request)).toEqual({runId:first.runId,created:false});
    expect(f.manager.snapshot(a.id).messages.filter(m => m.role === 'user')).toHaveLength(1);
    blocked.release();
    await Promise.all([f.manager.wait(first.runId), f.manager.wait(second.runId)]);
    for (const [chat, run] of [[a,first],[b,second]] as const) {
      expect(f.storage.events.since(run.runId, 0).every(e => e.chatId === chat.id)).toBe(true);
      expect(f.manager.snapshot(chat.id).run).toMatchObject({id:run.runId,status:'completed'});
    }
  } finally { blocked.release(); await f.close(); }
});

test('persists canonical tools and one actual system, then replays full history on next run', async () => {
  const f = fixture([toolTurn('create','todo_create',{title:'task'}), fauxAssistantMessage([fauxText('one'),fauxText('two')])]);
  try {
    const c = f.chat(); const first = await f.manager.start(c.id,input()); await f.manager.wait(first.runId);
    const messages = f.storage.runs.messages(c.id);
    expect(messages.map(m => m.role)).toEqual(['system','user','assistant','toolResult','assistant']);
    expect(messages[0]).toMatchObject({ordinal:0,canonical:{toolsAdded:expect.any(Array)}});
    expect(f.manager.snapshot(c.id).messages.at(-1)?.text).toBe('onetwo');
    const tool = f.manager.snapshot(c.id).messages.find(m => m.tools.length)?.tools[0];
    expect(tool).toMatchObject({id:'create',name:'todo_create',input:{title:'task'},state:'completed',output:{title:'task'}});
    expect(f.storage.events.since(first.runId,0).some(e => e.data.type === 'todos.changed')).toBe(true);
    f.faux.setResponses([context => {
      expect(context.messages.filter(m => m.role === 'system')).toHaveLength(1);
      expect(context.messages.filter(m => m.role === 'user')).toHaveLength(2);
      expect(context.messages.some(m => m.role === 'toolResult')).toBe(true);
      return fauxAssistantMessage('next');
    }]);
    const second = await f.manager.start(c.id,input('next')); await f.manager.wait(second.runId);
    expect(f.storage.runs.messages(c.id).filter(m => m.role === 'system')).toHaveLength(1);
    expect(f.manager.snapshot(c.id).messages.filter(m => m.role === 'user')).toHaveLength(2);
    expect(f.manager.snapshot(c.id).lastEventId).toBe(f.storage.events.cursor(second.runId));
  } finally { await f.close(); }
});

test('disconnected and throwing observers do not stop execution; terminal observer sees idle chat', async () => {
  const blocked = gate(); const f = fixture([async () => { await blocked.promise; return fauxAssistantMessage('ok'); }]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input());
    let disconnectedCalls = 0; const events: CrewEvent[] = [];
    const committed: boolean[] = []; let busyAtTerminal: boolean | undefined;
    const unsubscribe = f.manager.broker.subscribe(r.runId, () => { disconnectedCalls++; }); unsubscribe();
    f.manager.broker.subscribe(r.runId, () => { throw new Error('broken socket'); });
    f.manager.broker.subscribe(r.runId, event => {
      events.push(event);
      committed.push(f.storage.events.since(r.runId,0).some(saved => JSON.stringify(saved) === JSON.stringify(event)));
      if (event.data.type === 'run.finished') busyAtTerminal = f.manager.isChatBusy(c.id);
    });
    blocked.release(); await f.manager.wait(r.runId);
    expect(disconnectedCalls).toBe(0);
    expect(committed.every(Boolean)).toBe(true); expect(busyAtTerminal).toBe(false);
    expect(events.at(-1)?.data.type).toBe('run.finished');
    expect(f.storage.runs.get(r.runId).status).toBe('completed');
  } finally { blocked.release(); await f.close(); }
});

test.each(['user_abort','timeout'] as const)('aborts delayed run with reason %s and settles once', async reason => {
  const blocked = gate(); const f = fixture([async () => { await blocked.promise; return toolTurn('late'); }],reason === 'timeout' ? 5 : undefined);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input());
    if (reason === 'user_abort') f.manager.abort(r.runId);
    else await new Promise(resolve => setTimeout(resolve,20));
    blocked.release(); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'aborted',reason});
    const count = f.faux.state.callCount;
    f.manager.abort(r.runId); await f.manager.wait(r.runId);
    expect(f.faux.state.callCount).toBe(count);
    expect(f.storage.events.since(r.runId,0).filter(e => e.data.type === 'run.finished')).toHaveLength(1);
  } finally { blocked.release(); await f.close(); }
});

test.each([false,true])('enforces twenty turns, final text=%s', async finalText => {
  const f = fixture([...Array.from({length:19},(_,i) => toolTurn(`t${i}`)),finalText ? fauxAssistantMessage('done') : toolTurn('t20')]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.faux.state.callCount).toBe(20);
    expect(f.storage.runs.get(r.runId)).toMatchObject(finalText ? {status:'completed',reason:null} : {status:'failed',reason:'turn_limit'});
  } finally { await f.close(); }
});

test('sanitizes provider failures in public events and canonical assistant errorMessage', async () => {
  const f = fixture([() => { throw new Error('api-key=super-secret'); }]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'failed',reason:'provider_error'});
    expect(JSON.stringify(f.storage.runs.messages(c.id))).not.toContain('super-secret');
    expect(JSON.stringify(f.storage.events.since(r.runId,0))).not.toContain('super-secret');
  } finally { await f.close(); }
});

test('message save failure rolls back completed event and fails without repeating prompt', async () => {
  const f = fixture([fauxAssistantMessage('answer')]);
  try {
    const c = f.chat();
    f.storage.database.exec("CREATE TRIGGER fail_assistant BEFORE INSERT ON messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(FAIL,'disk failure'); END");
    const r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'failed',reason:'storage_error'});
    expect(f.storage.events.since(r.runId,0).filter(e => e.data.type === 'message.completed' && e.data.message.role === 'assistant')).toEqual([]);
    expect(f.storage.runs.messages(c.id).filter(m => m.role === 'assistant')).toEqual([]);
    expect(f.faux.state.callCount).toBe(1);
  } finally { await f.close(); }
});

test('initial system storage failure is storage_error without a model call', async () => {
  const f = fixture([fauxAssistantMessage('unused')]);
  try {
    const c = f.chat();
    f.storage.database.exec("CREATE TRIGGER fail_system BEFORE INSERT ON messages WHEN NEW.role='system' BEGIN SELECT RAISE(FAIL,'disk failure'); END");
    const r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'failed',reason:'storage_error'});
    expect(f.faux.state.callCount).toBe(0);
  } finally { await f.close(); }
});

test('factory exception after admission produces a safe terminal failure and releases slot', async () => {
  const f = fixture([]);
  try {
    const c = f.chat();
    Object.defineProperty(f.models,'streamSimple',{get() { throw new Error('factory secret'); }});
    const r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'failed',reason:'provider_error'});
    expect(f.manager.isChatBusy(c.id)).toBe(false);
    expect(JSON.stringify(f.storage.events.since(r.runId,0))).not.toContain('secret');
    expect(f.storage.events.since(r.runId,0).at(-1)?.data.type).toBe('run.finished');
  } finally { await f.close(); }
});

test('event append failure rolls back its canonical save and never publishes completion', async () => {
  const blocked = gate(); const f = fixture([async () => { await blocked.promise; return fauxAssistantMessage('answer'); }]);
  try {
    const c = f.chat();
    f.storage.database.exec(`CREATE TRIGGER fail_completed BEFORE INSERT ON events WHEN json_extract(NEW.data_json,'$.type')='message.completed' BEGIN SELECT RAISE(FAIL,'disk failure'); END`);
    const r = await f.manager.start(c.id,input()); const observed: CrewEvent[] = [];
    f.manager.broker.subscribe(r.runId,event => observed.push(event));
    blocked.release(); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'failed',reason:'storage_error'});
    expect(f.storage.runs.messages(c.id).filter(m => m.role === 'assistant')).toEqual([]);
    expect(observed.some(e => e.data.type === 'message.completed')).toBe(false);
    expect(f.faux.state.callCount).toBe(1);
  } finally { blocked.release(); await f.close(); }
});

test('terminal append failure rolls back status and publishes no false success', async () => {
  const f = fixture([fauxAssistantMessage('answer')]);
  try {
    const c = f.chat();
    f.storage.database.exec(`CREATE TRIGGER fail_finished BEFORE INSERT ON events WHEN json_extract(NEW.data_json,'$.type')='run.finished' BEGIN SELECT RAISE(FAIL,'disk failure'); END`);
    const r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId).status).toBe('running');
    expect(f.storage.events.since(r.runId,0).some(e => e.data.type === 'run.finished')).toBe(false);
    expect(f.faux.state.callCount).toBe(1);
  } finally { await f.close(); }
});

test('tool error remains a canonical result and can be handled by the model', async () => {
  const f = fixture([toolTurn('missing','todo_delete',{id:'missing'}),fauxAssistantMessage('handled')]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.storage.runs.get(r.runId).status).toBe('completed');
    expect(f.manager.snapshot(c.id).messages.find(m => m.tools.length)?.tools[0]).toMatchObject({state:'failed',error:'Tool execution failed'});
    expect(f.storage.runs.messages(c.id).find(m => m.role === 'toolResult')?.canonical).toMatchObject({isError:true});
  } finally { await f.close(); }
});

test('same request concurrently admitted once and input validation precedes auth', async () => {
  const f = fixture([fauxAssistantMessage('answer')]);
  try {
    const c = f.chat(), request = input();
    const [a,b] = await Promise.all([f.manager.start(c.id,request),f.manager.start(c.id,request)]);
    expect(a.runId).toBe(b.runId); expect([a.created,b.created]).toEqual([true,false]);
    await f.manager.wait(a.runId); expect(f.faux.state.callCount).toBe(1);
    f.models.getAuth = async () => { throw new Error('secret'); };
    await expect(f.manager.start(c.id,input(' '))).rejects.toMatchObject({statusCode:400,code:'invalid_input'});
    await expect(f.manager.start(c.id,input('x'.repeat(16001)))).rejects.toMatchObject({statusCode:400,code:'invalid_input'});
    await expect(f.manager.start(c.id,input())).rejects.toMatchObject({message:'Provider authentication unavailable'});
  } finally { await f.close(); }
});

test('close waits for an active provider to settle before allowing storage close', async () => {
  const blocked = gate(); const entered = gate();
  const f = fixture([async () => { entered.release(); await blocked.promise; return toolTurn('late'); }]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input()); await entered.promise;
    let settled = false; const closing = f.manager.close().then(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve,2));
    expect(settled).toBe(false); expect(f.manager.isChatBusy(c.id)).toBe(true);
    blocked.release(); await closing;
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'aborted',reason:'user_abort'});
    expect(f.faux.state.callCount).toBe(1);
    await expect(f.manager.start(c.id,input())).rejects.toMatchObject({statusCode:409});
  } finally { blocked.release(); await f.close(); }
});

import { fauxThinking } from '@earendil-works/pi-ai';
import { reduceChat } from '@crewbus/contracts';
import type { ChatSnapshot } from '@crewbus/contracts';

test('partial snapshot and replay share cursor, skip thinking, and preserve accepted user identity', async () => {
  const blocked = gate(); const f = fixture([async context => {
    await blocked.promise;
    const user = context.messages.find(m => m.role === 'user');
    expect(user).toMatchObject({role:'user',content:'hello'});
    return fauxAssistantMessage([fauxThinking('private reasoning'),fauxText('visible text')]);
  }]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input());
    let replay = f.manager.snapshot(c.id);
    const partials: ChatSnapshot[] = [];
    const mismatches: boolean[] = [];
    f.manager.broker.subscribe(r.runId,event => {
      replay = reduceChat(replay,event);
      const actual = f.manager.snapshot(c.id);
      mismatches.push(JSON.stringify(actual) !== JSON.stringify(replay));
      if (event.data.type === 'message.delta') partials.push(actual);
    });
    blocked.release(); await f.manager.wait(r.runId);
    expect(mismatches).not.toContain(true);
    expect(partials.length).toBeGreaterThan(0);
    expect(partials[0]?.messages.at(-1)?.state).toBe('streaming');
    expect(replay.messages.map(m => m.text)).toEqual(['hello','visible text']);
    expect(replay.messages[0]?.id).toBe(f.storage.runs.details(r.runId).userMessageId);
    expect(JSON.stringify(f.storage.events.since(r.runId,0))).not.toContain('private reasoning');
    expect(JSON.stringify(f.storage.runs.messages(c.id))).toContain('private reasoning');
  } finally { blocked.release(); await f.close(); }
});

test('interrupted predecessor requires successful todo refresh before mutations', async () => {
  const f = fixture([toolTurn('blocked','todo_create',{title:'blocked'}),toolTurn('refresh'),toolTurn('allowed','todo_create',{title:'allowed'}),fauxAssistantMessage('done')]);
  try {
    const c = f.chat();
    const interrupted = f.storage.runs.accept(c.id,input('earlier'),'previous');
    f.storage.runs.finish(interrupted.run.id,'interrupted','process_restart');
    const r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    expect(f.storage.todos.list(c.id).map(todo => todo.title)).toEqual(['allowed']);
    expect(f.storage.runs.messages(c.id).filter(m => m.role === 'toolResult').map(m => (m.canonical as {isError:boolean}).isError)).toEqual([true,false,false]);
    expect(f.manager.snapshot(c.id).run?.status).toBe('completed');
  } finally { await f.close(); }
});

test('abort after committed tool result preserves its effect and canonical result', async () => {
  const blocked = gate(); const f = fixture([async () => { await blocked.promise; return toolTurn('created','todo_create',{title:'kept'}); },fauxAssistantMessage('unused')]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input());
    f.manager.broker.subscribe(r.runId,event => { if (event.data.type === 'tool.completed') f.manager.abort(r.runId); });
    blocked.release(); await f.manager.wait(r.runId);
    expect(f.storage.todos.list(c.id).map(todo => todo.title)).toEqual(['kept']);
    expect(f.storage.runs.messages(c.id).find(m => m.role === 'toolResult')?.canonical).toMatchObject({isError:false,toolCallId:'created'});
    expect(f.storage.runs.get(r.runId)).toMatchObject({status:'aborted',reason:'user_abort'});
    expect(f.faux.state.callCount).toBe(1);
  } finally { blocked.release(); await f.close(); }
});

test('completed run is immutable and unavailable auth cannot accept a new run', async () => {
  const f = fixture([fauxAssistantMessage('done')]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id,input()); await f.manager.wait(r.runId);
    const finished = f.storage.runs.get(r.runId);
    f.manager.abort(r.runId);
    f.storage.runs.finish(r.runId,'aborted','timeout');
    expect(f.storage.runs.get(r.runId)).toEqual(finished);
    f.models.getAuth = async () => undefined;
    await expect(f.manager.start(c.id,input())).rejects.toMatchObject({code:'provider_unavailable'});
    expect(f.storage.runs.list(c.id)).toHaveLength(1);
    expect(f.storage.runs.messages(c.id).filter(m => m.role === 'user')).toHaveLength(1);
  } finally { await f.close(); }
});

test('shutdown waits for pending auth, rejects admission, and accepts no model or user work',async()=>{
 const f=fixture([fauxAssistantMessage('unused')]),entered=gate(),release=gate();
 try{
  const c=f.chat();f.models.getAuth=async()=>{entered.release();await release.promise;return {apiKey:'test'} as Awaited<ReturnType<typeof f.models.getAuth>>;};
  const admission=f.manager.start(c.id,input());const rejected=expect(admission).rejects.toMatchObject({statusCode:409});await entered.promise;
  let closed=false;const closing=f.manager.close().then(()=>{closed=true;});
  await Promise.resolve();expect(closed).toBe(false);expect(f.storage.database.isOpen).toBe(true);
  release.release();await rejected;await closing;
  expect(f.storage.runs.list(c.id)).toEqual([]);expect(f.storage.runs.messages(c.id)).toEqual([]);expect(f.faux.state.callCount).toBe(0);
 }finally{release.release();await f.close();}
});

test('context overflow is classified before diagnostics are sanitized without retries or secret leakage',async()=>{
 const f=fixture([fauxAssistantMessage('',{stopReason:'error',errorMessage:'maximum context length exceeded api-key=super-secret'})]);
 try{
  const c=f.chat(),r=await f.manager.start(c.id,input());await f.manager.wait(r.runId);
  expect(f.storage.runs.get(r.runId)).toMatchObject({status:'failed',reason:'context_overflow'});
  expect(JSON.stringify(f.storage.runs.messages(c.id))).not.toContain('super-secret');
  expect(JSON.stringify(f.storage.events.since(r.runId,0))).not.toContain('super-secret');
  expect(f.manager.snapshot(c.id).run?.reason).toBe('context_overflow');expect(f.faux.state.callCount).toBe(1);
 }finally{await f.close();}
});

test('pending admission auth does not delay aborting an already active run',async()=>{
 const provider=gate(),entered=gate(),auth=gate(),authEntered=gate();
 const f=fixture([async()=>{entered.release();await provider.promise;return toolTurn('late','todo_create',{title:'must not run'});}]);
 try{
  const a=f.chat(),b=f.chat(),run=await f.manager.start(a.id,input());await entered.promise;
  f.models.getAuth=async()=>{authEntered.release();await auth.promise;return undefined;};
  const admission=f.manager.start(b.id,input());const rejected=expect(admission).rejects.toMatchObject({code:'provider_unavailable'});await authEntered.promise;
  const closing=f.manager.close();provider.release();await f.manager.wait(run.runId);
  expect(f.storage.runs.get(run.runId)).toMatchObject({status:'aborted',reason:'user_abort'});
  expect(f.storage.todos.list(a.id)).toEqual([]);
  auth.release();await rejected;await closing;
 }finally{provider.release();auth.release();await f.close();}
});


afterEach(() => vi.unstubAllGlobals());
test.each(['exa', 'parallel'])('persists %s search results across reloads without todo changes', async provider => {
  vi.stubGlobal('fetch', async () => Response.json({ jsonrpc: '2.0', id: 1,
    result: { content: [{ type: 'text', text: 'Title: Node.js\nURL: https://nodejs.org/' }] } }));
  const f = fixture([toolTurn('search', 'web_search', { query: 'Node.js', provider }), fauxAssistantMessage('Found Node.js'),
    context => {
      expect(context.messages.find(m => m.role === 'toolResult' && m.toolName === 'web_search')).toMatchObject({
        isError: false, details: { provider, query: 'Node.js' },
      });
      return fauxAssistantMessage('Remembered source');
    }]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id, input('Search'));
    await f.manager.wait(r.runId);
    const view = f.manager.snapshot(c.id);
    expect(view.run?.status).toBe('completed');
    expect(view.messages.flatMap(m => m.tools)).toMatchObject([{ name: 'web_search', state: 'completed',
      output: { provider, query: 'Node.js', text: 'Title: Node.js\nURL: https://nodejs.org/' } }]);
    expect(f.storage.events.since(r.runId, 0).filter(event => event.data.type === 'todos.changed')).toEqual([]);
    const next = await f.manager.start(c.id, input('Remember'));
    await f.manager.wait(next.runId);
    expect(f.faux.state.callCount).toBe(3);
    expect(f.storage.todos.list(c.id)).toEqual([]);
  } finally { await f.close(); }
});

test('aborting a pending search cancels its HTTP request and settles the run', async () => {
  const entered = gate();
  let cancelled = false;
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => { cancelled = true; reject(init.signal!.reason); }, { once: true });
    entered.release();
  }));
  const f = fixture([toolTurn('search', 'web_search', { query: 'Node.js' }), fauxAssistantMessage('unused')]);
  try {
    const c = f.chat(), r = await f.manager.start(c.id, input('Search'));
    await entered.promise;
    f.manager.abort(r.runId);
    await f.manager.wait(r.runId);
    expect(cancelled).toBe(true);
    expect(f.storage.runs.get(r.runId)).toMatchObject({ status: 'aborted', reason: 'user_abort' });
    expect(f.faux.state.callCount).toBe(1);
    expect(f.storage.todos.list(c.id)).toEqual([]);
  } finally { await f.close(); }
});

import { expect, test } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createStorage } from '../src/storage/index.js';
import { recoverInterrupted } from '../src/chats/recovery.js';
import { snapshot } from '../src/chats/snapshot.js';

test('committed tool survives missing result and missing public parent idempotently', () => {
  const s = createStorage(':memory:');
  try {
    const chat = s.chats.create({providerId:'faux',modelId:'faux-model'});
    const accepted = s.runs.accept(chat.id,{text:'create',clientRequestId:crypto.randomUUID()},'system');
    s.saveMessage(chat.id,accepted.run.id,'assistant-1',fauxAssistantMessage([fauxToolCall('todo_create',{title:'kept'},{id:'call-1'})],{stopReason:'toolUse'}));
    const result = s.todos.apply({chatId:chat.id,runId:accepted.run.id,toolCallId:'call-1'},'todo_create',{title:'kept'});
    recoverInterrupted(s);
    expect(s.runs.get(accepted.run.id)).toMatchObject({status:'interrupted',reason:'process_restart'});
    expect(snapshot(s,chat.id).messages.find(m => m.id === 'assistant-1')?.tools[0]).toMatchObject({state:'completed',output:result});
    expect(s.runs.messages(chat.id).filter(m => m.role === 'toolResult')).toHaveLength(1);
    const events = s.events.since(accepted.run.id,0);
    expect(events.map(e => e.data.type)).toEqual(['message.started','tool.started','tool.completed','todos.changed','run.finished']);
    const journal = s.database.prepare('SELECT created_at, result_json FROM tool_results WHERE run_id=?').get(accepted.run.id)!;
    expect(s.runs.messages(chat.id).find(m => m.role === 'toolResult')?.canonical).toMatchObject({
      toolCallId:'call-1', toolName:'todo_create',isError:false,timestamp:journal.created_at,
      content:[{type:'text',text:journal.result_json}]
    });
    recoverInterrupted(s);
    expect(s.todos.list(chat.id)).toHaveLength(1);
    expect(s.events.since(accepted.run.id,0)).toEqual(events);
    expect(events.filter(e => e.data.type === 'run.finished')).toHaveLength(1);
  } finally { s.close(); }
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxProvider } from '@earendil-works/pi-ai';
import { createApp } from '../src/app.js';
import { crashRun } from './fixtures/crash-after-tool.js';
import type { AgentMessage } from '../src/storage/context.js';

function coherent(messages: AgentMessage[]) {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === 'toolResult') throw new Error('orphan toolResult');
    if (message.role !== 'assistant') continue;
    expect(['aborted','error']).not.toContain(message.stopReason);
    const calls = message.content.filter(b => b.type === 'toolCall');
    const results = messages.slice(i + 1,i + 1 + calls.length);
    expect(results.map(m => m.role)).toEqual(calls.map(() => 'toolResult'));
    for (const call of calls) expect(results.filter(m => m.role === 'toolResult' && m.toolCallId === call.id && m.toolName === call.name)).toHaveLength(1);
    i += calls.length;
  }
}

test.each(['before-commit','after-commit','after-tool-end','partial-text'] as const)('real process death at %s recovers before routes and never replays', async phase => {
  const dir = await mkdtemp(join(tmpdir(),'crewbus-recovery-'));
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const crash = await crashRun(dir,phase);
    expect(crash.modelCalls).toBe(1);
    app = await createApp({dataDir:dir,models});
    const response = await app.inject({method:'GET',url:`/api/chats/${crash.chatId}`});
    expect(response.statusCode).toBe(200);
    const view = app.runs.snapshot(crash.chatId);
    expect(view.run).toMatchObject({status:'interrupted',reason:'process_restart'});
    expect(faux.state.callCount).toBe(0);
    const committed = phase === 'after-commit' || phase === 'after-tool-end';
    expect(view.todos).toHaveLength(committed ? 1 : 0);
    const messages = app.storage.runs.messages(crash.chatId);
    expect(messages.filter(m => m.role === 'system')).toHaveLength(1);
    expect(messages[0]).toMatchObject({ordinal:0,canonical:{toolsAdded:expect.any(Array)}});
    expect(messages.filter(m => m.role === 'toolResult')).toHaveLength(committed ? 1 : 0);
    if (committed) expect(view.messages.find(m => m.tools.length)?.tools[0]).toMatchObject({state:'completed',output:view.todos[0]});
    if (phase === 'partial-text') expect(view.messages.at(-1)).toMatchObject({state:'interrupted',text:expect.stringMatching(/\S/)});
    const events = app.storage.events.since(crash.runId,0);
    expect(events.filter(e => e.data.type === 'tool.completed')).toHaveLength(committed ? 1 : 0);
    recoverInterrupted(app.storage);
    expect(app.storage.events.since(crash.runId,0)).toEqual(events);
    const observed: AgentMessage[][] = [];
    const turn = (id: string,name: string,args: Record<string,unknown>) => fauxAssistantMessage([fauxToolCall(name,args,{id})],{stopReason:'toolUse'});
    faux.setResponses([
      context => { observed.push(structuredClone(context.messages)); return turn('blocked','todo_create',{title:'must not create'}); },
      turn('bad-list','todo_list',{completed:'invalid'}),
      turn('still-blocked','todo_create',{title:'must not create either'}),
      turn('list','todo_list',{}),
      ...(committed ? [turn('update','todo_update',{id:view.todos[0]!.id,completed:true})] : []),
      context => { observed.push(structuredClone(context.messages)); return fauxAssistantMessage('Recovered'); }
    ]);
    const next = await app.runs.start(crash.chatId,{text:'Continue',clientRequestId:crypto.randomUUID()});
    await app.runs.wait(next.runId);
    expect(app.storage.runs.get(next.runId).status).toBe('completed');
    expect(observed).toHaveLength(2);
    observed.forEach(coherent);
    expect(observed[0]!.filter(m => m.role === 'system')).toHaveLength(1);
    expect(observed[0]!.some(m => m.role === 'assistant')).toBe(committed);
    expect(app.storage.todos.list(crash.chatId)).toHaveLength(committed ? 1 : 0);
    if (committed) expect(app.storage.todos.list(crash.chatId)[0]!.completed).toBe(true);
  } finally { await app?.close(); await rm(dir,{recursive:true,force:true}); }
});

test('mixed incomplete tool groups and aborted tails are excluded, while UI and complete groups survive', () => {
  const s = createStorage(':memory:');
  try {
    const chat = s.chats.create({providerId:'faux',modelId:'faux-model'});
    const run = s.runs.accept(chat.id,{text:'start',clientRequestId:'first'},'system').run;
    const assistant = fauxAssistantMessage([
      fauxToolCall('todo_create',{title:'kept'},{id:'saved'}),
      fauxToolCall('todo_create',{title:'never committed'},{id:'missing'})
    ],{stopReason:'toolUse'});
    s.saveMessage(chat.id,run.id,'mixed',assistant);
    s.events.append(run.id,{type:'message.started',message:{id:'mixed',role:'assistant',text:'Fuller visible text',state:'streaming',tools:[]}});
    s.todos.apply({chatId:chat.id,runId:run.id,toolCallId:'saved'},'todo_create',{title:'kept'});
    recoverInterrupted(s);
    expect(snapshot(s,chat.id).messages.find(m => m.id === 'mixed')).toMatchObject({text:'Fuller visible text',state:'interrupted',tools:[{state:'completed'},{id:'missing',state:'interrupted',output:null}]});
    const next = s.runs.accept(chat.id,{text:'next',clientRequestId:'next'},'system');
    expect(s.loadContext(chat.id,next.run.id).map(m => m.role)).toEqual(['user']);
    s.saveMessage(chat.id,next.run.id,'aborted',fauxAssistantMessage('partial',{stopReason:'aborted'}));
    s.saveMessage(chat.id,next.run.id,'orphan',{role:'toolResult',toolCallId:'orphan',toolName:'todo_list',content:[],isError:false,timestamp:1});
    recoverInterrupted(s);
    const last = s.runs.accept(chat.id,{text:'last',clientRequestId:'last'},'system');
    expect(s.loadContext(chat.id,last.run.id).map(m => m.role)).toEqual(['user','user']);
  } finally { s.close(); }
});

test('recovers both chats and rolls back the entire reconciliation if terminal persistence fails', () => {
  const s = createStorage(':memory:');
  try {
    const pending = Array.from({length:2},() => {
      const chat = s.chats.create({providerId:'faux',modelId:'faux-model'});
      const {run} = s.runs.accept(chat.id,{text:'start',clientRequestId:crypto.randomUUID()},'system');
      s.saveMessage(chat.id,run.id,`${run.id}:assistant`,fauxAssistantMessage([fauxToolCall('todo_create',{title:'kept'},{id:'call'})],{stopReason:'toolUse'}));
      s.todos.apply({chatId:chat.id,runId:run.id,toolCallId:'call'},'todo_create',{title:'kept'});
      return {chat,run};
    });
    s.database.exec("CREATE TRIGGER fail_recovery BEFORE INSERT ON events WHEN json_extract(NEW.data_json,'$.type')='run.finished' BEGIN SELECT RAISE(FAIL,'disk failure'); END");
    expect(() => recoverInterrupted(s)).toThrow();
    for (const {chat,run} of pending) {
      expect(s.runs.get(run.id).status).toBe('running');
      expect(s.events.since(run.id,0)).toEqual([]);
      expect(s.runs.messages(chat.id).filter(m => m.role === 'toolResult')).toEqual([]);
    }
    s.database.exec('DROP TRIGGER fail_recovery');
    recoverInterrupted(s);
    for (const {chat,run} of pending) {
      expect(s.runs.get(run.id).status).toBe('interrupted');
      expect(snapshot(s,chat.id).todos).toHaveLength(1);
    }
  } finally { s.close(); }
});

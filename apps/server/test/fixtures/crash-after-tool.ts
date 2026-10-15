import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createStorage } from '../../src/storage/index.js';
import { createCatalog } from '../../src/providers/catalog.js';
import { SqliteCredentialStore } from '../../src/storage/credential-store.js';
import { createRunManager } from '../../src/chats/run-manager.js';

export type CrashPhase = 'before-commit' | 'after-commit' | 'after-tool-end' | 'partial-text';
export interface CrashEvidence { chatId: string; runId: string; phase: CrashPhase; modelCalls: number }

/** Parent kills a real child blocked at the requested persistence boundary. */
export function crashRun(dataDir: string, phase: CrashPhase = 'after-commit'): Promise<CrashEvidence> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [dataDir, phase], {execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
    let evidence: CrashEvidence | undefined, stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Crash fixture timed out: ${stderr}`)); }, 15000);
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('message', message => { evidence = message as CrashEvidence; child.kill('SIGKILL'); });
    child.on('exit', (_code, signal) => {
      clearTimeout(timer);
      if (evidence && signal === 'SIGKILL') resolve(evidence);
      else reject(new Error(`Fixture exited before boundary: ${stderr}`));
    });
  });
}

if (process.send && process.argv[1] === fileURLToPath(import.meta.url)) {
  const storage = createStorage(process.argv[2]!);
  const phase = process.argv[3] as CrashPhase;
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  const catalog = createCatalog(models,new SqliteCredentialStore(storage));
  const model = faux.getModel();
  const chat = storage.chats.create({providerId:model.provider,modelId:model.id});
  const stop = (runId: string): never => {
    process.send!({chatId:chat.id,runId,phase,modelCalls:faux.state.callCount});
    // No callback or promise continuation can deliver the result to the agent.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
    throw new Error('Unreachable crash boundary');
  };
  const save = storage.saveMessage;
  storage.saveMessage = (...args) => {
    if (phase === 'after-tool-end' && args[3].role === 'toolResult') stop(args[1]!);
    save(...args);
  };
  const manager = createRunManager({storage,models,catalog,todoPort:{apply(context,name,input,signal) {
    if (phase === 'before-commit') stop(context.runId);
    const result = storage.todos.apply(context,name,input,signal);
    if (phase === 'after-commit') stop(context.runId);
    return result;
  }}});
  faux.setResponses([phase === 'partial-text' ? fauxAssistantMessage('Unfinished answer') : fauxAssistantMessage([fauxToolCall('todo_create',{title:'Recovered task'},{id:'crashed-create'})],{stopReason:'toolUse'})]);
  const started = await manager.start(chat.id,{text:'Crash recovery request',clientRequestId:crypto.randomUUID()});
  if (phase === 'partial-text') manager.broker.subscribe(started.runId,event => { if (event.data.type === 'message.delta') stop(started.runId); });
  await manager.wait(started.runId);
  throw new Error('Did not reach requested crash boundary');
}

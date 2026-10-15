import { expect,test } from 'vitest';
import { createApp } from '../src/app.js';
import { createModels,fauxProvider,fauxAssistantMessage } from '@earendil-works/pi-ai';
import { parseCursor } from '../src/events/sse.js';
import type { CrewEvent } from '@crewbus/contracts';

test('cursor rejects malformed or future values with header precedence',()=>{
 expect(parseCursor('1','0',2)).toBe(1);
 for(const cursor of ['-1','1.5','3','01','9007199254740992','']) expect(()=>parseCursor(undefined,cursor,2)).toThrow();
});
test('real HTTP disconnect/reconnect replays durable events and terminal EOF without model retry',async()=>{
 const faux=fauxProvider(), models=createModels();models.setProvider(faux.provider);
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 faux.setResponses([async()=>{await gate;return fauxAssistantMessage('answer');}]);
 const app=await createApp({dataDir:':memory:',models});
 try{
 const m=faux.getModel();const chat=app.storage.chats.create({providerId:m.provider,modelId:m.id});
 const input={text:'hello',clientRequestId:'same'};
 const first=await app.inject({method:'POST',url:`/api/chats/${chat.id}/runs`,payload:input});expect(first.statusCode).toBe(202);
 const {runId}=first.json();const cursor=app.runs.snapshot(chat.id).lastEventId;
 const address=await app.listen({host:'127.0.0.1',port:0}); const endpoint=`${address}/api/runs/${runId}/events`;
 const response=await fetch(`${endpoint}?after=${cursor}`);expect(response.headers.get('content-type')).toContain('text/event-stream');
 await response.body!.cancel();
 for(const [url,payload] of [[`/api/chats/${chat.id}`,{providerId:m.provider,modelId:m.id}],[`/api/chats/${chat.id}/todos`,{title:'busy'}]] as const) expect((await app.inject({method:url.endsWith('todos')?'POST':'PATCH',url,payload})).statusCode).toBe(409);
 expect((await app.inject({method:'DELETE',url:`/api/providers/${m.provider}/credential`})).statusCode).toBe(409);
 release();await app.runs.wait(runId);
 const replay=await fetch(`${endpoint}?after=99999`,{headers:{'Last-Event-ID':String(cursor)}});expect(replay.status).toBe(200);
 const text=await replay.text(); const events=text.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)) as CrewEvent);
 expect(events.length).toBeGreaterThan(0);expect(events.at(-1)?.data.type).toBe('run.finished');
 expect(events.map(e=>e.id)).toEqual([...new Set(events.map(e=>e.id))].sort((a,b)=>a-b));expect(events.every(e=>e.id>cursor)).toBe(true);
 const maximum=app.storage.events.cursor(runId);expect(await (await fetch(`${endpoint}?after=${maximum}`)).text()).toBe('');
 for(const value of ['-1','1.5',String(maximum+1)]) expect((await fetch(`${endpoint}?after=${value}`)).status).toBe(400);
 expect((await fetch(`${address}/api/runs/missing/events`)).status).toBe(404);
 expect((await app.inject({method:'POST',url:`/api/chats/${chat.id}/runs`,payload:input})).json()).toEqual({runId});
 expect((await app.inject({method:'POST',url:`/api/runs/${runId}/abort`})).statusCode).toBe(202);expect(faux.state.callCount).toBe(1);
 }finally{release();await app.close();}
});

test('real HTTP writer waits for drain; queue overflow closes only connection and all events replay',async()=>{
 const app=await createApp({dataDir:':memory:'});
 const model=app.catalog.listModels('openai')[0]!;const chat=app.storage.chats.create({providerId:'openai',modelId:model.id});
 const accepted=app.storage.runs.accept(chat.id,{text:'hello',clientRequestId:'pressure'},'system');const id=accepted.run.id;
 let blocked=false, writes=0, resume:()=>void=()=>{};
 app.addHook('onRequest',async(req,reply)=>{
  if(req.headers['x-test-pressure']!=='yes')return;
  const raw=reply.raw, original=raw.write.bind(raw);
  raw.write=((...args:Parameters<typeof raw.write>)=>{
   writes++;if(writes===1){blocked=true;resume=()=>{blocked=false;raw.emit('drain');};original(...args);return false;}
   expect(blocked).toBe(false);return original(...args);
  }) as typeof raw.write;
 });
 try{
 const address=await app.listen({host:'127.0.0.1',port:0});const endpoint=`${address}/api/runs/${id}/events`;
 const connection=await fetch(endpoint,{headers:{'x-test-pressure':'yes'}});const reader=connection.body!.getReader();
 const publish=()=>{const event=app.storage.events.append(id,{type:'message.delta',messageId:'a',delta:'x'});app.runs.broker.publish(event);};
 publish();await reader.read();expect(writes).toBe(1);publish();await new Promise(r=>setTimeout(r,5));expect(writes).toBe(1);
 resume();await reader.read();expect(writes).toBe(2);await reader.cancel();
 // A second stalled connection fills its live queue without blocking persistence.
 writes=0;
 const overflow=await fetch(endpoint+'?after=2',{headers:{'x-test-pressure':'yes'}});const slow=overflow.body!.getReader();publish();await slow.read();
 for(let i=0;i<257;i++)publish();
 await expect(slow.read()).rejects.toThrow();
 expect(app.storage.events.cursor(id)).toBe(260);expect(app.storage.runs.get(id).status).toBe('running');
 const run=app.storage.runs.finish(id,'completed');const terminal=app.storage.events.append(id,{type:'run.finished',run});app.runs.broker.publish(terminal);
 const recovered=await (await fetch(endpoint+'?after=2')).text();expect(recovered.split('\ndata: ').length-1).toBe(259);expect(recovered).toContain('run.finished');
 }finally{resume();await app.close();}
});

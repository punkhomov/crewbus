import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';
test('manual update cannot change another chat todo and rejects malformed inputs', async () => {
 const app = await createApp({dataDir:':memory:'});
 try {
 const model=app.catalog.listModels('openai')[0]!; const selection={providerId:'openai',modelId:model.id};
 const create=async()=> (await app.inject({method:'POST',url:'/api/chats',payload:selection})).json();
 const a=await create(), b=await create();
 expect(a.id).toEqual(expect.any(String));
 expect((await app.inject('/api/chats')).json()).toHaveLength(2);
 expect((await app.inject(`/api/chats/${a.id}`)).json().chat).toEqual(a);
 for(const payload of [{...selection,extra:1},{providerId:1,modelId:model.id}]) expect((await app.inject({method:'POST',url:'/api/chats',payload})).statusCode).toBe(400);
 const created=await app.inject({method:'POST',url:`/api/chats/${a.id}/todos`,payload:{title:'task'}});expect(created.statusCode).toBe(201);const task=created.json();
 expect((await app.inject({method:'PATCH',url:`/api/chats/${b.id}/todos/${task.id}`,payload:{completed:true}})).statusCode).toBe(404);
 for(const payload of [{completed:'true'},{completed:1},{completed:true,extra:1}]) expect((await app.inject({method:'PATCH',url:`/api/chats/${a.id}/todos/${task.id}`,payload})).statusCode).toBe(400);
 expect((await app.inject(`/api/chats/${a.id}/todos`)).json()[0].completed).toBe(false);
 for(const title of ['', ' '.repeat(20),'x'.repeat(501)]) expect((await app.inject({method:'POST',url:`/api/chats/${a.id}/todos`,payload:{title}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:`/api/chats/${a.id}/todos`,payload:{title:` ${'x'.repeat(500)} `}})).statusCode).toBe(201);
 expect((await app.inject({method:'POST',url:`/api/chats/${a.id}/runs`,payload:{text:'x'.repeat(16001),clientRequestId:'id'}})).statusCode).toBe(400);
 expect((await app.inject({method:'PATCH',url:`/api/chats/${a.id}/todos/${task.id}`,payload:{title:'renamed',completed:true}})).json()).toMatchObject({title:'renamed',completed:true});
 expect((await app.inject({method:'DELETE',url:`/api/chats/${a.id}/todos/${task.id}`})).json()).toEqual({id:task.id});
 }finally{await app.close();}
});

test('mutations remain busy until manager settlement even after terminal persistence',async()=>{
 const {createModels,fauxProvider,fauxAssistantMessage}=await import('@earendil-works/pi-ai');
 const faux=fauxProvider(),models=createModels();models.setProvider(faux.provider);
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});faux.setResponses([async()=>{await gate;return fauxAssistantMessage('done');}]);
 const app=await createApp({dataDir:':memory:',models});
 try{
 const model=faux.getModel(),selection={providerId:model.provider,modelId:model.id};const chat=app.storage.chats.create(selection);const todo=app.storage.todos.create(chat.id,{title:'original'});
 const {runId}=await app.runs.start(chat.id,{text:'hello',clientRequestId:'slot'});
 app.storage.runs.finish(runId,'completed');
 const cases=[{method:'POST',url:`/api/chats/${chat.id}/todos`,payload:{title:'new'}},{method:'PATCH',url:`/api/chats/${chat.id}/todos/${todo.id}`,payload:{completed:true}},{method:'DELETE',url:`/api/chats/${chat.id}/todos/${todo.id}`},{method:'PATCH',url:`/api/chats/${chat.id}`,payload:selection},{method:'PUT',url:`/api/providers/${model.provider}/credential`,payload:{key:'key'}}] as const;
 for(const request of cases)expect((await app.inject(request)).statusCode).toBe(409);
 expect(app.storage.todos.list(chat.id)).toEqual([todo]);
 release();await app.runs.wait(runId);
 expect((await app.inject({method:'PATCH',url:`/api/chats/${chat.id}`,payload:selection})).statusCode).toBe(200);
 }finally{release();await app.close();}
});

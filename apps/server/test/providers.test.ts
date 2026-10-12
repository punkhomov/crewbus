import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';
test('key is persisted without appearing in API', async () => {
 const app = await createApp({dataDir: ':memory:'});
 try {
  const secret = 'test-secret-that-must-not-be-returned';
  const put = await app.inject({method:'PUT',url:'/api/providers/openai/credential',payload:{key:secret}});
  expect(put.statusCode).toBe(204);
  const list = await app.inject('/api/providers');
  expect(list.statusCode).toBe(200);
  expect(list.body).not.toContain(secret);
  expect(list.json().find((p: {id:string}) => p.id === 'openai').configured).toBe(true);
 } finally { await app.close(); }
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteCredentialStore } from '../src/storage/credential-store.js';
import { createStorage } from '../src/storage/index.js';
import { createCatalog } from '../src/providers/catalog.js';
import { builtinModels, builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';

test('file restart preserves status; replacing/deleting keys updates auth immediately', async () => {
 const dir = await mkdtemp(join(tmpdir(),'crewbus-key-'));
 let app = await createApp({dataDir:dir});
 try {
  await app.catalog.saveKey('openai','first');
  expect((await app.models.getAuth('openai'))?.auth.apiKey).toBe('first');
  await app.catalog.saveKey('openai','second');
  expect((await app.models.getAuth('openai'))?.auth.apiKey).toBe('second');
  await app.close(); app = await createApp({dataDir:dir});
  const list = await app.inject('/api/providers');
  expect(list.json().find((p:{id:string})=>p.id==='openai').configured).toBe(true);
  expect(list.body).not.toContain('second');
  expect((await app.models.getAuth('openai'))?.auth.apiKey).toBe('second');
  expect((await app.inject({method:'DELETE',url:'/api/providers/openai/credential'})).statusCode).toBe(204);
  expect(await app.models.getAuth('openai')).toBeUndefined();
 } finally { await app.close(); await rm(dir,{recursive:true,force:true}); }
});

test('store serializes callbacks and delete; undefined retains current; errors do not poison queue', async () => {
 const storage = createStorage(':memory:'); const store = new SqliteCredentialStore(storage);
 try {
  let release!:()=>void; const gate = new Promise<void>(r=>{release=r;});
  const first = store.modify('openai',async current=> { expect(current).toBeUndefined(); await gate; return {type:'api_key',key:'first'}; });
  const second = store.modify('openai',async current=> { expect(current).toEqual({type:'api_key',key:'first'}); return undefined; });
  release(); await first;
  expect(await second).toEqual({type:'api_key',key:'first'});
  expect(await store.list()).toEqual([{providerId:'openai',type:'api_key'}]);
  const write = store.modify('openai',async ()=> ({type:'api_key',key:'last'}));
  const deletion = store.delete('openai'); await write; await deletion;
  expect(await store.read('openai')).toBeUndefined();
  await expect(store.modify('openai',async ()=>{throw new Error('callback failed');})).rejects.toThrow('callback failed');
  await store.modify('openai',async ()=>({type:'api_key',key:'recovered'}));
  expect((await store.read('openai'))?.type).toBe('api_key');
 } finally { storage.close(); }
});

test('abort prevents reads and post-callback writes; storage errors propagate', async () => {
 const storage = createStorage(':memory:'); const store = new SqliteCredentialStore(storage);
 const controller = new AbortController(); controller.abort();
 await expect(store.read('openai',{signal:controller.signal})).rejects.toThrow();
 await expect(store.list({signal:controller.signal})).rejects.toThrow();
 await expect(store.delete('openai',{signal:controller.signal})).rejects.toThrow();
 const during = new AbortController();
 await expect(store.modify('openai',async ()=>{during.abort();return {type:'api_key',key:'not-written'};},{signal:during.signal})).rejects.toThrow();
 expect(await store.read('openai')).toBeUndefined();
 storage.close(); await expect(store.read('openai')).rejects.toThrow();
});

test('catalog uses actual models, excludes unsupported configuration, accepts injected faux', async () => {
 const app = await createApp({dataDir:':memory:'});
 try {
  const providers = await app.catalog.listProviders();
  for (const id of ['openai','anthropic','deepseek','google-vertex','amazon-bedrock','radius','github-copilot']) expect(providers.some(p=>p.id===id)).toBe(true);
  for (const id of ['azure-openai-responses','cloudflare-workers-ai','cloudflare-ai-gateway','openai-codex']) expect(providers.some(p=>p.id===id)).toBe(false);
  const models = app.catalog.listModels('deepseek');
  expect(models.length).toBeGreaterThan(0);
  const chosen = models[0]!; expect(app.catalog.assertSelection('deepseek',chosen.id)).toEqual(app.models.getModel('deepseek',chosen.id));
  const response = await app.inject('/api/providers/deepseek/models');
  expect(Object.keys(response.json()[0]).sort()).toEqual(['contextWindow','id','name','providerId']);
  expect(Object.keys(providers[0]!).sort()).toEqual(['configured','id','name']);
  expect(()=>app.catalog.assertSelection('deepseek','missing')).toThrow('Resource not found');
 } finally {await app.close();}
 const injected = createModels(); injected.setProvider(fauxProvider().provider);
 const faux = await createApp({dataDir:':memory:',models:injected});
 try {expect((await faux.catalog.listProviders())[0]?.id).toBe('faux');} finally {await faux.close();}
});

test('real built-in key login branches resolve one entered key without ambient auth', async () => {
 for (const provider of builtinProviders()) {
  if (['azure-openai-responses','cloudflare-workers-ai','cloudflare-ai-gateway','openai-codex'].includes(provider.id)) continue;
  const signal = new AbortController().signal;
  const credential = await provider.auth.apiKey!.login!({signal,notify:()=>{},prompt:async prompt=> {
   if (prompt.type==='select') return provider.id==='google-vertex'?'api-key':'bearer-token';
   expect(prompt.type).toBe('secret'); return 'one-test-key';
  }});
  expect(credential).toEqual({type:'api_key',key:'one-test-key'});
  expect((await provider.auth.apiKey!.resolve({credential,signal,ctx:{env:async()=>undefined,fileExists:async()=>false}}))?.auth.apiKey).toBe('one-test-key');
 }
});

test('validation and busy provider failures are secret-free, with one shared reservation lock', async () => {
 const app = await createApp({dataDir:':memory:'});
 try {
  for (const [id,key,status] of [['missing','secret',404],['azure-openai-responses','secret',400],['openai','  ',400]] as const) {
   const response = await app.inject({method:'PUT',url:`/api/providers/${id}/credential`,payload:{key}});
   expect(response.statusCode).toBe(status); expect(response.body).not.toContain('secret');
  }
  expect((await app.inject({method:'PUT',url:'/api/providers/openai/credential',payload:{key:'secret',extra:true}})).statusCode).toBe(400);
  const credentials = new SqliteCredentialStore(app.storage); let busy = false;
  const catalog = createCatalog(app.models,credentials,()=>busy);
  let release!:()=>void; const gate = new Promise<void>(r=>{release=r;});
  const reservation = catalog.withProviderLock('openai',async()=>{await gate;busy=true;});
  const saving = catalog.saveKey('openai','secret'); release(); await reservation;
  await expect(saving).rejects.toMatchObject({statusCode:409});
  await expect(catalog.deleteKey('openai')).rejects.toMatchObject({statusCode:409});
  busy=false; await catalog.saveKey('openai','secret');
  const chat = app.storage.chats.create({title:'busy',providerId:'openai',modelId:'test'});
  app.storage.runs.accept(chat.id,{text:'hello',clientRequestId:'request'},'system');
  expect((await app.inject({method:'DELETE',url:'/api/providers/openai/credential'})).statusCode).toBe(409);
 } finally {await app.close();}
});

test('ambient environment keys never configure production catalog or auth', async () => {
 const before=process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY='ambient-secret';
 const app=await createApp({dataDir:':memory:'});
 try {expect(await app.models.getAuth('openai')).toBeUndefined();expect((await app.catalog.listProviders()).find(p=>p.id==='openai')?.configured).toBe(false);}
 finally {await app.close(); if(before===undefined) delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=before;}
});

test('catalog rejects secret-bearing persistence failures with safe text', async () => {
 const storage=createStorage(':memory:'); const credentials=new SqliteCredentialStore(storage);
 const models=builtinModels({credentials});
 const catalog=createCatalog(models,{read:credentials.read.bind(credentials),list:credentials.list.bind(credentials),modify:async()=>{throw new Error('failed secret-value');},delete:async()=>{throw new Error('failed secret-value');}});
 try {
  await expect(catalog.saveKey('openai','secret-value')).rejects.toThrow('Unable to save credential');
  await expect(catalog.deleteKey('openai')).rejects.toThrow('Unable to delete credential');
 } finally {storage.close();}
});

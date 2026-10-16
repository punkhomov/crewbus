import type { FastifyInstance } from 'fastify';
import type { CreateChatInput, StartRunInput } from '@crewbus/contracts';
import { conflict } from '../lib/error.js';
export const selectionSchema = {type:'object',additionalProperties:false,required:['providerId','modelId'],properties:{providerId:{type:'string',minLength:1},modelId:{type:'string',minLength:1}}};
export function registerChatRoutes(app: FastifyInstance): void {
 app.get('/api/chats',async()=>app.storage.chats.list());
 app.post<{Body:CreateChatInput}>('/api/chats',{schema:{body:selectionSchema}},async(req,reply)=>{
  app.catalog.assertSelection(req.body.providerId,req.body.modelId);
  return reply.code(201).send(app.storage.chats.create(req.body));
 });
 app.get<{Params:{id:string}}>('/api/chats/:id',async req=>app.runs.snapshot(req.params.id));
 app.patch<{Params:{id:string};Body:CreateChatInput}>('/api/chats/:id',{schema:{body:selectionSchema}},async req=>app.storage.transaction(()=>{
  app.storage.chats.get(req.params.id);
  if(app.runs.isChatBusy(req.params.id)) conflict('Chat is running');
  app.catalog.assertSelection(req.body.providerId,req.body.modelId);
  return app.storage.chats.setModel(req.params.id,req.body);
 }));
 app.post<{Params:{id:string};Body:StartRunInput}>('/api/chats/:id/runs',{schema:{body:{type:'object',additionalProperties:false,required:['text','clientRequestId'],properties:{text:{type:'string',minLength:1,maxLength:16000},clientRequestId:{type:'string',minLength:1}}}}},async(req,reply)=>{
  const {runId}=await app.runs.start(req.params.id,req.body);return reply.code(202).send({runId});
 });
 app.post<{Params:{id:string}}>('/api/runs/:id/abort',async(req,reply)=>{
  app.storage.runs.get(req.params.id);app.runs.abort(req.params.id);return reply.code(202).send({runId:req.params.id});
 });
}

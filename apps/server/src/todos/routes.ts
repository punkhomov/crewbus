import type { FastifyInstance } from 'fastify';
import type { UpdateTodoInput } from '@crewbus/contracts';
import { conflict } from '../lib/error.js';
export function registerTodoRoutes(app:FastifyInstance):void {
 type Params={id:string;todoId:string};
 const guarded=<T>(id:string,fn:()=>T):T=>app.storage.transaction(()=>{
  app.storage.chats.get(id);if(app.runs.isChatBusy(id)) conflict('Chat is running');return fn();
 });
 app.get<{Params:Params}>('/api/chats/:id/todos',async req=>app.storage.todos.list(req.params.id));
 app.post<{Params:Params;Body:{title:string}}>('/api/chats/:id/todos',{schema:{body:{type:'object',additionalProperties:false,required:['title'],properties:{title:{type:'string'}}}}},async(req,reply)=>reply.code(201).send(guarded(req.params.id,()=>app.storage.todos.create(req.params.id,req.body))));
 app.patch<{Params:Params;Body:UpdateTodoInput}>('/api/chats/:id/todos/:todoId',{schema:{body:{type:'object',additionalProperties:false,minProperties:1,properties:{title:{type:'string'},completed:{type:'boolean'}}}}},async req=>guarded(req.params.id,()=>app.storage.todos.update(req.params.id,req.params.todoId,req.body)));
 app.delete<{Params:Params}>('/api/chats/:id/todos/:todoId',async req=>guarded(req.params.id,()=>app.storage.todos.delete(req.params.id,req.params.todoId)));
}

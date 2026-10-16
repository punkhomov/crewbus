import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { CrewEvent } from '@crewbus/contracts';
import { AppError } from '../lib/error.js';
export function encodeEvent(event:CrewEvent):string {
 return `id: ${event.id}\nevent: crewbus\ndata: ${JSON.stringify(event)}\n\n`;
}
export function parseCursor(header:string|undefined,after:string|undefined,maximum:number):number {
 const raw=header??after??'0';const value=Number(raw);
 if(!/^(0|[1-9][0-9]*)$/.test(raw)||!Number.isSafeInteger(value)||value>maximum) throw new AppError(400,'invalid_input','Invalid cursor');
 return value;
}
/** Only this writer touches the socket. Notifications never await browser IO. */
export function streamEvents(raw:ServerResponse,after:number,subscribe:(listener:(event:CrewEvent)=>void)=>()=>void,replay:()=>CrewEvent[],terminal:()=>boolean):()=>void {
 let closed=false,writing=false,ready=false,last=after;
 let queue:CrewEvent[]=[];
 let unsubscribe=()=>{};
 let heartbeat:ReturnType<typeof setInterval>|undefined;
 let wake:(()=>void)|undefined;
 const cleanup=()=>{
  if(closed)return;closed=true;unsubscribe();clearInterval(heartbeat);raw.off('close',cleanup);wake?.();queue=[];
 };
 const end=()=>{cleanup();raw.end();};
 const write=async(data:string)=>{
  if(closed)return;
  if(!raw.write(data)) await new Promise<void>(resolve=>{
   const done=()=>{raw.off('drain',done);wake=undefined;resolve();};wake=done;raw.once('drain',done);
  });
 };
 const pump=async()=>{
  if(writing||!ready||closed)return;writing=true;
  try{
   while(queue.length&&!closed){
    const event=queue.shift()!;if(event.id<=last)continue;
    await write(encodeEvent(event));last=event.id;
    if(event.data.type==='run.finished'){end();return;}
   }
   if(!closed&&terminal())end();
  }catch{cleanup();raw.destroy();}finally{writing=false;}
 };
 unsubscribe=subscribe(event=>{
  if(closed||event.id<=last)return;
  if(queue.length>=256){cleanup();raw.destroy();return;}
  queue.push(event);void pump();
 });
 raw.once('close',cleanup);
 // Subscribe first; durable replay and live notifications are merged by cursor.
 const saved=replay();
 queue=[...new Map([...saved,...queue].map(e=>[e.id,e])).values()].sort((a,b)=>a.id-b.id);
 ready=true;
 heartbeat=setInterval(()=>{if(!closed&&!writing){writing=true;void write(': heartbeat\n\n').catch(()=>{cleanup();raw.destroy();}).finally(()=>{writing=false;void pump();});}},15_000);
 void pump();
 return () => {
  cleanup();
  raw.destroy();
 };
}
export function registerSseRoutes(app:FastifyInstance):()=>void {
 const streams = new Map<ServerResponse, () => void>();
 app.get<{Params:{id:string};Querystring:{after?:string}}>('/api/runs/:id/events',{
  schema:{querystring:{type:'object',additionalProperties:false,properties:{after:{type:'string'}}}}
 },async(req,reply)=>{
  const id=req.params.id;app.storage.runs.get(id);
  const header=req.headers['last-event-id'];
  const after=parseCursor(Array.isArray(header)?header[0]:header,req.query.after,app.storage.events.cursor(id));
  reply.hijack();
  reply.raw.writeHead(200, {
   'Content-Type': 'text/event-stream; charset=utf-8',
   'Cache-Control': 'no-cache, no-transform',
   'Connection': 'keep-alive',
   'X-Accel-Buffering': 'no'
  });
  reply.raw.flushHeaders();
  const stop = streamEvents(
   reply.raw, after,
   listener => app.runs.broker.subscribe(id, listener),
   () => app.storage.events.since(id, after),
   () => app.storage.runs.get(id).status !== 'running'
  );
  streams.set(reply.raw, stop);
  reply.raw.once('close', () => streams.delete(reply.raw));
 });
 return () => {
  for (const stop of streams.values()) stop();
  streams.clear();
 };
}

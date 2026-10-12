import type { FastifyInstance } from 'fastify';
import type { CatalogService } from './catalog.js';
const providerParams = {type:'object', additionalProperties:false, required:['providerId'], properties:{providerId:{type:'string',minLength:1}}};
const providerView = {type:'object', additionalProperties:false, required:['id','name','configured'], properties:{id:{type:'string'},name:{type:'string'},configured:{type:'boolean'}}};
const modelView = {type:'object', additionalProperties:false, required:['id','name','providerId','contextWindow'], properties:{id:{type:'string'},name:{type:'string'},providerId:{type:'string'},contextWindow:{type:'number'}}};
export function registerProviderRoutes(app: FastifyInstance, catalog: CatalogService): void {
  app.get('/api/providers', {schema:{response:{200:{type:'array',items:providerView}}}}, () => catalog.listProviders());
  app.get<{Params:{providerId:string}}>('/api/providers/:providerId/models', {schema:{params:providerParams,response:{200:{type:'array',items:modelView}}}}, request => catalog.listModels(request.params.providerId));
  app.put<{Params:{providerId:string};Body:{key:string}}>('/api/providers/:providerId/credential', {schema:{params:providerParams,body:{type:'object',additionalProperties:false,required:['key'],properties:{key:{type:'string',minLength:1}}},response:{204:{type:'null'}}}}, async (request, reply) => {
    await catalog.saveKey(request.params.providerId, request.body.key);
    return reply.code(204).send();
  });
  app.delete<{Params:{providerId:string}}>('/api/providers/:providerId/credential', {schema:{params:providerParams,response:{204:{type:'null'}}}}, async (request, reply) => {
    await catalog.deleteKey(request.params.providerId);
    return reply.code(204).send();
  });
}

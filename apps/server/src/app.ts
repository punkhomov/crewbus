import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recoverInterrupted } from './chats/recovery.js';
import { registerChatRoutes } from './chats/routes.js';
import { registerTodoRoutes } from './todos/routes.js';
import { registerSseRoutes } from './events/sse.js';
import type { FastifyInstance } from 'fastify';
import type { Models } from '@earendil-works/pi-ai';
import { createStorage } from './storage/index.js';
import type { Storage } from './storage/index.js';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { SqliteCredentialStore } from './storage/credential-store.js';
import { createCatalog, type CatalogService } from './providers/catalog.js';
import { registerProviderRoutes } from './providers/routes.js';
import { createRunManager, type RunManager } from './chats/run-manager.js';
import { AppError } from './lib/error.js';
declare module 'fastify' {
  interface FastifyInstance {
    storage: Storage;
    runs: RunManager;
    catalog: CatalogService;
    models: Models;
  }
}
export interface AppOptions {
  dataDir: string;
  models?: Models;
}
export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    ajv: {customOptions: {removeAdditional: false, coerceTypes: false}}
  });
  const storage = createStorage(options.dataDir);
  try { recoverInterrupted(storage); } catch (error) { storage.close(); throw error; }
  app.decorate('storage', storage);
  const credentials = new SqliteCredentialStore(storage);
  const models = options.models ?? builtinModels({credentials, authContext:{env:async () => undefined,fileExists:async () => false}});
  const catalog = createCatalog(models, credentials, id => runs.isProviderBusy(id));
  const runs = createRunManager({storage,models,catalog});
  app.decorate('runs', runs);
  app.decorate('models', models);
  app.decorate('catalog', catalog);
  registerProviderRoutes(app, catalog);
  registerChatRoutes(app);
  registerTodoRoutes(app);
  registerSseRoutes(app);
  app.addHook('onClose', async () => {
    await runs.close();
    if (storage.database.isOpen)
      storage.close();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error && typeof error === 'object' && 'validation' in error)
      return reply.code(400).send({error:{code:'invalid_input', message:'Invalid input'}});
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: {
          code: error.code, message: error.message
        }
      });
    return reply.code(500).send({
      error: {
        code: 'internal_error', message: 'Internal server error'
      }
    });
  });
  app.get('/api/health', async (_request, reply) => {
    try {
      storage.database.prepare('SELECT 1').get();
      return {
        ready: true
      };
    }
    catch {
      return reply.code(503).send({
        ready: false
      });
    }
  });
  const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
  if (existsSync(publicRoot)) {
    await app.register(fastifyStatic, { root: publicRoot, wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname === '/api' || pathname.startsWith('/api/') ||
        !existsSync(publicRoot) || !['GET', 'HEAD'].includes(request.method))
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    return reply.type('text/html').sendFile('index.html');
  });
  return app;
}

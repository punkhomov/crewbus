import Fastify from 'fastify';
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
    ajv: {customOptions: {removeAdditional: false}}
  });
  const storage = createStorage(options.dataDir);
  app.decorate('storage', storage);
  const credentials = new SqliteCredentialStore(storage);
  const models = options.models ?? builtinModels({credentials, authContext:{env:async () => undefined,fileExists:async () => false}});
  const catalog = createCatalog(models, credentials, id => runs.isProviderBusy(id));
  const runs = createRunManager({storage,models,catalog});
  app.decorate('runs', runs);
  app.decorate('models', models);
  app.decorate('catalog', catalog);
  registerProviderRoutes(app, catalog);
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
  return app;
}

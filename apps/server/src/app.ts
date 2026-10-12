import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Models } from '@earendil-works/pi-ai';
import { createStorage } from './storage/index.js';
import type { Storage } from './storage/index.js';
import { AppError } from './lib/error.js';
declare module 'fastify' {
  interface FastifyInstance {
    storage: Storage;
  }
}
export interface AppOptions {
  dataDir: string;
  models?: Models;
}
export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false
  });
  const storage = createStorage(options.dataDir);
  app.decorate('storage', storage);
  app.addHook('onClose', () => {
    if (storage.database.isOpen)
      storage.close();
  });
  app.setErrorHandler((error, _request, reply) => {
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

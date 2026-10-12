import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Models } from '@earendil-works/pi-ai';

export interface AppOptions { dataDir: string; models?: Models }

export async function createApp(_options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ ready: true }));
  return app;
}

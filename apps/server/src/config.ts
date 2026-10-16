import { resolve } from 'node:path';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  return { dataDir: env.CREWBUS_DATA_DIR ?? resolve('.crewbus'), host: env.HOST ?? '127.0.0.1', port };
}

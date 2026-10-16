import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const app = await createApp({ dataDir: config.dataDir });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
  });
}
try { await app.listen({ host: config.host, port: config.port }); }
catch (error) { console.error(error); await app.close(); process.exitCode = 1; }

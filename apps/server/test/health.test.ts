import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';

test('health responds without contacting a provider', async () => {
  const app = await createApp({ dataDir: ':memory:' });
  try {
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ready: true });
  } finally {
    await app.close();
  }
});

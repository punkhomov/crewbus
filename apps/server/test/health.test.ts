import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';
test('health responds without contacting a provider', async () => {
  const app = await createApp({
    dataDir: ':memory:'
  });
  try {
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ready: true
    });
  }
  finally {
    await app.close();
  }
});
test('health returns unavailable when database query fails', async () => {
  const app = await createApp({
    dataDir: ':memory:'
  });
  try {
    app.storage.close();
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ready: false
    });
  }
  finally {
    await app.close();
  }
});

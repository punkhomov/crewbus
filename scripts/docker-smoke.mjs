import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const name = `crewbus-smoke-${randomUUID()}`;
const volume = `${name}-data`;
const children = new Set();
function docker(args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    children.add(child);
    let output = '';
    if (capture) { child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data); }
    child.on('error', reject);
    child.on('close', code => { children.delete(child); code === 0 ? resolve(output.trim()) : reject(new Error(`docker ${args[0]} exited ${code}: ${output}`)); });
  });
}
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopping = true; for (const child of children) child.kill('SIGTERM');
});
try {
  const image = (await readFile('.docker/node-image.txt', 'utf8')).trim();
  assert.match(image, /^node:24\.21\.0-bookworm-slim@sha256:[0-9a-f]{64}$/);
  await docker(['build', '--pull', '--no-cache', '--build-arg', `NODE_IMAGE=${image}`, '-t', name, '.']);
  await docker(['volume', 'create', volume], true);
  async function start() {
    assert.equal(stopping, false);
    await docker(['run', '-d', '--name', name, '-p', '127.0.0.1::3000', '-v', `${volume}:/data`, name], true);
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      const status = await docker(['inspect', '--format', '{{.State.Health.Status}}', name], true);
      if (status === 'healthy') { ready = true; break; }
      if (status === 'unhealthy' || stopping) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) { await docker(['logs', name]); throw new Error('Container health never became ready'); }
    assert.notEqual(await docker(['exec', name, 'id', '-u'], true), '0');
    const port = await docker(['port', name, '3000/tcp'], true);
    return `http://${port}`;
  }
  let origin = await start();
  async function api(path, init) {
    const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(10000), headers: init?.body ? { 'content-type': 'application/json' } : {} });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  }
  const providers = await api('/api/providers');
  let selection;
  for (const provider of providers) {
    const models = await api(`/api/providers/${encodeURIComponent(provider.id)}/models`);
    if (models.length) { selection = { providerId: provider.id, modelId: models[0].id }; break; }
  }
  assert.ok(selection, 'Builtin catalog needs at least one model; no model request is made');
  const chat = await api('/api/chats', { method: 'POST', body: JSON.stringify(selection) });
  const todo = await api(`/api/chats/${chat.id}/todos`, { method: 'POST', body: JSON.stringify({ title: 'Docker persistence smoke' }) });
  for (const path of ['/api/unknown', '/api', '/api/unknown/nested']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404); assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).error.code, 'not_found');
  }
  const ui = await fetch(`${origin}/`); assert.equal(ui.status, 200); assert.match(await ui.text(), /<div id="root"/);
  const route = await fetch(`${origin}/chat/example`); assert.equal(route.status, 200); assert.match(await route.text(), /<div id="root"/);
  await docker(['stop', '-t', '10', name], true); await docker(['rm', name], true);
  origin = await start();
  assert.ok((await api('/api/chats')).some(item => item.id === chat.id));
  assert.ok((await api(`/api/chats/${chat.id}/todos`)).some(item => item.id === todo.id && item.title === todo.title));
  console.log('Docker smoke PASS: clean build, production layout, health, non-root, API/static and persisted IDs');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  for (const child of children) child.kill('SIGTERM');
  for (const args of [['rm', '-f', name], ['volume', 'rm', volume], ['image', 'rm', name]]) {
    try { await docker(args, true); } catch { /* Only our uniquely named resources; may not exist after build failure. */ }
  }
}

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('docs/ui-provenance.json', 'utf8'));
const repositories = { 'ai-elements': 'vercel/ai-elements', shadcn: 'shadcn-ui/ui' };
async function check(path, expected) {
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), expected, `Unrecorded source change: ${path}`);
}
for (const [project, license] of Object.entries(manifest.licenses)) {
  assert.ok(license.url.startsWith(`https://raw.githubusercontent.com/${repositories[project]}/`));
  assert.match(license.url, /\/[a-f0-9]{40}\//);
  await check(license.path, license.sha256);
}
for (const file of manifest.files) {
  assert.match(file.commit, /^[a-f0-9]{40}$/);
  assert.equal(file.url, `https://raw.githubusercontent.com/${repositories[file.project]}/${file.commit}/${file.upstreamPath}`);
  assert.equal(file.license, manifest.licenses[file.project].path);
  await check(file.original, file.sha256);
  await check(file.working, file.workingSha256);
}
console.log(`Verified ${manifest.files.length} upstream/local source pairs and ${Object.keys(manifest.licenses).length} licenses`);

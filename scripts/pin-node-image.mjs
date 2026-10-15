import { readFile, mkdir, writeFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(process.argv[2] ?? '/tmp/crewbus-node-manifest.json', 'utf8'));
if (!/^sha256:[0-9a-f]{64}$/.test(manifest.digest ?? '')) throw new Error('Manifest descriptor requires a sha256 digest');
await mkdir('.docker', { recursive: true });
await writeFile('.docker/node-image.txt', `node:24.21.0-bookworm-slim@${manifest.digest}\n`);

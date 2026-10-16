import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const prefix = process.argv[2];
if (!prefix) throw new Error('Usage: node scripts/bootstrap-pnpm.mjs <prefix>');
const docs = JSON.parse(await readFile(new URL('../docs/dependencies.json', import.meta.url), 'utf8'));
const libc = process.platform === 'linux' ? (process.report.getReport().header.glibcVersionRuntime ? '-glibc' : '-musl') : '';
const platform = `${process.platform}-${process.arch}${libc}`;
const descriptor = docs.pnpm.platforms[platform];
if (!descriptor) throw new Error(`Unsupported platform: ${platform}`);
if (descriptor.version !== docs.pnpm.version) throw new Error('Bootstrap version mismatch');
if (!descriptor.url.startsWith('https://registry.npmjs.org/')) throw new Error('Unsupported registry');
if (Date.now() - Date.parse(descriptor.published) < docs.minimumReleaseAgeMinutes * 60_000) throw new Error('Bootstrap package is too new');
const response = await fetch(descriptor.url);
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
if (actual !== descriptor.integrity) throw new Error('Bootstrap integrity mismatch');

// Read only ordinary, allowlisted files from the verified gzip/tar archive.
// No archive paths are ever passed to filesystem extraction.
const binaryName = process.platform === 'win32' ? 'pnpm.exe' : 'pnpm';
const allowed = new Set([`package/${binaryName}`, 'package/package.json', 'package/LICENSE', 'package/THIRD-PARTY-NOTICES.md']);
const entries = new Map();
const tar = gunzipSync(bytes);
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every((byte) => byte === 0)) break;
  const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  const name = field(0, 100);
  const sizeText = field(124, 12).trim();
  const checksumText = field(148, 8).trim();
  if (!/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(checksumText)) throw new Error('Invalid tar numeric field');
  const size = parseInt(sizeText, 8);
  const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
  if (checksum !== parseInt(checksumText, 8)) throw new Error('Invalid tar checksum');
  if (!allowed.has(name) || entries.has(name) || field(345, 155) || !['', '0'].includes(field(156, 1)) || field(157, 100)) throw new Error(`Disallowed tar entry: ${name}`);
  if (!Number.isSafeInteger(size) || offset + 512 + size > tar.length) throw new Error('Truncated tar entry');
  entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
  offset += 512 + Math.ceil(size / 512) * 512;
}
if (entries.size !== allowed.size) throw new Error('Incomplete bootstrap archive');
const manifest = JSON.parse(entries.get('package/package.json').toString('utf8'));
if (manifest.name !== descriptor.name || manifest.version !== descriptor.version) throw new Error('Bootstrap manifest mismatch');
for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'scripts']) {
  if (Object.keys(manifest[key] ?? {}).length) throw new Error(`Bootstrap must not contain ${key}`);
}
const binDir = join(resolve(prefix), 'bin');
await mkdir(binDir, { recursive: true });
const binary = join(binDir, binaryName);
await writeFile(binary, entries.get(`package/${binaryName}`));
await chmod(binary, 0o755);
const result = spawnSync(binary, ['--version'], { encoding: 'utf8', shell: false });
if (result.error || result.status !== 0 || result.stdout.trim() !== docs.pnpm.version) throw new Error('Bootstrap executable version mismatch');
console.log(`Verified pnpm ${result.stdout.trim()} installed at ${binary}`);

import { lstat, readdir, realpath, access } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
const root = await realpath(process.argv[2]);
async function walk(path) {
  for (const entry of await readdir(path)) {
    const file = join(path, entry), stat = await lstat(file);
    if (stat.isSymbolicLink()) {
      const target = await realpath(file); // Reject dangling links as well as workspace escapes.
      const rel = relative(root, target);
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Dependency escapes deployment: ${file}`);
    } else if (stat.isDirectory()) await walk(file);
  }
}
await walk(root);
await access(join(root, 'dist/main.js'));
for (const name of ['@crewbus/agent', '@crewbus/contracts', '@earendil-works/pi-ai']) {
  // Import resolution is used because pi intentionally exposes ESM only.
  const path = resolve(root, 'node_modules', name, 'package.json');
  await access(path);
}
const { spawnSync } = await import('node:child_process');
const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await Promise.all(['@crewbus/agent','@crewbus/contracts','@earendil-works/pi-ai'].map(x=>import(x)))"], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) throw new Error('Deployed production imports failed');
console.log('Production deploy layout verified');

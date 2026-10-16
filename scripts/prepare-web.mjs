import { access, cp, rm } from 'node:fs/promises';

const source = new URL('../apps/web/dist/', import.meta.url);
const target = new URL('../apps/server/public/', import.meta.url);
await access(new URL('index.html', source));
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });

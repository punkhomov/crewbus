import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const aiSha = '6a9d5b1822ffb10bba4bd97175f01edd7d8651cd';
const uiSha = '30a58d4498f270af1c1e981a7d78a15cf5740841';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function saveUpstream(url, target) {
  if (!/^https:\/\/raw\.githubusercontent\.com\/.+\/[0-9a-f]{40}\//.test(url)) throw new Error('Upstream URL must include a commit SHA');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Source fetch failed: ${response.status} (${url})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(new URL('.', target), { recursive: true });
  await writeFile(target, bytes);
  return { url, sha256: sha256(bytes) };
}
async function vendor() {
  const records = [];
  const licenses = {};
  for (const [project, repo, commit, licensePath] of [['ai-elements','vercel/ai-elements',aiSha,'LICENSE'],['shadcn','shadcn-ui/ui',uiSha,'LICENSE.md']]) {
    const path = `vendor/ui/${project}/${licensePath}`;
    const source = await saveUpstream(`https://raw.githubusercontent.com/${repo}/${commit}/${licensePath}`, new URL(`../${path}`, import.meta.url));
    licenses[project] = { path, ...source };
  }
  const queue = [ ...['conversation','message','prompt-input','tool','model-selector','code-block'].map((name) => ['ai-elements',`packages/elements/src/${name}.tsx`,`ai-elements/${name}.tsx`]), ...['button','button-group','tooltip','badge','collapsible','command','dropdown-menu','hover-card','input-group','select','spinner','dialog','sheet','input','textarea','label','checkbox','sidebar'].map((name) => ['shadcn',`apps/v4/registry/new-york-v4/ui/${name}.tsx`,`ui/${name}.tsx`]) ];
  const seen = new Set();
  for (let i=0; i<queue.length; i++) {
    const [project, upstreamPath, componentPath] = queue[i];
    if (seen.has(componentPath)) continue;
    seen.add(componentPath);
    const repo = project === 'ai-elements' ? 'vercel/ai-elements' : 'shadcn-ui/ui';
    const commit = project === 'ai-elements' ? aiSha : uiSha;
    const original = `vendor/ui/${project}/${upstreamPath}`;
    const source = await saveUpstream(`https://raw.githubusercontent.com/${repo}/${commit}/${upstreamPath}`, new URL(`../${original}`, import.meta.url));
    let contents = await readFile(join(root, original), 'utf8');
    contents = contents.replaceAll('from "cn"', 'from "@/lib/utils"');
    contents = contents.replaceAll('@repo/shadcn-ui/components/ui/', '@/components/ui/').replaceAll('@repo/shadcn-ui/lib/utils', '@/lib/utils').replaceAll('@repo/shadcn-ui/hooks/', '@/hooks/').replaceAll('@/registry/new-york-v4/ui/', '@/components/ui/');
    // Shadcn's fixed snapshot uses its registry-prefixed aliases.
    contents = contents.replaceAll('@/registry/new-york-v4/hooks/', '@/hooks/').replaceAll('@/registry/new-york-v4/lib/utils', '@/lib/utils');
    const working = componentPath.startsWith('hooks/') ? `apps/web/src/${componentPath}` : `apps/web/src/components/${componentPath}`;
    await mkdir(dirname(join(root, working)), { recursive: true });
    await writeFile(join(root, working), contents);
    records.push({ project, commit, upstreamPath, original, working, ...source, workingSha256: sha256(contents), license: licenses[project].path });
    for (const match of contents.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
      const specifier=match[1];
      if (specifier.startsWith('@/components/ui/')) { const name=specifier.slice('@/components/ui/'.length); queue.push(['shadcn',`apps/v4/registry/new-york-v4/ui/${name}.tsx`,`ui/${name}.tsx`]); }
      else if (specifier.startsWith('@/hooks/')) { const name=specifier.slice('@/hooks/'.length); queue.push(['shadcn',`apps/v4/registry/new-york-v4/hooks/${name}.ts`,`hooks/${name}.ts`]); }
      else if (specifier.startsWith('@/') && specifier !== '@/lib/utils') throw new Error(`Unresolved local import: ${specifier}`);
      else if (specifier.startsWith('./') && project === 'ai-elements' && /^\.\/[a-z-]+$/.test(specifier)) { const name=specifier.slice(2); queue.push(['ai-elements',`packages/elements/src/${name}.tsx`,`ai-elements/${name}.tsx`]); }
      else if (specifier.startsWith('.')) throw new Error(`Unresolved relative import: ${specifier}`);
    }
  }
  await writeFile(join(root,'docs/ui-provenance.json'),JSON.stringify({licenses,files:records},null,2)+'\n');
  console.log(`Vendored ${records.length} verified upstream sources.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await vendor();

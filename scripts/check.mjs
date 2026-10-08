import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function walk(dir) {
    const entries = await readdir(dir, {withFileTypes:true});
    const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(resolve(dir,entry.name)) : [resolve(dir,entry.name)]));
    return nested.flat();
}
const files = (await Promise.all(['src','scripts'].map(dir=>walk(resolve(root,dir))))).flat();
let count=0;
for(const file of files.filter(file=>/\.(m?js)$/.test(file))) {
    const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
    if(result.error) throw result.error;
    assert.equal(result.status,0,'Syntax: '+relative(root,file)); count++;
    const content=await readFile(file,'utf8');
    for(const match of content.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
        await access(resolve(dirname(file),match[1]));
    }
}
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
const references=[manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(item=>[...(item.js||[]),...(item.css||[])])];
for(const ref of references) await access(resolve(root,ref));
const popup=resolve(root,manifest.action.default_popup);
for(const match of (await readFile(popup,'utf8')).matchAll(/(?:src|href)="([^"]+)"/g)) await access(resolve(dirname(popup),match[1]));
console.log(`Checked ${count} JavaScript files, relative imports, manifest and popup references.`);

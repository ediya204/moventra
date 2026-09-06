import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,extname} from 'node:path';
const root=process.cwd();let count=0;const failures=[];
function walk(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const p=resolve(dir,f.name);if(f.isDirectory())walk(p);else if(/\.(ts|tsx|css)$/.test(p)){count++;const text=readFileSync(p,'utf8');for(const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/g)){
const target=resolve(dirname(p),m[1]),source=relative(root,p),dest=relative(root,target);
if(source.startsWith('apps/client/')&&dest.startsWith('apps/admin/')||source.startsWith('apps/admin/')&&dest.startsWith('apps/client/')||source.startsWith('packages/shared/')&&dest.startsWith('apps/'))failures.push(`${source} depends on ${dest}`);
if(!['','.ts','.tsx','.json','.css','/index.ts','/index.tsx'].some(e=>existsSync(target+e)))failures.push(`${source}: missing ${m[1]}`);
}}}}
for(const p of ['apps/client/src','apps/admin/src','packages/shared/src'])walk(resolve(root,p));
if(failures.length)throw new Error(failures.join('\n'));
console.log(`Checked ${count} source files: no cross-app or reverse shared dependencies.`);

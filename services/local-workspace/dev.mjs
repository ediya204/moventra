import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertLocal} from './demo-server/slash/store.mjs';
assertLocal();
const root=fileURLToPath(new URL('../..',import.meta.url));
for(const args of [['cli.mjs','import'],['card-admin-cli.mjs','init'],['crypto-finance-cli.mjs','init']]){
 const done=spawnSync(process.execPath,['services/local-workspace/demo-server/slash/'+args[0],...args.slice(1)],{cwd:root,stdio:'inherit'});
 if(done.status!==0)process.exit(done.status||1);
}
const children=[
 spawn(process.execPath,['services/local-workspace/demo-server/slash/server.mjs'],{cwd:root,stdio:'inherit',env:{...process.env,MOVENTRA_WORKSPACE_PORT:'8868'}}),
 spawn('pnpm',['--filter','@moventra/admin','exec','vite','--host','127.0.0.1','--port','8850','--strictPort','--mode','slash-demo'],{cwd:root,stdio:'inherit',env:{...process.env,VITE_DATA_MODE:'slash-demo',VITE_LOCAL_WORKSPACE_PROXY_TARGET:'http://127.0.0.1:8868'}}),
];
const stop=()=>children.forEach(child=>child.kill('SIGTERM'));
for(const child of children){child.on('error',stop);child.on('exit',stop)}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

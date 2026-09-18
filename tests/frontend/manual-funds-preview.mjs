// Opt-in, loopback-only synthetic browser harness. Never bundled in either app.
import {createServer} from 'vite';
import {mkdtemp,writeFile,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const api=(await readFile('/tmp/moventra-manual-browser-api','utf8')).trim();
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(api))throw Error('isolated loopback test API required');
const root=await realpath(await mkdtemp(join(tmpdir(),'moventra-manual-ui-'))),workspace=resolve('.');
const auth='\0manual-auth',firebase='\0manual-firebase',site='\0manual-site',live='\0manual-errors';
await writeFile(join(root,'index.html'),'<html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><div id="root"></div><script type="module" src="/entry.jsx"></script></html>');
await writeFile(join(root,'entry.jsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import{ThemeProvider,CssBaseline}from'@mui/material';
import BalancesPage from '/@fs${workspace}/apps/admin/src/operations/BalancesPage.tsx';
import theme from '/@fs${workspace}/packages/shared/src/theme.ts';
createRoot(document.getElementById('root')).render(<ThemeProvider theme={theme}><CssBaseline/><BrowserRouter><Routes>{['/finance/balances','/finance/balances/:customerId','/finance/balances/:customerId/orders/:orderId'].map(path=><Route key={path} path={path} element={<BalancesPage/>}/>)}</Routes></BrowserRouter></ThemeProvider>);
`);
const server=await createServer({configFile:false,root,esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom','react-router-dom'],alias:{react:resolve('node_modules/react'),'react-dom':resolve('node_modules/react-dom'),'react-router-dom':resolve('node_modules/react-router-dom'),'@mui/material':resolve('node_modules/@mui/material'),'@iconify/react':resolve('node_modules/@iconify/react')}},plugins:[{name:'synthetic-identity',enforce:'pre',resolveId(id,importer){if(!importer)return;if(id.endsWith('/AuthContext'))return auth;if(id.endsWith('/firebase'))return firebase;if(id==='./site')return site;if(id.endsWith('/liveApi'))return live},load(id){if(id===auth)return 'export const useAuth=()=>({ready:true,authenticated:true,user:{uid:"staff",displayName:"隔离测试运营"},profile:{},signOut:async()=>{},session:{id:"00000000-0000-0000-0000-000000000003",operator:true,mfaVerified:true,staffScopes:[]}})';if(id===firebase)return 'const user={getIdToken:async()=>"staff"};export const getFirebaseAuth=()=>({currentUser:user})';if(id===site)return 'export const isAdminSite=true';if(id===live)return 'export class SessionError extends Error{constructor(code,status=0){super(code);this.code=code;this.status=status}}'}}],server:{host:'127.0.0.1',port:8869,strictPort:true,fs:{allow:[workspace,root]},proxy:{'/admin-api':api,'/client-api':api}}});
await server.listen();console.log('Synthetic browser fixture http://127.0.0.1:8869/finance/balances');

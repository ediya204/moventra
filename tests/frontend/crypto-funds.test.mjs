import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import ts from 'typescript';
import {handle} from '../../deploy/cloudflare/gateway.mjs';
import {cryptoRoute as gatewayRoute} from '../../deploy/cloudflare/crypto.mjs';
const require=createRequire(import.meta.url),resolve=s=>pathToFileURL(require.resolve(s)).href;
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const source=p=>ts.transpileModule(readFileSync(new URL(p,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const contract=uri(source('../../packages/shared/src/auth/cryptoContract.ts'));
const {cryptoRoute,cryptoUnits,cryptoMoney}=await import(contract);
const id='10000000-0000-0000-0000-000000000001',path=`/client-api/v1/customers/${id}/crypto`;
test('crypto exact amounts and gateway/transport methods stay in parity',async()=>{
 assert.equal(cryptoUnits('9007199254.740993','USDT'),'9007199254740993');assert.equal(cryptoMoney('9007199254740993','USDT'),'9007199254.74 USDT');
 for(const s of ['0','-1','1e3','01','1.001'])assert.throws(()=>cryptoUnits(s,'USD'));
 for(const suffix of ['', '/otc/quotes','/otc/orders','/orders/'+id,'/approve','/addresses','/settings','/withdrawals/orders','?page=1&kind=otc','?page=0&page=1'])for(const method of ['GET','POST','DELETE'])assert.equal(cryptoRoute(method,path+suffix),gatewayRoute(method,path+suffix));
 assert.ok(cryptoRoute('POST',path+'/otc/orders'));assert.ok(!cryptoRoute('POST',path+'/approve'));assert.ok(!cryptoRoute('GET',path+'/otc/quotes'));assert.ok(!cryptoRoute('POST','https://evil.invalid'+path+'/otc/orders'));
 const env={SITE_KIND:'client',API_ORIGIN:'https://api.invalid'},headers={Authorization:'Bearer fixture','Idempotency-Key':id,'Content-Type':'application/json'};
 const res=await handle(new Request('https://web.invalid'+path+'/otc/orders',{method:'POST',headers,body:'{}'}),env,async(_,o)=>{assert.equal(o.headers.get('Idempotency-Key'),id);return Response.json({data:{}})});assert.equal(res.status,200);
 assert.equal((await handle(new Request('https://web.invalid'+path+'/otc/orders',{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body:'{}'}),env,()=>assert.fail())).status,403);
 assert.equal((await handle(new Request('https://web.invalid/admin-api/v1/crypto-scopes',{headers}),env,()=>assert.fail())).status,404);
});
const state=globalThis.__cryptoFixture={reads:[],writes:[]};
const memory=new Map();globalThis.sessionStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};globalThis.document={hidden:false};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};const Pass=({children,...props})=>React.createElement('div',props,children);export const Box=Pass,Paper=Pass,Stack=Pass,Table=Pass,TableBody=Pass,TableCell=Pass,TableHead=Pass,TableRow=Pass,Typography=Pass,Divider=Pass,FormControlLabel=Pass,Switch=Pass,MenuItem=Pass;export const TextField=props=>React.createElement('input',props);export const Chip=({label})=>React.createElement('span',null,label);export const Alert=({children,action})=>React.createElement('div',null,children,action);export const Button=({children,...p})=>React.createElement('button',p,children);`);
const api=uri(`export const cryptoError=()=> '操作未确认';export const cryptoRequest=(path,body,key)=>new Promise((resolve,reject)=>globalThis.__cryptoFixture[body===undefined?'reads':'writes'].push({path,body,key,resolve,reject}));`);
const auth=uri('export const useAuth=()=>({session:{id:"actor"}});');
const live=uri('export class SessionError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}');
const fees=uri(source('../../packages/shared/src/finance/FundsFeeSettings.tsx').replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?shell:name.endsWith('/cryptoContract')?contract:resolve(name))));
const code=source('../../packages/shared/src/finance/CryptoFunds.tsx').replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='./FundsFeeSettings'?fees:name==='@mui/material'?shell:name.endsWith('/cryptoApi')?api:name.endsWith('/liveApi')?live:name.endsWith('/AuthContext')?auth:name.endsWith('/cryptoContract')?contract:resolve(name)));
const Funds=(await import(uri(code))).default;
const fixture={mode:'shadow',executionEligible:false,customerId:id,settings:{revision:1,otcEnabled:true,withdrawEnabled:true,usdtToUsd:'0.98',usdToUsdt:'1.01',withdrawalFeeMinor:'500000'},ledger:{accounts:[{id:'wallet',currency:'USDT',kind:'wallet',postedMinor:'100000000',heldMinor:'0',ledgerAvailableMinor:'100000000'}],totalsMinor:{USDT:'100000000'},reconciliation:'matched'},addresses:[],orders:[],total:0,page:0};
const flush=()=>new Promise(r=>setImmediate(r)),content=n=>typeof n==='string'?n:Array.isArray(n)?n.map(content).join(''):n?.children?content(n.children):'',button=(t,s)=>t.root.findAllByType('button').find(b=>content(b.props.children)===s);
async function mount(){let tree;await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,{initialEntries:['/portal/crypto?tab=exchange']},React.createElement(Funds,{customerId:id,basePath:'/portal/crypto'})));await flush()});return tree;}
test('OTC UI uses exact quote then retains the same request after an uncertain submission and reload',async()=>{
 state.reads=[];state.writes=[];memory.clear();let tree=await mount();await act(async()=>{state.reads[0].resolve(fixture);await flush()});assert.match(content(tree.toJSON()),/100.00 USDT/);
 await act(()=>tree.root.findAllByType('input').find(n=>n.props.label==='卖出 / 提现金额').props.onChange({target:{value:'12.123456'}}));
 await act(async()=>{button(tree,'获取报价').props.onClick();await flush()});assert.deepEqual(state.writes[0].body,{currency:'USDT',amountMinor:'12123456'});
 await act(async()=>{state.writes[0].resolve({id,kind:'otc',customerId:id,currency:'USDT',toCurrency:'USD',amountMinor:'12123456',receiveMinor:'1188',feeMinor:'0',rate:'0.98',policyRevision:1,expiresAt:new Date(Date.now()+300000).toISOString()});await flush()});
 await act(async()=>{button(tree,'确认兑换').props.onClick();await flush()});const first=state.writes[1];assert.deepEqual(first.body,{quoteId:id});await act(async()=>{first.reject(new Error('timeout'));await flush()});assert.ok(button(tree,'重试同一请求'));
 await act(()=>tree.unmount());tree=await mount();await act(async()=>{button(tree,'重试同一请求').props.onClick();await flush()});assert.equal(state.writes.at(-1).key,first.key);assert.deepEqual(state.writes.at(-1).body,first.body);
 await act(async()=>{state.writes.at(-1).resolve({id,state:'processing'});await flush()});assert.equal(memory.size,0);await act(()=>tree.unmount());
});

test('OpenAPI funding routes are reachable through both method allowlists',()=>{
 const spec=JSON.parse(readFileSync(new URL('../../services/api/docs/crypto.openapi.json',import.meta.url),'utf8'));
 for(const [template,operations] of Object.entries(spec.paths)){
  if(template.startsWith('/webhooks/'))continue;
  const path=template.replace('{connection}','cregis-waas').replace(/\{\w+\}/g,id);
  for(const method of Object.keys(operations)){assert.equal(cryptoRoute(method.toUpperCase(),path),true,path);assert.equal(gatewayRoute(method.toUpperCase(),path),true,path);}
 }
 assert.equal(cryptoRoute('GET',`/admin-api/v1/crypto-sources/cregis-waas/events/${id}?page=1`),false);
 assert.equal(cryptoRoute('POST',path+'/cards/orders'),true);
});

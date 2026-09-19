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
import {manualFundsRoute as edge} from '../../deploy/cloudflare/manual-funds.mjs';
const require=createRequire(import.meta.url),resolve=s=>pathToFileURL(require.resolve(s)).href;
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const source=p=>ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const contract=uri(source('../../packages/shared/src/auth/manualFundsContract.ts')),cryptoContract=uri(source('../../packages/shared/src/auth/cryptoContract.ts'));
const {manualFundsRoute}=await import(contract);const id='10000000-0000-0000-0000-000000000001',orderId='20000000-0000-0000-0000-000000000001',base=`/admin-api/v1/customers/${id}/manual-funds`;
test('manual funding method/query allowlists agree and reject cross-site writes',async()=>{
 const paths=['/admin-api/v1/balances','/admin-api/v1/balances?page=1&q=a%40example.com&currency=USD',`/admin-api/v1/balances/${id}`,base,base+'?page=1',base+'?page=-1',base+'?page=1&page=0',base+'/orders',base+'/orders/'+orderId,base+'/orders/'+orderId+'/approve',base+'/orders/'+orderId+'/apply',base+'/orders?x=1',base.replace('admin','client')+'/orders'];
 for(const path of paths)for(const method of ['GET','POST','DELETE','PATCH'])assert.equal(manualFundsRoute(method,path),edge(method,path));
 assert.equal(edge('POST',base.replace('admin','client')+'/orders'),false);assert.equal(edge('POST',base+'/orders?x=1'),false);assert.equal(edge('GET',base+'?page=-1'),false);
 const env={SITE_KIND:'admin',API_ORIGIN:'https://api.invalid'},headers={Authorization:'Bearer synthetic','Content-Type':'application/json','Idempotency-Key':id};
 const ok=await handle(new Request('https://admin.invalid'+base+'/orders',{method:'POST',headers,body:'{}'}),env,async(_,r)=>{assert.equal(r.headers.get('Idempotency-Key'),id);return Response.json({data:{}})});assert.equal(ok.status,200);
 assert.equal((await handle(new Request('https://admin.invalid'+base+'/orders',{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body:'{}'}),env,()=>assert.fail())).status,403);
 assert.equal((await handle(new Request('https://client.invalid/admin-api/v1/balances',{headers}),{...env,SITE_KIND:'client'},()=>assert.fail())).status,404);
});
const state=globalThis.__manualFixture={reads:[],writes:[]},memory=new Map();globalThis.sessionStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};globalThis.document={hidden:false};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};const Pass=({children})=>React.createElement('div',null,children);export const Stack=Pass,Box=Pass,Paper=Pass,Table=Pass,TableContainer=Pass,TableBody=Pass,TableCell=Pass,TableHead=Pass,TableRow=Pass,Typography=Pass,DialogTitle=Pass,DialogContent=Pass,DialogActions=Pass,MenuItem=Pass;export const Dialog=({open,children})=>open?React.createElement('div',null,children):null;export const TextField=props=>React.createElement('input',props);export const Alert=({children,action})=>React.createElement('div',null,children,action);export const Button=({children,...props})=>React.createElement('button',props,children);`);
const api=uri(`export const manualError=e=>e.message;export const manualRequest=(path,body,key)=>new Promise((resolve,reject)=>globalThis.__manualFixture[body===undefined?'reads':'writes'].push({path,body,key,resolve,reject}));`),auth=uri('export const useAuth=()=>({session:{id:"staff"}});'),live=uri('export class SessionError extends Error{constructor(code,status){super(code);this.code=code;this.status=status}}');
const code=source('../../packages/shared/src/finance/ManualFunds.tsx').replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?shell:name.endsWith('/manualFundsApi')?api:name.endsWith('/manualFundsContract')?contract:name.endsWith('/cryptoContract')?cryptoContract:name.endsWith('/AuthContext')?auth:name.endsWith('/liveApi')?live:resolve(name)));
const Manual=(await import(uri(code))).default;
const flush=()=>new Promise(r=>setImmediate(r));const content=n=>typeof n==='string'?n:Array.isArray(n)?n.map(content).join(''):n?.children?content(n.children):'';const button=(t,s)=>t.root.findAllByType('button').find(b=>content(b.props.children)===s);
async function mount(extra={}){let tree;await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,{initialEntries:['/finance/balances/'+id]},React.createElement(Manual,{customerId:id,admin:true,basePath:'/finance/balances/'+id,permissions:['read','create','review','execute'],canOperate:true,...extra})));await flush()});return tree}
const fixture={orders:[],total:0,page:0,mode:'shadow',enabled:true};
test('manual entry has no purpose field; exact amount and uncertain request survive reload',async()=>{
 state.reads=[];state.writes=[];memory.clear();let t=await mount();await act(async()=>{state.reads[0].resolve(fixture);await flush()});await act(()=>button(t,'人工入金').props.onClick());
 const fields=()=>t.root.findAllByType('input');assert.ok(!fields().some(f=>String(f.props.label).includes('用途')));
 for(const [name,value]of [['金额（USD）','10000.01'],['原因 / 备注','平台垫资'],['凭证引用','synthetic-proof']])await act(()=>fields().find(f=>f.props.label===name).props.onChange({target:{value}}));
 await act(async()=>{button(t,'确认提交').props.onClick();await flush()});const first=state.writes[0];assert.equal(first.body.amountMinor,'1000001');assert.equal(Object.hasOwn(first.body,'usage'),false);
 await act(async()=>{first.reject(new Error('结果待确认'));await flush()});assert.ok(button(t,'重试同一请求'));await act(()=>t.unmount());t=await mount();await act(async()=>{button(t,'重试同一请求').props.onClick();await flush()});assert.equal(state.writes.at(-1).key,first.key);assert.deepEqual(state.writes.at(-1).body,first.body);await act(async()=>{state.writes.at(-1).resolve({id:orderId});await flush()});assert.equal(memory.size,0);await act(()=>t.unmount());
});
test('authorized operator can approve own request; payment confirmation remains separate',async()=>{
 state.reads=[];memory.clear();let t=await mount({orderId});const order={id:orderId,customerId:id,actorId:'staff',direction:'debit',source:'offline_payout',currency:'USD',amountMinor:'100',state:'pending_review',revision:1,walletBeforeMinor:null,walletAfterMinor:null,createdAt:new Date().toISOString()};await act(async()=>{state.reads[0].resolve({order,events:[],mode:'shadow',enabled:true});await flush()});assert.ok(button(t,'批准'));assert.ok(button(t,'取消申请'));await act(()=>t.unmount());
 state.reads=[];t=await mount({orderId});await act(async()=>{state.reads[0].resolve({order:{...order,actorId:'staff',state:'awaiting_payment'},events:[],mode:'shadow',enabled:true});await flush()});assert.equal(button(t,'确认线下已付款').props.disabled,false);assert.equal(button(t,'批准'),undefined);await act(()=>t.unmount());
});
test('client history renders same order without operator actions',async()=>{
 state.reads=[];memory.clear();const t=await mount({admin:false});assert.ok(state.reads[0].path.startsWith('/client-api/'));await act(async()=>{state.reads[0].resolve({...fixture,orders:[{id:orderId,customerId:id,direction:'credit',source:'platform_advance',currency:'USD',amountMinor:'1000000',state:'completed',createdAt:'2026-09-18T00:00:00Z'}],total:1});await flush()});assert.match(content(t.toJSON()),/10000.00 USD/);assert.equal(button(t,'人工入金'),undefined);assert.ok(button(t,'详情'));await act(()=>t.unmount());
});

test('no-review mode hides approval and retains explicit legacy resume',async()=>{
 state.reads=[];memory.clear();const t=await mount({orderId});const order={id:orderId,customerId:id,actorId:'staff',direction:'credit',source:'platform_advance',currency:'USD',amountMinor:'100',state:'pending_review',revision:1,walletBeforeMinor:null,walletAfterMinor:null,createdAt:new Date().toISOString()};
 await act(async()=>{state.reads[0].resolve({order,events:[],mode:'live',enabled:true,approvalRequired:false});await flush()});
 assert.equal(button(t,'批准'),undefined);assert.ok(button(t,'继续处理原单'));await act(()=>t.unmount());
});

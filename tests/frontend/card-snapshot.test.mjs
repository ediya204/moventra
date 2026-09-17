import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {handle} from '../../deploy/cloudflare/gateway.mjs';
const source=readFileSync(new URL('../../packages/shared/src/auth/cardSnapshotContract.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {isCardSnapshotPath,snapshotAmount}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const base='/client-api/v1/customers/10000000-0000-0000-0000-000000000001/card-projections';
test('customer card contract restricts resource paths and parameters',()=>{
 for(const suffix of ['', '/slash/cards','/slash/cards/c1','/slash/transactions/t1','/slash/transactions?page=1&cardId=c1','/slash/cards?page=1&keyword=test'])assert.equal(isCardSnapshotPath(base+suffix),true,suffix);
 for(const suffix of ['?connection=x','/slash/cards/c1?user=x','/slash/cards?cardId=c1','/slash/transactions?page=0&page=1','/slash/cards#bad','/slash/cards?owner=x','/slash/cards/c1/freeze'])assert.equal(isCardSnapshotPath(base+suffix),false,suffix);
 assert.equal(isCardSnapshotPath(base.replace('/client-api','/admin-api')),false);
});
test('amounts retain precision and distinguish unknown and zero',()=>{
 assert.equal(snapshotAmount('-9007199254740993'),'USD −90071992547409.93');
 assert.equal(snapshotAmount('0'),'USD 0.00');assert.equal(snapshotAmount(undefined),'未知');assert.equal(snapshotAmount('100','JPY'),'JPY 100（来源最小单位）');assert.equal(snapshotAmount('1e3'),'未知');
});
test('gateway permits only client read paths, rejects writes and opposite surface',async()=>{
 const env={SITE_KIND:'client',API_ORIGIN:'https://api.example.invalid'};
 let calls=0;const upstream=async()=>{calls++;return Response.json({data:[]})};
 for(const suffix of ['', '/slash/cards','/slash/cards/c1','/slash/transactions/t1']){
  const req=new Request('https://moventra.test'+base+suffix,{headers:{Authorization:'Bearer test'}});
  assert.equal((await handle(req,env,upstream)).status,200);
  assert.equal((await handle(req,{...env,SITE_KIND:'admin'},upstream)).status,404);
  assert.equal((await handle(new Request(req,{method:'POST'}),env,upstream)).status,405);
 }
 assert.equal(calls,4);
});

// Render the real client view with a controlled network boundary.
const React=await import('react');
const {default:Renderer,act}=await import('react-test-renderer');
const {MemoryRouter}=await import('react-router-dom');
const {createRequire}=await import('node:module');
const {pathToFileURL}=await import('node:url');
const require=createRequire(import.meta.url);
const uri=value=>'data:text/javascript;base64,'+Buffer.from(value).toString('base64');
const fixture=globalThis.__cardSnapshotUI={requests:[]};
const mui=uri(`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};const Pass=({children,...props})=>React.createElement('div',props,children);export const Alert=Pass,Box=Pass,CircularProgress=Pass,MenuItem=Pass,Paper=Pass,Stack=Pass,Table=Pass,TableBody=Pass,TableCell=Pass,TableContainer=Pass,TableHead=Pass,TableRow=Pass,TextField=Pass,Typography=Pass;export const Button=({children,...props})=>React.createElement('button',props,children);`);
const api=uri(`export const authMessage=()=> '读取失败';export const liveGet=path=>new Promise((resolve,reject)=>globalThis.__cardSnapshotUI.requests.push({path,resolve,reject}));`);
const component=ts.transpileModule(readFileSync(new URL('../../apps/client/src/portal/CardSnapshots.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:name.endsWith('/liveApi')?api:name.endsWith('/cardSnapshotContract')?uri(outputText):pathToFileURL(require.resolve(name)).href));
const CardSnapshots=(await import(uri(component))).default;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const content=node=>typeof node==='string'?node:Array.isArray(node)?node.map(content).join(''):node?.children?content(node.children):'';
async function mount(path){fixture.requests=[];let view;await act(async()=>{view=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(CardSnapshots,{customerId:'10000000-0000-0000-0000-000000000001'})));await flush();});return view;}
const connections=[{id:'slash',label:'Synthetic',revision:'r1',sourceAt:'2026-09-07T00:00:00Z',importedAt:'2026-09-08T00:00:00Z'}];
const page=rows=>({rows,total:25,page:0,revision:'r1',sourceAt:connections[0].sourceAt,importedAt:connections[0].importedAt,coverageReason:'测试快照'});
test('card page supports empty, retry, URL pagination and context-preserving details',async()=>{
 let view=await mount('/portal/cards');await act(async()=>{fixture.requests[0].resolve([]);await flush()});assert.match(content(view.toJSON()),/尚未为本账户/);await act(()=>view.unmount());
 view=await mount('/portal/cards?connection=slash&page=1&keyword=card');await act(async()=>{fixture.requests[0].resolve(connections);await flush()});assert.match(fixture.requests[1].path,/cards\?page=1&revision=r1&keyword=card/);
 await act(async()=>{fixture.requests[1].reject(new Error('offline'));await flush()});assert.match(content(view.toJSON()),/读取失败/);
 const refresh=view.root.findAllByType('button').find(b=>b.props.children==='刷新快照');await act(async()=>{refresh.props.onClick();await flush()});await act(async()=>{fixture.requests[2].resolve(connections);await flush()});await act(async()=>{fixture.requests[3].resolve(page([{id:'c1',cardName:'Card one',last4:'1234'}]));await flush()});
 assert.match(content(view.toJSON()),/Card one/);const link=view.root.findAllByType('button').find(b=>b.props.children==='详情与交易');assert.match(link.props.to,/\/portal\/cards\/c1\?/);assert.match(new URL('https://test'+link.props.to).searchParams.get('back'),/page=1/);await act(()=>view.unmount());
});
test('direct card and transaction links load authoritative details and linked rows',async()=>{
 let view=await mount('/portal/cards/c1?connection=slash');await act(async()=>{fixture.requests[0].resolve(connections);await flush()});assert.equal(fixture.requests[1].path,base+'/slash/cards/c1');assert.match(fixture.requests[2].path,/transactions\?cardId=c1/);
 await act(async()=>{fixture.requests[1].resolve(page([{id:'c1',cardName:'Card one'}]));fixture.requests[2].resolve(page([{id:'t1',cardId:'c1',amountCents:'-9007199254740993',detailedStatus:'settled'}]));await flush()});assert.match(content(view.toJSON()),/90071992547409\.93/);await act(()=>view.unmount());
 view=await mount('/portal/card-transactions/t1?connection=slash');await act(async()=>{fixture.requests[0].resolve(connections);await flush()});assert.equal(fixture.requests[1].path,base+'/slash/transactions/t1');await act(async()=>{fixture.requests[1].resolve(page([{id:'t1',cardId:'c1',amountCents:'0',status:'posted',detailedStatus:'refund'}]));await flush()});assert.match(content(view.toJSON()),/USD 0\.00/);assert.match(content(view.toJSON()),/退款/);await act(()=>view.unmount());
});

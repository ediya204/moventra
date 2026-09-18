import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url),resolve=s=>pathToFileURL(require.resolve(s)).href;
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const state=globalThis.__productionOverview={requests:[]};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};const Pass=({children})=>React.createElement('div',null,children);export const Box=Pass,Paper=Pass,Stack=Pass,Table=Pass,TableBody=Pass,TableCell=Pass,TableContainer=Pass,TableHead=Pass,TableRow=Pass,Typography=Pass;export const Alert=({children,action})=>React.createElement('div',null,children,action);export const Button=({children,...p})=>React.createElement('button',p,children);`);
const api=uri(`const request=path=>new Promise((resolve,reject)=>globalThis.__productionOverview.requests.push({path,resolve,reject}));export const cryptoRequest=request,liveGet=request,cryptoError=()=> '读取失败',authMessage=()=> '读取失败';`);
const router=uri('export const Link=()=>null;');
const transpile=p=>ts.transpileModule(readFileSync(new URL(p,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const contract=uri(transpile('../../packages/shared/src/auth/cryptoContract.ts'));
const cards=uri(transpile('../../packages/shared/src/auth/cardSnapshotContract.ts'));
const statusView=uri(transpile('../../packages/shared/src/components/ChannelCardStatus.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:resolve(n))));
async function component(p){return (await import(uri(transpile(p).replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n.endsWith('/ChannelCardStatus')?statusView:n==='@mui/material'?shell:n==='react-router-dom'?router:n.endsWith('/cryptoApi')||n.endsWith('/liveApi')?api:n.endsWith('/cryptoContract')?contract:n.endsWith('/cardSnapshotContract')?cards:resolve(n)))))).default;}
const Wallet=await component('../../apps/client/src/portal/ProductionWallet.tsx');
const Cards=await component('../../apps/client/src/portal/CardOverview.tsx');
const VersionNotice=await component('../../apps/client/src/VersionNotice.tsx');
const flush=()=>new Promise(r=>setImmediate(r));
const content=n=>typeof n==='string'?n:Array.isArray(n)?n.map(content).join(''):n?.children?content(n.children):'';
const text=t=>content(t.toJSON());
const snapshot=id=>({customerId:id,mode:'live',ledger:{reconciliation:'matched',accounts:[{kind:'wallet',currency:'USD',ledgerAvailableMinor:'9007199254740993'},{kind:'escrow',currency:'USD',ledgerAvailableMinor:'999999'}]},orders:[{id:'order-1',customerId:id,kind:'otc',state:'completed',currency:'USDT',amountMinor:'100000',createdAt:'2026-09-18T16:27:41Z'}]});
async function mount(C,props={customerId:'A'}){state.requests=[];let tree;await act(async()=>{tree=Renderer.create(React.createElement(C,props));await flush()});return tree;}
async function answer(index,value){await act(async()=>{state.requests[index].resolve(value);await flush()});}

test('正式钱包精确读取同源余额和订单，隔离卡资金，未知币种不显示零',async()=>{
 const tree=await mount(Wallet);try{
 assert.equal(state.requests[0].path,'/client-api/v1/customers/A/crypto?limit=5');
 assert.ok(!text(tree).includes('0.00 USD'));
 await answer(0,snapshot('A'));
 for(const value of ['90071992547409.93 USD','尚未开通','OTC 兑换','0.100000 USDT','已完成'])assert.ok(text(tree).includes(value),value);
 assert.ok(!text(tree).includes('9999.99'));
 assert.equal(tree.root.findAllByType('button').find(b=>b.props.children==='详情').props.to,'/portal/funds/orders/order-1');
 }finally{await act(()=>tree.unmount())}
});
test('失败、shadow、跨客户、旧响应均不能冒充正式余额；重试可恢复',async()=>{
 const tree=await mount(Wallet);try{
 await answer(0,{...snapshot('A'),mode:'shadow'});assert.ok(text(tree).includes('正式资金暂不可用'));
 await act(async()=>{tree.root.findAllByType('button').find(b=>b.props.children==='重试').props.onClick();await flush()});
 await answer(1,snapshot('B'));assert.ok(!text(tree).includes('90071992547409.93'));
 await act(async()=>{tree.update(React.createElement(Wallet,{customerId:'C'}));await flush()});
 const old=state.requests[2];
 await act(async()=>{tree.update(React.createElement(Wallet,{customerId:'D'}));await flush();old.resolve(snapshot('C'));state.requests[3].reject(new Error('down'));await flush()});
 assert.ok(text(tree).includes('资金交易暂不可用'));assert.ok(!text(tree).includes('暂无正式资金订单'));
 await act(async()=>{tree.root.findAllByType('button').find(b=>b.props.children==='重试').props.onClick();await flush()});
 await answer(4,{...snapshot('D'),orders:[],ledger:{...snapshot('D').ledger,reconciliation:'mismatch'}});
 assert.ok(text(tree).includes('余额核对中'));assert.ok(text(tree).includes('暂无正式资金订单'));assert.ok(!text(tree).includes('90071992547409.93'));
 }finally{await act(()=>tree.unmount())}
});
test('卡片展示服务端总数和局部预览，失败来源不伪装成零，详情保留连接',async()=>{
 const tree=await mount(Cards);try{
 await answer(0,[{id:'one',label:'来源一',revision:'v1'},{id:'two',label:'来源二',revision:'v2'}]);
 assert.ok(state.requests[1].path.endsWith('/one/cards?page=0&revision=v1'));
 await act(async()=>{state.requests[1].resolve({total:23,rows:Array.from({length:20},(_,i)=>({id:'card'+i,last4:'1234',cardStatus:'active',syncState:'synced'}))});state.requests[2].reject(new Error('down'));await flush()});
 assert.ok(text(tree).includes('23 张'));assert.ok(!text(tree).includes('0 张'));assert.ok(text(tree).includes('读取失败'));
 const links=tree.root.findAllByType('button').filter(b=>b.props.to?.startsWith('/portal/cards/card'));
 assert.equal(links.length,5);assert.ok(links[0].props.to.includes('connection=one'));
 }finally{await act(()=>tree.unmount())}
});
test('版本更新仅提示，不自动刷新正在操作的页面',async()=>{
 const original={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,DOMParser:globalThis.DOMParser};
 let reloads=0;
 globalThis.document={hidden:false,querySelector:()=>({src:'https://web.invalid/assets/index-old.js'}),addEventListener(){},removeEventListener(){}};
 globalThis.window={location:{origin:'https://web.invalid',reload(){reloads++}}};
 globalThis.DOMParser=class{parseFromString(){return {querySelector:()=>({getAttribute:()=>'/assets/index-new.js'})}}};
 globalThis.fetch=async()=>new Response('<html/>',{headers:{'content-type':'text/html'}});
 let tree;try{
 tree=await mount(VersionNotice,{});assert.ok(text(tree).includes('有新版本可用'));assert.equal(reloads,0);
 await act(()=>tree.root.findByType('button').props.onClick());assert.equal(reloads,1);
 }finally{if(tree)await act(()=>tree.unmount());Object.assign(globalThis,original)}
});

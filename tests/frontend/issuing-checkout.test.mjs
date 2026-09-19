import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import ts from 'typescript';
const require=createRequire(import.meta.url),uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64'),resolve=s=>pathToFileURL(require.resolve(s)).href;
const compile=p=>ts.transpileModule(readFileSync(new URL(p,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const fixture=globalThis.__checkout={calls:[],timeout:true,products:[]};
globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
const storage=new Map();globalThis.sessionStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i],get length(){return storage.size}};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};const Pass=({children,...p})=>React.createElement('div',p,children);export const Chip=({label})=>React.createElement('span',null,label);export const Box=Pass,Paper=Pass,Stack=Pass,Typography=Pass,CircularProgress=()=>null;export const Alert=({children,action})=>React.createElement('div',null,children,action);export const Button=({children,startIcon,endIcon,...p})=>React.createElement('button',p,children);export const TextField=p=>React.createElement('input',p),Checkbox=p=>React.createElement('input',{...p,type:'checkbox'});export const FormControlLabel=({control,label})=>React.createElement('label',null,control,label);`);
const api=uri(`export class IssuingError extends Error{};export async function issuingRequest(path,body,key){let f=globalThis.__checkout;f.calls.push({path,body,key});if(path.endsWith('/products'))return f.products;if(path.includes('/products?'))return f.products;if(path.includes('/products/'))return f.products[0];if(path.endsWith('/wallet'))return {availableMinor:'10000',currency:'USD',mode:'isolated',fundingSource:'funds_wallet',executionEnabled:true};if(path.endsWith('/terms'))return {version:'v1',text:'fixture terms',digest:'digest'};if(path.endsWith('/quotes')&&f.quoteHook)return f.quoteHook(body);if(path.endsWith('/quotes'))return {id:'quote1',termsVersion:'v1',feeMinor:'500',fundingMinor:body.fundingMinor,totalMinor:String(BigInt(body.fundingMinor)+500n),expiresAt:new Date(Date.now()+300000).toISOString()};if(body&&path.endsWith('/orders')){if(f.timeout)throw new Error('结果尚未确认');return {id:'order1',state:'active'}};if(path.includes('/orders/'))return {id:'order1',state:'active',feeMinor:'500',fundingMinor:'1000',cardName:'Alex',productName:'BIN A',bin:'990001'};return [];}`);
const contract=uri(compile('../../packages/shared/src/issuing/contract.ts'));
const pending=uri(compile('../../packages/shared/src/issuing/pending.ts'));
const sectionNav=uri(compile('../../packages/shared/src/components/SectionNavigation.tsx').replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:resolve(n))));
const rewrite=code=>code.replace(/from ["']([^"']+)["']/g,(_,s)=>'from '+JSON.stringify(s.endsWith('/SectionNavigation')?sectionNav:s==='@mui/material'?shell:s==='./api'||s.endsWith('/issuing/api')?api:s==='./contract'||s.endsWith('/issuing/contract')?contract:s.endsWith('/issuing/pending')?pending:s.endsWith('/issuing/ui')?ui:resolve(s)));
const ui=uri(rewrite(compile('../../packages/shared/src/issuing/ui.tsx')));
const App=(await import(uri(rewrite(compile('../../apps/client/src/issuing/CardIssuing.tsx'))))).default;
const flush=()=>new Promise(r=>setImmediate(r));
const autoQuote=()=>act(async()=>{await new Promise(r=>setTimeout(r,450));await flush()});
const id='10000000-0000-4000-8000-000000000001';
async function mount(path='/portal/cards/new?product='+id){let tree;await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(App,{customerId:id,uid:'alice'})));await flush();await flush()});return tree}
const buttons=t=>t.root.findAllByType('button');
const text=t=>JSON.stringify(t.toJSON());
test('checkout requires both declarations, resets on amount change, and restores identical payment after timeout/remount',async()=>{
 fixture.calls=[];fixture.timeout=true;storage.clear();fixture.products=[{id,name:'BIN A',bin:'990001',network:'visa',minimumMinor:'1000',feeMinor:'500',blockedReason:'',status:'active'}];
 let tree=await mount();
 assert.match(text(tree),/开卡申请/);assert.equal(buttons(tree).some(b=>b.props.to==='/portal/funds/exchange'),false);
 await autoQuote();
 const pay=()=>buttons(tree).find(b=>String(b.props.children).startsWith('确认开卡'));
 assert.equal(pay().props.disabled,true);
 const check=()=>tree.root.findAllByType('input').filter(n=>n.props.type==='checkbox');
 await act(()=>check()[0].props.onChange({target:{checked:true}}));assert.equal(pay().props.disabled,true);
 await act(()=>check()[1].props.onChange({target:{checked:true}}));assert.equal(pay().props.disabled,false);
 await act(()=>tree.root.findAllByType('input').find(n=>n.props.label==='初始卡余额 · USD').props.onChange({target:{value:'20'}}));
 assert.equal(pay(),undefined);assert.equal(check().length,0);
 await autoQuote();
 await act(()=>{check()[0].props.onChange({target:{checked:true}});check()[1].props.onChange({target:{checked:true}})});
 await act(async()=>{pay().props.onClick();await flush()});
 assert.match(text(tree),/结果尚未确认/);
 const first=fixture.calls.find(c=>c.path.endsWith('/orders')&&c.body);assert.equal(first.body.acceptedTerms,true);assert.equal(first.body.lawfulUse,true);assert.equal(storage.size,1);
 await act(()=>tree.unmount());fixture.timeout=false;tree=await mount();
 await act(async()=>{buttons(tree).find(b=>b.props.children==='查询并恢复原请求').props.onClick();await flush()});
 const writes=fixture.calls.filter(c=>c.path.endsWith('/orders')&&c.body);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(storage.size,0);assert.match(text(tree),/开卡成功/);
 await act(()=>tree.unmount());
});
test('pending payment is isolated by identity and cleared on logout',async()=>{
 const m=await import(pending);storage.clear();m.savePending(m.pendingKey('alice',id),{key:'key',path:'path',body:{}});
 assert.equal(m.readPending(m.pendingKey('bob',id)),null);m.clearIssuingPending();assert.equal(storage.size,0);
});

test('catalog defers checkout until selection and declarations until quote',async()=>{
 storage.clear();fixture.products=[{id,name:'Moventra USD · 990001',bin:'990001',network:'visa',minimumMinor:'1000',feeMinor:'500',description:'Product details',blockedReason:''}];
 const tree=await mount('/portal/cards/new');
 assert.equal(buttons(tree).some(b=>b.props.children==='获取最新费用'),false);
 assert.equal(tree.root.findAllByType('input').filter(n=>n.props.type==='checkbox').length,0);
 await act(async()=>{buttons(tree).find(b=>b.props.children==='选择').props.onClick();await flush();await flush()});
 assert.match(text(tree),/正在计算开卡费用/);
 assert.equal(tree.root.findAllByType('input').filter(n=>n.props.type==='checkbox').length,0);
 await act(()=>tree.unmount());
});

test('exchange shortcut appears only for quoted USD shortfall and clears on amount edit',async()=>{
 storage.clear();fixture.products=[{id,name:'BIN A',bin:'990001',network:'visa',minimumMinor:'1000',feeMinor:'500',blockedReason:''}];
 const tree=await mount();
 try {
  const exchange=()=>buttons(tree).some(b=>b.props.to==='/portal/funds/exchange');
  const amount=()=>tree.root.findAllByType('input').find(n=>n.props.label==='初始卡余额 · USD');
  const quote=autoQuote;
  assert.equal(exchange(),false);
  await quote();assert.equal(exchange(),false);
  await act(()=>amount().props.onChange({target:{value:'200'}}));assert.equal(exchange(),false);
  await quote();assert.equal(exchange(),true);assert.match(text(tree),/105.00/);
  await act(()=>amount().props.onChange({target:{value:'20'}}));assert.equal(exchange(),false);
 } finally {await act(()=>tree.unmount())}
});

test('automatic pricing ignores stale replies and supports retry after failure',async()=>{
 storage.clear();fixture.calls=[];fixture.products=[{id,name:'BIN A',bin:'990001',network:'visa',minimumMinor:'1000',feeMinor:'500',blockedReason:''}];
 const waiting=[];fixture.quoteHook=body=>new Promise((resolve,reject)=>waiting.push({body,resolve,reject}));
 const tree=await mount();
 const result=(funding)=>({id:'q-'+funding,termsVersion:'v1',feeMinor:'500',fundingMinor:funding,totalMinor:String(BigInt(funding)+500n),expiresAt:new Date(Date.now()+300000).toISOString()});
 try {
  await autoQuote();assert.equal(waiting.length,1);
  await act(()=>tree.root.findAllByType('input').find(n=>n.props.label==='初始卡余额 · USD').props.onChange({target:{value:'20'}}));
  await autoQuote();assert.equal(waiting.length,2);
  await act(async()=>{waiting[1].resolve(result('2000'));await flush()});
  await act(async()=>{waiting[0].resolve(result('1000'));await flush()});
  assert.ok(buttons(tree).some(b=>b.props.children==='确认开卡 · USD 25.00'));
  await act(()=>tree.root.findAllByType('input').find(n=>n.props.label==='初始卡余额 · USD').props.onChange({target:{value:'30'}}));
  await autoQuote();await act(async()=>{waiting[2].reject(new Error('费用暂不可查询'));await flush()});
  assert.match(text(tree),/费用暂不可查询/);assert.equal(buttons(tree).some(b=>String(b.props.children).startsWith('确认开卡')),false);
  await act(()=>buttons(tree).find(b=>b.props.children==='重新计算费用').props.onClick());
  await autoQuote();await act(async()=>{waiting[3].resolve(result('3000'));await flush()});
  assert.ok(buttons(tree).some(b=>b.props.children==='确认开卡 · USD 35.00'));
  assert.equal(fixture.calls.some(c=>c.path.endsWith('/orders')&&c.body),false);
 } finally {fixture.quoteHook=undefined;await act(()=>tree.unmount())}
});

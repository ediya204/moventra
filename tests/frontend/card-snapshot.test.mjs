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
const mui=uri(`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};const Pass=({component='div',children,...props})=>React.createElement(component,props,children);export const Link=Pass,Alert=Pass,Box=Pass,CircularProgress=Pass,Chip=Pass,Drawer=Pass,IconButton=Pass,MenuItem=Pass,Paper=Pass,Stack=Pass,Table=Pass,TableBody=Pass,TableCell=Pass,TableContainer=Pass,TableHead=Pass,TableRow=Pass,TextField=Pass,Typography=Pass;export const Button=({children,...props})=>React.createElement('button',props,children);`);
const api=uri(`export const authMessage=()=> '读取失败';export const liveGet=path=>new Promise((resolve,reject)=>globalThis.__cardSnapshotUI.requests.push({path,resolve,reject}));`);
const logo=ts.transpileModule(readFileSync(new URL('../../packages/shared/src/components/MerchantLogo.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace('import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY','undefined').replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:name==='./merchantBrand'?new URL('../../packages/shared/src/components/merchantBrand.ts',import.meta.url).href:pathToFileURL(require.resolve(name)).href));
const component=ts.transpileModule(readFileSync(new URL('../../apps/client/src/portal/CardSnapshots.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:name.endsWith('/MerchantLogo')?uri(logo):name.endsWith('/liveApi')?api:name.endsWith('/cardSnapshotContract')?uri(outputText):pathToFileURL(require.resolve(name)).href));
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
 view=await mount('/portal/card-transactions/t1?connection=slash');await act(async()=>{fixture.requests[0].resolve(connections);await flush()});assert.equal(fixture.requests[1].path,base+'/slash/transactions/t1');await act(async()=>{fixture.requests[1].resolve(page([{id:'t1',cardId:'c1',amountCents:'0',status:'posted',detailedStatus:'refund'}]));await flush()});assert.match(content(view.toJSON()),/0\.00USD · 卡片交易/);assert.match(content(view.toJSON()),/退款/);await act(()=>view.unmount());
});

test('merchant images appear in snapshot list, card-linked rows and transaction detail',async()=>{
 for(const path of ['/portal/transactions?connection=slash','/portal/cards/c1?connection=slash','/portal/card-transactions/t1?connection=slash']){
  const view=await mount(path);
  await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
  const row={id:'t1',cardId:'c1',merchant:'FACEBK *PRIVATE-ORDER-123',amountCents:'0'};
  await act(async()=>{
   fixture.requests[1].resolve(page(path.startsWith('/portal/cards/')?[{id:'c1',cardName:'Card one'}]:[row]));
   if(fixture.requests[2])fixture.requests[2].resolve(page([row]));
   await flush();
  });
  const img=view.root.findByType('img');
  assert.match(img.props.src,/name\/Facebook/);
  assert.ok(!img.props.src.includes('PRIVATE-ORDER'));
  assert.equal(img.props.width,path.includes('/card-transactions/')?56:32);
  assert.match(content(view.toJSON()),/FACEBK \*PRIVATE-ORDER-123/);
  assert.match(content(view.toJSON()),/Logos provided by Logo.dev/);
  await act(()=>img.props.onError());
  assert.equal(view.root.findAllByType('img').length,0);
  assert.match(content(view.toJSON()),/FACEBK \*PRIVATE-ORDER-123/);
  await act(()=>view.unmount());
 }
});


test('transaction drawer preserves paginated list, supports deep links, retry and close',async()=>{
 const view=await mount('/portal/transactions?connection=slash&page=1&keyword=OPENAI&transaction=t1');
 const listConnections=fixture.requests.find(r=>r.path===base);
 const detail=fixture.requests.find(r=>r.path===base+'/slash/transactions/t1');
 assert.ok(detail,'URL restores detail without list cache');
 await act(async()=>{listConnections.resolve(connections);detail.reject(new Error('offline'));await flush()});
 const list=fixture.requests.find(r=>r.path.includes('transactions?page=1'));
 assert.match(list.path,/keyword=OPENAI/);
 await act(async()=>{list.resolve(page([{id:'t1',merchant:'OPENAI',cardId:'c1',cardLast4:'2047',amountCents:'-1891'}]));await flush()});
 assert.match(content(view.toJSON()),/OPENAI/);assert.match(content(view.toJSON()),/•••• 2047/);
 const drawer=view.root.findAll(n=>n.props.anchor==='right'&&n.props.PaperProps)[0];
 assert.equal(drawer.props.PaperProps.role,'dialog');
 const alert=drawer.findAll(n=>n.props.severity==='error')[0];
 await act(async()=>{alert.props.action.props.onClick();await flush()});
 await act(async()=>{fixture.requests.at(-1).resolve(page([{id:'t1',merchant:'OPENAI detail',cardId:'c1',cardLast4:'2047',amountCents:'-1891'}]));await flush()});
 assert.match(content(view.toJSON()),/OPENAI detail/);
 assert.match(content(view.toJSON()),/•••• 2047/);
 assert.match(content(view.toJSON()),/−18.91/);
 const requests=fixture.requests.length;
 await act(async()=>{drawer.props.onClose();await flush()});
 assert.equal(view.root.findAll(n=>n.props.anchor==='right').length,0);
 assert.equal(fixture.requests.length,requests,'closing preserves list without refetch');
 const detailLink=view.root.findAllByType('button').find(b=>b.props.children==='详情');
 assert.match(detailLink.props.to,/page=1/);assert.match(detailLink.props.to,/keyword=OPENAI/);assert.match(detailLink.props.to,/transaction=t1/);
 await act(()=>view.unmount());
});


test('status presentation distinguishes failure, settlement, refund and unknown source combinations',async()=>{
 const {transactionAppearance:display}=await import(uri(component));
 assert.equal(display({status:'failed',detailedStatus:'declined'}).color,'error');
 assert.equal(display({status:'failed'}).icon,'close');
 assert.equal(display({status:'posted',detailedStatus:'settled'}).color,'success');
 assert.equal(display({status:'pending',detailedStatus:'settled'}).label,'待核实');
 assert.equal(display({status:'pending',detailedStatus:'refund'}).label,'退款处理中');
 assert.equal(display({status:'posted',detailedStatus:'refund'}).icon,'refund');
 assert.notEqual(display({status:'posted',detailedStatus:'reversed'}).icon,display({status:'posted',detailedStatus:'settled'}).icon);
 assert.equal(display({status:'posted',detailedStatus:'new-state'}).label,'未知状态');
 assert.equal(display({}).color,'default');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {handle} from '../../deploy/cloudflare/gateway.mjs';
const source=readFileSync(new URL('../../packages/shared/src/auth/cardSnapshotContract.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {isCardSnapshotPath,isCardSyncPath,cardSyncLabel,snapshotAmount}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const base='/client-api/v1/customers/10000000-0000-0000-0000-000000000001/card-projections';
test('customer card contract restricts resource paths and parameters',()=>{
 for(const suffix of ['', '/slash/cards','/slash/cards/c1','/slash/transactions/t1','/slash/transactions?page=1&cardId=c1','/slash/cards?page=1&keyword=test'])assert.equal(isCardSnapshotPath(base+suffix),true,suffix);
 for(const suffix of ['?connection=x','/slash/cards/c1?user=x','/slash/cards?cardId=c1','/slash/transactions?page=0&page=1','/slash/cards#bad','/slash/cards?owner=x','/slash/cards/c1/freeze'])assert.equal(isCardSnapshotPath(base+suffix),false,suffix);
 assert.equal(isCardSnapshotPath(base.replace('/client-api','/admin-api')),false);
});
test('amounts retain precision and distinguish unknown and zero',()=>{
 assert.equal(snapshotAmount('-9007199254740993'),'USD −90071992547409.93');
 assert.equal(snapshotAmount('0'),'USD 0.00');assert.equal(snapshotAmount(undefined),'未知');assert.equal(snapshotAmount('100','JPY'),'JPY 100');assert.equal(snapshotAmount('1e3'),'未知');
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
const mui=uri(`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};const Pass=({component='div',children,...props})=>React.createElement(component,props,children);export const ButtonBase=Pass,Tab=Pass,Tabs=Pass,Divider=Pass,Popover=Pass,Link=Pass,Alert=Pass,Box=Pass,CircularProgress=Pass,Chip=({label,...props})=>React.createElement('span',props,label),Drawer=Pass,IconButton=Pass,MenuItem=Pass,Paper=Pass,Stack=Pass,Table=Pass,TableBody=Pass,TableCell=Pass,TableContainer=Pass,TableHead=Pass,TableRow=Pass,TextField=Pass,Typography=Pass;export const Button=({children,...props})=>React.createElement('button',props,children);`);
const api=uri(`export const liveCardRemark=(path,body)=>new Promise((resolve,reject)=>globalThis.__cardSnapshotUI.requests.push({path,body,resolve,reject}));export const liveCardSync=path=>Promise.resolve({syncState:'pending'});export const authMessage=()=> '读取失败';export const liveGet=path=>new Promise((resolve,reject)=>globalThis.__cardSnapshotUI.requests.push({path,resolve,reject}));`);
const logo=ts.transpileModule(readFileSync(new URL('../../packages/shared/src/components/MerchantLogo.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace('import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY','undefined').replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:name==='./merchantBrand'?new URL('../../packages/shared/src/components/merchantBrand.ts',import.meta.url).href:pathToFileURL(require.resolve(name)).href));
const cardStatusUI=ts.transpileModule(readFileSync(new URL('../../packages/shared/src/components/ChannelCardStatus.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:pathToFileURL(require.resolve(name)).href));
const detailCode=ts.transpileModule(readFileSync(new URL('../../apps/client/src/portal/CardDetailWorkspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:name.endsWith('/ChannelCardStatus')?uri(cardStatusUI):name.endsWith('/MerchantLogo')?uri(logo):name.endsWith('/RemoteCardCvv')?uri('export const RemoteCardCvv=()=>null'):name.endsWith('/CardControls')||name.endsWith('/CustomerFunds')?uri('export default ()=>null'):name.endsWith('/cryptoApi')?uri('export const cryptoRequest=()=>new Promise(()=>{});export const cryptoError=()=>"资金读取失败";'):name.endsWith('/cryptoContract')?uri('export const cryptoMoney=(v,c)=>v+" "+c;'):name.endsWith('/liveApi')?api:name.endsWith('/cardSnapshotContract')?uri(outputText):pathToFileURL(require.resolve(name)).href));
const visuals=uri(ts.transpileModule(readFileSync(new URL('../../packages/shared/src/components/transactionVisuals.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const queryCode=ts.transpileModule(readFileSync(new URL('../../apps/client/src/portal/transactionQuery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from ["']([^"']+)["']/g,()=> 'from '+JSON.stringify(uri(outputText)));
const filterCode=ts.transpileModule(readFileSync(new URL('../../apps/client/src/portal/TransactionFilters.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:name==='./transactionQuery'?uri(queryCode):pathToFileURL(require.resolve(name)).href));
const component=ts.transpileModule(readFileSync(new URL('../../apps/client/src/portal/CardSnapshots.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?mui:name==='./transactionQuery'?uri(queryCode):name==='./TransactionFilters'?uri(filterCode):name.endsWith('/merchantBrand')?new URL('../../packages/shared/src/components/merchantBrand.ts',import.meta.url).href:name.endsWith('/transactionVisuals')?visuals:name.endsWith('/CardDetailWorkspace')?uri(detailCode):name.endsWith('/ChannelCardStatus')?uri(cardStatusUI):name.endsWith('/CardControls')?uri('export default ()=>null'):name.endsWith('/MerchantLogo')?uri(logo):name.endsWith('/liveApi')?api:name.endsWith('/cardSnapshotContract')?uri(outputText):pathToFileURL(require.resolve(name)).href));
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
 const refresh=view.root.findAllByType('button').find(b=>b.props.children==='刷新状态');await act(async()=>{refresh.props.onClick();await flush()});await act(async()=>{fixture.requests[2].resolve(connections);await flush()});await act(async()=>{fixture.requests[3].resolve(page([{id:'c1',cardName:'Card one',last4:'1234'}]));await flush()});
 assert.match(content(view.toJSON()),/Card one/);const link=view.root.findAllByType('button').find(b=>b.props.children==='详情');assert.match(link.props.to,/\/portal\/cards\/c1\?/);assert.match(new URL('https://test'+link.props.to).searchParams.get('back'),/page=1/);await act(()=>view.unmount());
});
test('direct card and transaction links load authoritative details and linked rows',async()=>{
 let view=await mount('/portal/cards/c1?connection=slash');await act(async()=>{fixture.requests[0].resolve(connections);await flush()});assert.equal(fixture.requests[1].path,base+'/slash/cards/c1');
 await act(async()=>{fixture.requests[1].resolve(page([{id:'c1',cardName:'Card one'}]));await flush()});await act(async()=>{await flush();assert.match(fixture.requests[2].path,/cardId=c1/);fixture.requests[2].resolve(page([{id:'t1',cardId:'c1',amountCents:'-9007199254740993',detailedStatus:'settled'}]));await flush()});assert.match(content(view.toJSON()),/90071992547409\.93/);await act(()=>view.unmount());
 view=await mount('/portal/card-transactions/t1?connection=slash');await act(async()=>{fixture.requests[0].resolve(connections);await flush()});assert.equal(fixture.requests[1].path,base+'/slash/transactions/t1');await act(async()=>{fixture.requests[1].resolve(page([{id:'t1',cardId:'c1',amountCents:'0',status:'posted',detailedStatus:'refund'}]));await flush()});assert.match(content(view.toJSON()),/0\.00USD · 卡片交易/);assert.match(content(view.toJSON()),/退款/);await act(()=>view.unmount());
});

test('merchant images appear in snapshot list, card-linked rows and transaction detail',async()=>{
 for(const path of ['/portal/transactions?connection=slash','/portal/cards/c1?connection=slash','/portal/card-transactions/t1?connection=slash']){
  const view=await mount(path);
  await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
  const row={id:'t1',cardId:'c1',merchant:'FACEBK *PRIVATE-ORDER-123',amountCents:'0'};
  await act(async()=>{
   fixture.requests[1].resolve(page(path.startsWith('/portal/cards/')?[{id:'c1',cardName:'Card one'}]:[row]));
   await flush();
  });await act(async()=>{if(fixture.requests[2])fixture.requests[2].resolve(page([row]));
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

test('sync command has an exact path and honest freshness labels',async()=>{
 const path=base+'/slash/cards/c1/sync';assert.equal(isCardSyncPath(path),true);
 for(const bad of [path+'?force=1',path.replace('/cards/','/transactions/'),path+'/extra',path.replace('/sync','/freeze')])assert.equal(isCardSyncPath(bad),false);
 assert.match(cardSyncLabel({syncState:'error'}),/同步异常/);assert.match(cardSyncLabel({syncState:'stale'}),/待核实/);assert.equal(cardSyncLabel({}),'导入快照');
 const env={SITE_KIND:'client',API_ORIGIN:'https://api.example.invalid'};let calls=0;
 const upstream=async(url,req)=>{calls++;assert.equal(req.method,'POST');return Response.json({data:{syncState:'pending'}},{status:202})};
 const request=(method='POST',origin='https://moventra.test')=>new Request('https://moventra.test'+path,{method,headers:{Authorization:'Bearer test',Origin:origin}});
 assert.equal((await handle(request(),env,upstream)).status,202);
 assert.equal((await handle(request('GET'),env,upstream)).status,405);
 assert.equal((await handle(request('POST','https://other.test'),env,upstream)).status,403);
 assert.equal((await handle(request(),{...env,SITE_KIND:'admin'},upstream)).status,404);assert.equal(calls,1);
});

test('card center filters server-side across pages, preserves detail context and resets filters',async()=>{
 const view=await mount('/portal/cards?connection=slash&page=1&keyword=team&cardStatus=paused&cardSort=name');
 await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
 assert.match(fixture.requests[1].path,/page=1&revision=r1&keyword=team&cardStatus=paused/);
 assert.ok(!fixture.requests[1].path.includes('cardSort'),'page sorting does not invent an API parameter');
 await act(async()=>{fixture.requests[1].resolve(page([{id:'z',name:'Zulu',cardStatus:'paused'},{id:'a',name:'Alpha',cardStatus:'paused'}]));await flush()});
 const text=content(view.toJSON());assert.ok(text.indexOf('Alpha')<text.indexOf('Zulu'));assert.match(text,/找到 25 张卡片 · 本页 2 张/);
 const detail=view.root.findAllByType('button').find(b=>b.props.children==='详情');
 const back=new URL('https://test'+detail.props.to).searchParams.get('back');assert.match(back,/cardStatus=paused/);assert.match(back,/cardSort=name/);
 const status=view.root.findAll(n=>n.props.label==='卡片状态'&&n.props.onChange)[0];
 await act(async()=>{status.props.onChange({target:{value:'active'}});await flush()});
 assert.match(fixture.requests.at(-1).path,/page=0&revision=r1&keyword=team&cardStatus=active/);
 await act(async()=>{fixture.requests.at(-1).resolve({...page([]),total:0});await flush()});assert.match(content(view.toJSON()),/没有符合条件的卡片/);
 const reset=view.root.findAllByType('button').find(b=>b.props.children==='清空筛选');
 await act(async()=>{reset.props.onClick();await flush()});
 assert.ok(fixture.requests.at(-1).path.endsWith('cards?page=0&revision=r1'));
 await act(()=>view.unmount());
});

test('card search submits explicitly and stale filter responses cannot replace current results',async()=>{
 const view=await mount('/portal/cards?connection=slash');
 await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
 const previous=fixture.requests[1];
 const search=view.root.findAll(n=>n.props.label==='搜索卡名、尾号或卡片 ID'&&n.props.onChange)[0];
 const count=fixture.requests.length;
 await act(()=>search.props.onChange({target:{value:' 2047 '}}));assert.equal(fixture.requests.length,count);
 await act(async()=>{view.root.findByType('form').props.onSubmit({preventDefault(){}});await flush()});
 assert.match(fixture.requests.at(-1).path,/keyword=2047/);
 await act(async()=>{fixture.requests.at(-1).resolve({...page([{id:'new',name:'Current card'}]),total:1});previous.resolve(page([{id:'old',name:'Stale card'}]));await flush()});
 assert.match(content(view.toJSON()),/Current card/);assert.doesNotMatch(content(view.toJSON()),/Stale card/);
 await act(()=>view.unmount());
});


test('transaction filters query the server across pages and invalid dates never read rows',async()=>{
 const view=await mount('/portal/transactions?connection=slash&page=2&keyword=OPENAI&status=declined&from=2026-09-01&to=2026-09-19');
 try{
 await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
 const q=new URL('https://test'+fixture.requests[1].path).searchParams;
 assert.equal(q.get('page'),'2');assert.equal(q.get('keyword'),'OPENAI');assert.equal(q.get('detailedStatus'),'declined');assert.equal(q.get('from'),'2026-09-01T00:00:00Z');assert.equal(q.get('to'),'2026-09-20T00:00:00.000Z');
 await act(async()=>{fixture.requests[1].resolve(page([]));await flush()});
 assert.ok(!content(view.toJSON()).includes('数据范围与更新时间'));
 const clear=view.root.findAllByType('button').find(b=>b.props.children==='清空筛选');
 await act(async()=>{clear.props.onClick();await flush()});
 const cleared=new URL('https://test'+fixture.requests.at(-1).path).searchParams;
 assert.equal(cleared.get('page'),'0');assert.equal(cleared.has('detailedStatus'),false);assert.equal(cleared.has('from'),false);
 }finally{await act(()=>view.unmount())}
 const invalid=await mount('/portal/transactions?connection=slash&from=2026-09-20&to=2026-09-01');
 try{await act(async()=>{fixture.requests[0].resolve(connections);await flush()});assert.equal(fixture.requests.length,1);assert.match(content(invalid.toJSON()),/结束日期不能早于开始日期/);}finally{await act(()=>invalid.unmount())}
});

test('clicking a transaction row opens its drawer without hijacking nested links',async()=>{
 const view=await mount('/portal/transactions?connection=slash&page=1&keyword=OPENAI');
 try{
  await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
  await act(async()=>{fixture.requests[1].resolve(page([{id:'t1',merchant:'OPENAI',cardId:'c1'}]));await flush()});
  const row=view.root.findAll(n=>n.props.tabIndex===0&&n.props['aria-label']==='查看 OPENAI 的详情'&&n.props.onClick)[0];
  const count=fixture.requests.length;
  await act(async()=>{row.props.onClick({target:{closest:()=>({tagName:'A'})}});await flush()});
  assert.equal(fixture.requests.length,count,'card link must not also open a transaction');
  await act(async()=>{row.props.onClick({target:{closest:()=>null}});await flush()});
  assert.equal(fixture.requests.at(-1).path,base+'/slash/transactions/t1');
  const drawer=view.root.findAll(n=>n.props.anchor==='right'&&n.props.PaperProps)[0];
  await act(async()=>{drawer.props.onClose();await flush()});
  const currentRow=view.root.findAll(n=>n.props.tabIndex===0&&n.props['aria-label']==='查看 OPENAI 的详情'&&n.props.onKeyDown)[0];
  const element={};let prevented=false;
  await act(async()=>{currentRow.props.onKeyDown({key:'Enter',target:element,currentTarget:element,preventDefault(){prevented=true}});await flush()});
  assert.equal(prevented,true);assert.equal(fixture.requests.at(-1).path,base+'/slash/transactions/t1');
  assert.ok(view.root.findAll(n=>n.props.to?.includes('page%3D1')&&n.props.to?.includes('keyword%3DOPENAI')).length>0);
 }finally{await act(()=>view.unmount())}
});

test('metrics preserve precision, missing values, coverage and scoped consumption links',async()=>{
 const {cardMetricDisplay}=await import(uri(outputText));
 const metrics={currency:'USD',scale:2,availableMinor:'0',availableAt:'2026-09-19T00:00:00Z',availability:'available',sharedGroup:false,nextResetAt:null,from:'2026-08-20T00:00:00Z',to:'2026-09-19T00:00:00Z',updatedAt:'2026-09-19T00:00:01Z',coverage:'complete',spendingMinor:'9007199254740993',refundMinor:'200',syncState:'idle'};
 assert.equal(cardMetricDisplay(metrics,'available').value,'USD 0.00');
 assert.equal(cardMetricDisplay({...metrics,availableMinor:null,availability:'not_supported'},'available').value,'未提供');
 assert.equal(cardMetricDisplay({...metrics,coverage:'incomplete',spendingMinor:null},'spending').value,'同步未完成');
 assert.equal(cardMetricDisplay(metrics,'spending').value,'USD 90071992547409.93');
 assert.equal(isCardSyncPath(base+'/slash/cards/c1/metrics-sync'),true);
 assert.equal(isCardSnapshotPath(base+'/slash/transactions?metric=spending&cardId=c1&from='+metrics.from+'&to='+metrics.to),true);
 const view=await mount('/portal/cards/c1?connection=slash');
 await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
 await act(async()=>{fixture.requests[1].resolve(page([{id:'c1',cardName:'Card one',metrics}]));await flush()});
 const button=view.root.findAllByType('button').find(b=>b.props.children==='查看消费明细');
 await act(async()=>{button.props.onClick();await flush()});
 const query=new URL('https://test'+fixture.requests.at(-1).path).searchParams;
 assert.equal(query.get('metric'),'spending');assert.equal(query.get('from'),metrics.from);assert.equal(query.get('to'),metrics.to);assert.equal(query.get('cardId'),'c1');
 await act(()=>view.unmount());
});

test('overview card detail returns home, while untrusted return destinations stay rejected',async()=>{
 for(const destination of ['/portal','https://outside.invalid','//outside.invalid']){
 const view=await mount('/portal/cards/c1?connection=slash&back='+encodeURIComponent(destination));
 try{
 const back=view.root.findAllByType('button').find(b=>typeof b.props.children==='string'&&b.props.children.startsWith('返回'));
 assert.ok(back);
 if(destination==='/portal'){assert.equal(back.props.to,'/portal');assert.equal(back.props.children,'返回工作台')}
 else assert.ok(back.props.to.startsWith('/portal/cards?'));
 }finally{await act(()=>view.unmount())}
 }
});

test('card remarks edit inline, retain failed draft and apply only confirmed save',async()=>{
 const view=await mount('/portal/cards');
 try {
  await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
  await act(async()=>{fixture.requests[1].resolve(page([{id:'c1',cardName:'Card one',last4:'1234',remark:'原备注',remarkRevision:1,remarkEditable:true}]));await flush()});
  await act(()=>view.root.findAllByType('button').find(b=>b.props['aria-label']==='编辑尾号 1234 的备注').props.onClick());
  const field=()=>view.root.findAll(n=>n.props.label==='卡片备注'&&n.props.onChange)[0];
  await act(()=>field().props.onChange({target:{value:'广告订阅'}}));
  const save=()=>view.root.findAllByType('button').find(b=>b.props.children==='保存');
  await act(async()=>{save().props.onClick();await flush()});
  const write=fixture.requests.at(-1);assert.equal(write.path,base+'/slash/cards/c1/remark');assert.deepEqual(write.body,{remark:'广告订阅',revision:1});
  await act(async()=>{write.reject(new Error('offline'));await flush()});assert.equal(field().props.value,'广告订阅');assert.match(field().props.helperText,/保存失败/);
  await act(async()=>{save().props.onClick();await flush()});
  await act(async()=>{fixture.requests.at(-1).resolve({remark:'广告订阅',remarkRevision:2,remarkEditable:true});await flush()});
  assert.match(content(view.toJSON()),/广告订阅/);
  await act(()=>view.root.findAllByType('button').find(b=>b.props['aria-label']==='编辑尾号 1234 的备注').props.onClick());
  await act(()=>field().props.onChange({target:{value:'取消的编辑'}}));
  await act(()=>view.root.findAllByType('button').find(b=>b.props.children==='取消').props.onClick());
  assert.doesNotMatch(content(view.toJSON()),/取消的编辑/);
 } finally {await act(()=>view.unmount())}
});
test('remark gateway limits writes to exact client card path and same origin',async()=>{
 const path=base+'/slash/cards/c1/remark',env={SITE_KIND:'client',API_ORIGIN:'https://api.example.invalid'};
 const upstream=async()=>Response.json({data:{remark:'test',remarkRevision:1}});
 const req=(url,method='POST',origin='https://moventra.test')=>new Request('https://moventra.test'+url,{method,headers:{Authorization:'Bearer test',Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({remark:'test',revision:0})}:{})});
 assert.equal((await handle(req(path),env,upstream)).status,200);
 assert.equal((await handle(req(path,'GET'),env,upstream)).status,405);
 assert.equal((await handle(req(path+'?x=1'),env,upstream)).status,405);
 assert.equal((await handle(req(path,'POST','https://evil.test'),env,upstream)).status,403);
 assert.equal((await handle(req(path),{...env,SITE_KIND:'admin'},upstream)).status,404);
});


test('transaction merchant details preserve source values, legacy fallback and missing fields',async()=>{
 for(const [extra,expected,absent] of [
  [{merchant:'FACEBK *ORDER',merchantData:{description:'FACEBK *SOURCE',categoryCode:'0731',location:{city:'650-543-7818',state:'Ca',zip:'94025',country:'Us'}}},['FACEBK *SOURCE','0731','Facebook','650-543-7818, Ca 94025, Us'],[]],
  [{merchant:'Legacy merchant',categoryCode:'7311'},['Legacy merchant','7311','商户位置未提供'],[]],
  [{merchant:'Legacy merchant',categoryCode:'7311',merchantData:{}},['商户未提供','商户位置未提供'],['7311']],
  [{merchantData:{description:'  ',categoryCode:' ',location:{state:' CA ',country:' US '}}},['商户未提供','CA, US'],[]],
 ]){
  const view=await mount('/portal/card-transactions/t1?connection=slash');
  try{
   await act(async()=>{fixture.requests[0].resolve(connections);await flush()});
   await act(async()=>{fixture.requests[1].resolve(page([{id:'t1',cardId:'c1',...extra}]));await flush()});
   const text=content(view.toJSON());
   for(const value of ['商户描述','商户类别代码（MCC）','商户信息',...expected])assert.ok(text.includes(value),value);
   for(const value of absent)assert.ok(!text.includes(value),value);
  }finally{await act(()=>view.unmount())}
 }
});

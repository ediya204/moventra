import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import ts from 'typescript';
import {money,ratio,maximum,percent,safeCsv} from '../../apps/admin/src/operations/model.ts';

const require=createRequire(import.meta.url);
const uri=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const reactURL=pathToFileURL(require.resolve('react')).href;
const moduleURL=name=>pathToFileURL(require.resolve(name)).href;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;

test('overview money keeps every cent beyond Number precision and distinguishes known zero from missing or malformed values',()=>{
 assert.equal(money('9007199254740993123456'),'90,071,992,547,409,931,234.56');
 assert.equal(money('-9007199254740993'),'−90,071,992,547,409.93');
 assert.equal(money('0'),'0.00');assert.equal(money('1'),'0.01');assert.equal(money('-1'),'−0.01');
 for(const value of [undefined,null,'','1.2','1e4','NaN','Infinity','bad'])assert.equal(money(value),'—');
});

test('chart geometry normalizes large minor units without converting labels or unknown days into floating point amounts',()=>{
 const max=9007199254740993123456n;
 assert.equal(ratio(String(max),max),1);assert.equal(ratio(String(max/2n),max),0.5);
 assert.equal(ratio(String(-max/4n),max),0.25);assert.equal(ratio('1',max),0);
 assert.equal(ratio(null,max),0);assert.equal(ratio('0',0n),0);assert.equal(ratio('0',-1n),0);
 const rows=[{incomingMinor:null,outgoingMinor:null},{incomingMinor:'0',outgoingMinor:'100'},{incomingMinor:String(max),outgoingMinor:'9007199254740993'}];
 assert.equal(maximum(rows),max);assert.equal(maximum([]),0n);assert.equal(maximum([{incomingMinor:null,outgoingMinor:null}]),0n);
 assert.equal(money('1'),'0.01');assert.equal(percent(1,3),'33.3%');assert.equal(percent(0,0),'—');
});

test('CSV neutralizes formula prefixes including leading whitespace and preserves quotes, commas and exact integer strings',()=>{
 for(const value of ['=SUM(A1:A2)','+123','-123','@IMPORTDATA(A1)','\t=2+2',' \r\n+2'])assert.equal(safeCsv(value),'"\''+value+'"');
 assert.equal(safeCsv('Acme, "Asia"\nHong Kong'),'"Acme, ""Asia""\nHong Kong"');
 assert.equal(safeCsv('9007199254740993123456'),'"9007199254740993123456"');
 assert.equal(safeCsv(null),'""');assert.equal(safeCsv(0),'"0"');assert.equal(safeCsv('商户'),'"商户"');
});

const network=globalThis.__moventraOverviewTransport={auth:{currentUser:null}};
async function transport(admin){
 const mock=uri(`export const isAdminSite=${admin};export const getFirebaseAuth=()=>globalThis.__moventraOverviewTransport.auth;`);
 const code=transpile('../../packages/shared/src/auth/liveApi.ts').replace(/from ["']([^"']+)["']/g,()=>`from ${JSON.stringify(mock)}`);
 return import(uri(code));
}
test('production overview transport permits only the exact admin read route, retains Bearer isolation and rejects client access before fetch',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const requests=[];network.auth.currentUser={getIdToken:async()=>'fixture-token'};
 globalThis.fetch=async(path,options)=>{requests.push({path,options});return {ok:true,status:200,json:async()=>({data:{mode:'production'}})};};
 const admin=await transport(true);
 for(const days of [7,14,30])assert.deepEqual(await admin.liveGet('/admin-api/v1/ops/overview?days='+days),{mode:'production'});
 for(const path of ['/admin-api/v1/ops/overview','/admin-api/v1/ops/overview?days=31','/admin-api/v1/ops/overview?days=7&customerId=other','/admin-api/v1/ops/overview?days=7&days=14','/local-slash-demo/management/live/overview','https://evil.example/admin-api/v1/ops/overview?days=7','/client-api/v1/customers/00000000-0000-0000-0000-000000000000/transactions'])await assert.rejects(admin.liveGet(path),{code:'invalid_path'});
 assert.equal(requests.length,3);
 assert.deepEqual(requests[0].options,{method:'GET',body:undefined,headers:{Authorization:'Bearer fixture-token',Accept:'application/json'},cache:'no-store',credentials:'omit',redirect:'error'});
 const client=await transport(false);await assert.rejects(client.liveGet('/admin-api/v1/ops/overview?days=7'),{code:'invalid_path'});assert.equal(requests.length,3);
});
test('overview transport rejects a session that changes during token acquisition and exposes safe response errors',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const admin=await transport(true);let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:false,status:403,json:async()=>({error:{code:'scope_required'}})};};
 network.auth.currentUser={getIdToken:async()=>{network.auth.currentUser=null;return 'fixture-token';}};
 await assert.rejects(admin.liveGet('/admin-api/v1/ops/overview?days=7'),{code:'unauthenticated',status:401});assert.equal(calls,0);
 network.auth.currentUser={getIdToken:async()=>'fixture-token'};
 await assert.rejects(admin.liveGet('/admin-api/v1/ops/overview?days=7'),{code:'scope_required',status:403});assert.equal(calls,1);
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({data:null})});
 await assert.rejects(admin.liveGet('/admin-api/v1/ops/overview?days=7'),{code:'invalid_api_response'});
});

// Actual React state/effects and router; only presentation shells, chart rendering
// and transport are replaced, avoiding DOM requirements or source snapshots.
const state=globalThis.__moventraOverviewComponent={requests:[],auth:null};
const request=(source,path,query)=>new Promise((resolve,reject)=>state.requests.push({source,path,query,resolve,reject}));
state.request=request;
const shell=uri(`
 import React from ${JSON.stringify(reactURL)};
 const Pass=({children})=>React.createElement('div',null,children);
 export const DashboardLayout=Pass;export const Box=Pass,Stack=Pass,Card=Pass,CardContent=Pass,Container=Pass,Divider=Pass,Grid=Pass,List=Pass,ListItem=Pass,Table=Pass,TableBody=Pass,TableCell=Pass,TableContainer=Pass,TableHead=Pass,TableRow=Pass;
 export const Typography=({children,variant})=>React.createElement('span',{'data-variant':variant},children);
 export const Button=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);
 export const Select=({children,onChange,value,inputProps})=>React.createElement('select',{onChange,value,...inputProps},children);
 export const MenuItem=({children,value})=>React.createElement('option',{value},children);
 export const Alert=({children,action,severity})=>React.createElement('div',{role:'alert','data-severity':severity},children,action);
 export const Collapse=({in:visible,children})=>visible?React.createElement('div',null,children):null;
 export const Chip=({label})=>React.createElement('span',null,label);
 export const CardHeader=({title,subheader,action})=>React.createElement('header',null,title,subheader,action);
 export const ListItemText=({primary,secondary})=>React.createElement('span',null,primary,secondary);
 export const LinearProgress=props=>React.createElement('progress',{'aria-label':props['aria-label']});
 export const CircularProgress=()=>null,Icon=()=>null;
 export const PageSkeleton=()=>React.createElement('div',{'data-skeleton':true});
 export const useTheme=()=>({typography:{fontFamily:'Public Sans'},palette:{mode:'light',text:{secondary:'#556'},primary:{main:'#183'},warning:{main:'#b80'},error:{main:'#c33'},grey:{500:'#777'},divider:'#ddd'}});
`);
const componentApi=uri(`
 export const liveGet=path=>globalThis.__moventraOverviewComponent.request('production',path);
 export const get=(path,query)=>globalThis.__moventraOverviewComponent.request('local',path,query);
 export const authMessage=()=> '统计服务暂不可用';
 export const useAuth=()=>globalThis.__moventraOverviewComponent.auth;
`);
const chart=uri(`import React from ${JSON.stringify(reactURL)};export default function Chart(props){return React.createElement('chart',props);}`);
let fundsCode=transpile('../../apps/admin/src/operations/FundsOverview.tsx');
fundsCode=fundsCode.replace(/import\(['"]react-apexcharts['"]\)/g,`import(${JSON.stringify(chart)})`).replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?moduleURL(name):name==='./model'?new URL('../../apps/admin/src/operations/model.ts',import.meta.url).href:name.includes('liveApi')||name.includes('management/api')?componentApi:shell)}`);
const {default:FundsOverview}=await import(uri(fundsCode));
const fixture=(days=7,amount='12345')=>({mode:'production',asOf:'2026-09-07T12:00:00Z',revision:'fixture',range:{from:'2026-08-31T16:00:00Z',to:'2026-09-07T12:00:00Z',timezone:'Asia/Hong_Kong',days},coverage:{complete:false,reason:'Fixture incomplete coverage'},currency:'USD',scale:2,timeBasis:'source_date',totals:{incomingMinor:amount,outgoingMinor:'0',netMinor:amount,transactions:1,posted:1,pending:0,failed:0,review:0,activeCards:null,selectedCards:null,customers:null,activeCustomers:null},daily:[{date:'2026-09-07',incomingMinor:amount,outgoingMinor:'0',netMinor:amount,posted:1,pending:0,failed:0,total:1}],statuses:[{status:'succeeded',count:1}],merchants:[],currencies:[{code:'USD',count:1}],availability:{merchants:false,cards:false,customers:false},sync:{lastSuccessAt:null,state:'unverified',mode:'projection'}});
const router=children=>React.createElement(MemoryRouter,{initialEntries:['/workbench?days=7'],future:{v7_startTransition:true,v7_relativeSplatPath:true}},children);
const metricValues=view=>view.root.findAll(node=>node.type==='span'&&node.props['data-variant']==='h4').map(node=>node.children.join(''));
const renderedText=view=>JSON.stringify(view.toJSON());

test('funds overview renders unknown rather than fake zero for empty data, and isolates the local transport',async()=>{
 state.requests=[];let view;
 await act(async()=>{view=Renderer.create(router(React.createElement(FundsOverview,{source:'local'})));});
 assert.deepEqual(metricValues(view),['—','—','—','—']);
 assert.deepEqual({source:state.requests[0].source,path:state.requests[0].path,query:state.requests[0].query},{source:'local',path:'live/overview',query:{days:7}});
 const empty=fixture();empty.mode='real_readonly';empty.totals={...empty.totals,incomingMinor:'0',netMinor:'0',transactions:0,posted:0};empty.daily=[];empty.statuses=[];
 await act(async()=>{state.requests[0].resolve(empty);await flush();});
 assert.deepEqual(metricValues(view),['—','—','—','0']);assert.equal(view.root.findAllByType('chart').length,0);
 assert.match(renderedText(view),/当前不推断真实资金流为零/);
 await act(async()=>view.unmount());
});
test('funds overview period changes clear prior amounts and ignore late data from an obsolete request',async()=>{
 state.requests=[];let view;await act(async()=>{view=Renderer.create(router(React.createElement(FundsOverview)));});
 assert.equal(state.requests[0].path,'/admin-api/v1/ops/overview?days=7');
 await act(async()=>view.root.findByType('select').props.onChange({target:{value:30}}));
 assert.equal(state.requests[1].path,'/admin-api/v1/ops/overview?days=30');assert.deepEqual(metricValues(view),['—','—','—','—']);
 await act(async()=>{state.requests[1].resolve(fixture(30,'9007199254740993'));await flush();});
 assert.equal(metricValues(view)[0],'90,071,992,547,409.93');
 await act(async()=>{state.requests[0].resolve(fixture(7,'100'));await flush();});
 assert.equal(metricValues(view)[0],'90,071,992,547,409.93');
 await act(async()=>view.root.findByType('select').props.onChange({target:{value:14}}));
 assert.deepEqual(metricValues(view),['—','—','—','—']);assert.equal(state.requests[2].path,'/admin-api/v1/ops/overview?days=14');
 await act(async()=>view.unmount());
});
test('funds overview shows authorization/read errors and retry performs a new read without manufacturing amounts',async()=>{
 state.requests=[];let view;await act(async()=>{view=Renderer.create(router(React.createElement(FundsOverview)));});
 await act(async()=>{state.requests[0].reject({code:'scope_required'});await flush();});
 assert.match(renderedText(view),/当前账号没有交易统计范围/);assert.deepEqual(metricValues(view),['—','—','—','—']);
 const retry=view.root.findAllByType('button').find(button=>button.children.join('')==='重试');
 await act(async()=>retry.props.onClick());assert.equal(state.requests.length,2);
 await act(async()=>{state.requests[1].reject({code:'temporarily_unavailable'});await flush();});
 assert.match(renderedText(view),/统计服务暂不可用/);assert.deepEqual(metricValues(view),['—','—','—','—']);
 await act(async()=>view.unmount());
});

const authorizedWidget=uri(`import React from ${JSON.stringify(reactURL)};export default function Overview(){return React.createElement('div',{'data-overview':true});}`);
let pageCode=transpile('../../apps/admin/src/operations/OperationsPage.tsx');
pageCode=pageCode.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?moduleURL(name):name.includes('AuthContext')?componentApi:name==='./FundsOverview'?authorizedWidget:shell)}`);
const {default:OperationsPage}=await import(uri(pageCode));
test('formal operations page requires an authenticated operator with verified MFA before mounting the data view',async()=>{
 for(const scenario of [
  {auth:{ready:false,authenticated:false,user:null,session:null},expected:'loading'},
  {auth:{ready:true,authenticated:false,user:null,session:null},expected:'login'},
  {auth:{ready:true,authenticated:true,user:{},session:{operator:false,mfaVerified:true}},expected:'security'},
  {auth:{ready:true,authenticated:true,user:{},session:{operator:true,mfaVerified:false}},expected:'security'},
  {auth:{ready:true,authenticated:true,user:{},session:{operator:true,mfaVerified:true}},expected:'overview'},
 ]){
  state.auth={...scenario.auth,signOut(){}};let view;
  await act(async()=>{view=Renderer.create(router(React.createElement(Routes,null,
   React.createElement(Route,{path:'/workbench',element:React.createElement(OperationsPage)}),
   React.createElement(Route,{path:'/admin/login',element:React.createElement('div',{'data-route':'login'})}),
   React.createElement(Route,{path:'/session',element:React.createElement('div',{'data-route':'security'})}))));});
  assert.equal(view.root.findAll(node=>node.type==='div'&&node.props['data-overview']===true).length,scenario.expected==='overview'?1:0);
  if(scenario.expected==='loading')assert.equal(view.root.findAll(node=>node.type==='div'&&node.props['data-skeleton']===true).length,1);
  else if(scenario.expected!=='overview')assert.equal(view.root.findByProps({'data-route':scenario.expected}).props['data-route'],scenario.expected);
  await act(async()=>view.unmount());
 }
});

test('channel transport allows existing read queries and rejects foreign destinations, writes and client usage',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const requests=[];network.auth.currentUser={getIdToken:async()=>'fixture-token'};
 globalThis.fetch=async(path,options)=>{requests.push({path,options});return {ok:true,status:200,json:async()=>({data:[]})};};
 const admin=await transport(true),base='/admin-api/v1/channel-projections';
 for(const path of [base,base+'/slash-live/transactions?revision=1&keyword=Google&page=0',base+'/slash-live/transactions/tx_1',base+'/slash-live/cards/card_1',base+'/slash-live/cards?keyword=test&cardStatus=active&page=1',base+'/slash-live/transactions?cardId=card_1'])await admin.liveGet(path);
 for(const path of [base+'/slash-live/cards?from=bad',base+'/slash-live/payout',base+'/../users',base+'/slash-live/transactions?target=evil',base+'/slash-live/transactions?page=0&page=1','https://evil.example'+base,base+'/slash-live/cards/card_1#fragment'])await assert.rejects(admin.liveGet(path),{code:'invalid_path'});
 const client=await transport(false);await assert.rejects(client.liveGet(base),{code:'invalid_path'});
 assert.equal(requests.length,6);assert.ok(requests.every(r=>r.options.method==='GET'&&r.options.credentials==='omit'&&r.options.redirect==='error'));
});

test('registered directory transport rejects cross-site, extra paths and writes',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 let calls=0;network.auth.currentUser={getIdToken:async()=>'fixture-token'};
 globalThis.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>({data:[],meta:{hasMore:false}})}};
 const admin=await transport(true),client=await transport(false);
 await admin.liveGetPage('/admin-api/v1/users?email=registered%40example.com&limit=20&offset=0');assert.equal(calls,1);
 await admin.liveGetPage('/admin-api/v1/users?userId=11111111-1111-1111-1111-111111111111&limit=1');assert.equal(calls,2);
 for(const path of ['/admin-api/v1/users?userId=x&userId=y','/admin-api/v1/users/other','/admin-api/v1/users?role=admin','/admin-api/v1/users?email=x&email=y','/admin-api/v1/users#x','https://evil.invalid/admin-api/v1/users'])await assert.rejects(admin.liveGet(path),{code:'invalid_path'});
 await assert.rejects(client.liveGet('/admin-api/v1/users?userId=11111111-1111-1111-1111-111111111111'),{code:'invalid_path'});
 await assert.rejects(admin.updateOnboarding('/admin-api/v1/users',{action:'x',revision:0,reason:'x'}),{code:'invalid_path'});assert.equal(calls,2);
});

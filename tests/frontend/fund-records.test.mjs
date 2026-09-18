import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import {fundRecordsRoute as edge} from '../../deploy/cloudflare/fund-records.mjs';
import {handle} from '../../deploy/cloudflare/gateway.mjs';
const require=createRequire(import.meta.url),resolve=n=>pathToFileURL(require.resolve(n)).href;
const uri=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll('"react/jsx-runtime"',JSON.stringify(resolve('react/jsx-runtime')))).toString('base64');
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const contract=uri(source('../../packages/shared/src/auth/fundRecordsContract.ts')),money=uri(source('../../packages/shared/src/auth/cryptoContract.ts'));
const {fundRecordsRoute}=await import(contract),id='crypto_20000000-0000-0000-0000-000000000001_principal',base='/client-api/v1/fund-records';
test('fund records GET contract and gateway agree and deny cross-role/write/unlisted requests',async()=>{
 for(const path of [base,base+'?kind=opening_fee&currency=USD&page=2',base+'/'+id,base+'/'+id+'?q=x',base+'?q=x&q=y',base+'?secret=1',base+'/invalid','/admin-api/v1/fund-records'])for(const m of ['GET','POST','DELETE'])assert.equal(fundRecordsRoute(m,path),edge(m,path));
 let calls=0;const headers={Authorization:'Bearer synthetic'};const ok=await handle(new Request('https://client.invalid'+base,{headers}),{SITE_KIND:'client',API_ORIGIN:'https://api.invalid'},async()=>{calls++;return Response.json({data:{records:[],total:0}})});assert.equal(ok.status,200);assert.equal(ok.headers.get('Cache-Control'),'no-store');assert.equal(calls,1);
 for(const [path,method] of [['/admin-api/v1/fund-records','GET'],[base,'POST'],[base+'?q=a&q=b','GET'],[base+'/invalid','GET']]){const r=await handle(new Request('https://client.invalid'+path,{method,headers}),{SITE_KIND:'client'},()=>assert.fail('unexpected upstream'));assert.equal(r.status,404)}
});
const fixture=globalThis.__fundRecordFixture={requests:[]};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};const Pass=({children,...props})=>React.createElement('div',props,children);export const Stack=Pass,Box=Pass,Paper=Pass,TableContainer=Pass;export const Typography=Pass,Alert=({children,action,...p})=>React.createElement('div',p,children,action),LinearProgress=Pass;export const Button=({children,...p})=>React.createElement('button',p,children),Chip=({label})=>React.createElement('span',null,label);export const Table=({children,...p})=>React.createElement('table',p,children),TableHead=({children})=>React.createElement('thead',null,children),TableBody=({children})=>React.createElement('tbody',null,children),TableRow=({children,...p})=>React.createElement('tr',p,children),TableCell=({children})=>React.createElement('td',null,children);export const TextField=({children,...p})=>React.createElement('input',p),MenuItem=Pass;`);
const api=uri(`export const fundRecordsGet=(path,signal)=>new Promise((resolve,reject)=>globalThis.__fundRecordFixture.requests.push({path,signal,resolve,reject}));`);
const errors=uri(`export class SessionError extends Error {constructor(code,status){super(code);this.code=code;this.status=status}}`);
const code=source('../../packages/shared/src/finance/FundRecords.tsx').replace(/from ['"]([^'"]+)['"]/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:n.endsWith('/fundRecordsApi')?api:n.endsWith('/fundRecordsContract')?contract:n.endsWith('/cryptoContract')?money:n.endsWith('/liveApi')?errors:resolve(n)));
const {default:Records}=await import(uri(code));
const flush=()=>new Promise(r=>setImmediate(r)),text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):'';
const button=(t,label)=>t.root.findAllByType('button').find(n=>text(n.props.children)===label);
const row={id,source:'crypto',orderId:'20000000-0000-0000-0000-000000000001',customerId:'10000000-0000-0000-0000-000000000001',createdAt:'2026-09-19T00:00:00Z',updatedAt:'2026-09-19T00:00:00Z',kind:'otc',direction:'exchange',currency:'USDT',amountMinor:'1239999',toCurrency:'USD',receiveMinor:'123',status:'processing',postingStatus:'pending',sourceState:'processing'};
const result={records:[row],total:21,pageSize:20,mode:'live',coverage:'已保存的业务记录'};
async function mount(path,props={}){fixture.requests=[];let t;await act(async()=>{t=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Records,props)));await flush()});return t}
async function finish(value=result,i=0){await act(async()=>{fixture.requests[i].resolve(value);await flush()})}
test('filters submit to server, reset page and preserve query in details; OTC amounts stay separate',async()=>{
 const t=await mount('/portal/fund-records?page=2&kind=otc');assert.equal(fixture.requests[0].path,base+'?page=2&kind=otc');await finish();assert.match(text(t.toJSON()),/支付 1.23 USDT/);assert.match(text(t.toJSON()),/收到 1.23 USD/);
 assert.equal(button(t,'详情').props.to,'/portal/fund-records/'+id+'?page=2&kind=otc');
 await act(async()=>{t.root.findAllByType('input').find(x=>x.props.label==='业务类型').props.onChange({target:{value:'opening_fee'}})});
 await act(async()=>{t.root.findAllByType('div').find(x=>x.props.component==='form').props.onSubmit({preventDefault(){}});await flush()});assert.equal(fixture.requests[1].path,base+'?kind=opening_fee');await act(()=>t.unmount());
});
test('deep link fetches its own authorized detail and retains list return filters',async()=>{
 const t=await mount('/portal/fund-records/'+id+'?kind=otc&page=1',{recordId:id});assert.equal(fixture.requests[0].path,base+'/'+id);await finish({...result,record:row,evidence:[]});assert.match(text(t.toJSON()),/待入账/);assert.equal(button(t,'返回资金记录').props.to,'/portal/fund-records?kind=otc&page=1');assert.match(text(t.toJSON()),/没有可展示的资金处理明细/);await act(()=>t.unmount());
});
test('errors cannot masquerade as empty; retry and stale response protection work',async()=>{
 const t=await mount('/portal/fund-records');await act(async()=>{fixture.requests[0].reject(new Error('offline'));await flush()});assert.match(text(t.toJSON()),/读取资金记录失败/);assert.doesNotMatch(text(t.toJSON()),/暂无资金记录/);
 await act(async()=>{button(t,'重试').props.onClick();await flush()});await finish({...result,records:[],total:0},1);assert.match(text(t.toJSON()),/暂无资金记录/);await act(()=>t.unmount());
 const u=await mount('/portal/fund-records?kind=otc');await act(async()=>{button(u,'重置').props.onClick();await flush()});assert.equal(fixture.requests[0].signal.aborted,true);await finish(result,0);assert.doesNotMatch(text(u.toJSON()),/支付 1.23/);await finish({...result,records:[],total:0},1);assert.match(text(u.toJSON()),/暂无资金记录/);await act(()=>u.unmount());
});
test('admin includes customer filter; missing amount is not rendered as zero',async()=>{
 const t=await mount('/finance/fund-records?customerId='+row.customerId,{admin:true});assert.ok(t.root.findAllByType('input').find(x=>x.props.label==='客户 ID'));assert.match(fixture.requests[0].path,/^\/admin-api/);await finish({...result,records:[{...row,amountMinor:null,customerName:'Fixture'}]});assert.match(text(t.toJSON()),/金额待核实/);assert.match(text(t.toJSON()),/Fixture/);await act(()=>t.unmount());
});
test('both production navigation routes are connected',()=>{
 for(const [file,pattern] of [['../../apps/admin/src/App.tsx',/path="\/finance\/fund-records\/:recordId"/],['../../apps/admin/src/admin/navigation.ts',/"资金记录", "\/finance\/fund-records"/],['../../apps/client/src/portal/workspaceNavigation.ts',/"fund-records", "资金记录"/],['../../apps/client/src/portal/ClientHome.tsx',/<FundRecords/]])assert.match(source(file),pattern);
});

test('all documented fund record routes match both read allowlists',()=>{
 const spec=JSON.parse(source('../../services/api/docs/openapi.json'));
 const paths=Object.keys(spec.paths).filter(p=>p.includes('/fund-records'));
 assert.equal(paths.length,4);
 for(const path of paths){const concrete=path.replace('{recordId}',id);assert.ok(edge('GET',concrete));assert.ok(fundRecordsRoute('GET',concrete));assert.equal(edge('POST',concrete),false)}
});

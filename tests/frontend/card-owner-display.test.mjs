import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import ts from 'typescript';
const require=createRequire(import.meta.url),uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const fixture=globalThis.__ownerDisplay={requests:[]};
const mocks=uri(`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
const Pass=({children})=>React.createElement('div',null,children);
export const Alert=Pass,Box=Pass,MenuItem=Pass,Paper=Pass,Stack=Pass,Typography=Pass,DashboardLayout=Pass;
export const Button=({children,onClick,disabled,to})=>React.createElement('button',{onClick,disabled,'data-to':to},children);
export const TextField=()=>null,PageSkeleton=()=>React.createElement('span',null,'loading'),MerchantCell=()=>null,LogoAttribution=()=>null,TransactionStatusChip=()=>null;
export const useAuth=()=>({ready:true,authenticated:true,user:{uid:'staff'},session:{operator:true,mfaVerified:true}});
export const liveGet=path=>new Promise((resolve,reject)=>globalThis.__ownerDisplay.requests.push({path,resolve,reject}));
export const zhCN={components:{MuiDataGrid:{defaultProps:{localeText:{}}}}};
export const DataGrid=({rows,columns})=>React.createElement('div',null,rows.map(row=>React.createElement('section',{key:row.id},columns.map(c=>React.createElement('span',{key:c.field},c.renderCell?c.renderCell({row}):c.valueFormatter?c.valueFormatter(row[c.field]):row[c.field])))));
export const transactionRowClass=()=>'',transactionRowStyles={},utcTime=v=>v,minorText=v=>v,originalText=v=>v,slashTransactionFilters=[];
export default ()=>null;
`);
function compile(file){let {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});outputText=outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:name.includes('channelOwnership')?new URL('../../apps/admin/src/components/channelOwnership.ts',import.meta.url).href:mocks)}`);return uri(outputText)}
const {default:Cards}=await import(compile('../../apps/admin/src/operations/CardsPage.tsx'));
const {default:Detail}=await import(compile('../../apps/admin/src/operations/ChannelTransactionsPage.tsx'));
const {channelOwnerLabel:label}=await import(new URL('../../apps/admin/src/components/channelOwnership.ts',import.meta.url));
const flush=()=>new Promise(r=>setImmediate(r));
const content=node=>node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(content).join(''):content(node.children);
const connection={id:'scope',label:'Source',revision:'r1',sourceAt:'2026-09-18T00:00:00Z'};
const assigned={id:'c1',cardName:'Random Card Name',assignmentKind:'project_wallet',internal:{ownershipStatus:'bound',customerId:'customer-a',userId:'user-a',customerName:'Alice'}};
const page=rows=>({rows,total:rows.length,revision:'r1',sourceAt:connection.sourceAt,importedAt:connection.sourceAt,coverageReason:'Synthetic fixture'});
async function mount(path){fixture.requests=[];let view;await act(async()=>{view=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Routes,null,React.createElement(Route,{path:'/cards',element:React.createElement(Cards)}),React.createElement(Route,{path:'/cards/:id',element:React.createElement(Detail)}))));await flush()});return view}
async function respondPending(path,value){await act(async()=>{for(const r of fixture.requests.filter(r=>!r.done&&(path==='/admin-api/v1/channel-projections'?r.path===path:r.path.includes(path)))){r.done=true;r.resolve(value)}await flush()})}
test('ownership labels distinguish no assignment, unknown lookup, range mismatch and old server',()=>{
 assert.equal(label(assigned),'Alice');assert.equal(label({internal:{ownershipStatus:'bound',customerId:'a'}}),'a');
 assert.equal(label({internal:{ownershipStatus:'unassigned'}}),'未绑定');assert.equal(label({}),'归属未查询');
 assert.equal(label({assignmentKind:'project_wallet'}),'已分配（项目钱包）');
 assert.equal(label({internal:{ownershipStatus:'scope_mismatch',customerName:'must not leak'}}),'归属范围待核实');
});
test('real card list and deep-linked detail render the same stored owner and recover refresh failures',async()=>{
 for(const path of ['/cards?connection=scope','/cards/c1?connection=scope']){
  const view=await mount(path);
  await respondPending('/admin-api/v1/channel-projections', [connection]);
  await respondPending('/scope/cards',page([assigned]));
  assert.match(content(view.toJSON()),/Alice/);assert.doesNotMatch(content(view.toJSON()),/未绑定|已分配（项目钱包）/);
  const refresh=view.root.findAllByType('button').find(b=>b.props.children==='刷新已导入数据');
  await act(async()=>{refresh.props.onClick();await flush()});
  await respondPending('/admin-api/v1/channel-projections',[connection]);
  await act(async()=>{for(const r of fixture.requests.filter(r=>!r.done&&r.path.includes('/scope/cards'))){r.done=true;r.reject(new Error('offline'))}await flush()});
  assert.match(content(view.toJSON()),/读取失败/);assert.doesNotMatch(content(view.toJSON()),/Alice|未绑定/);
  const retry=view.root.findAllByType('button').find(b=>b.props.children==='刷新已导入数据');
  await act(async()=>{retry.props.onClick();await flush()});
  await respondPending('/admin-api/v1/channel-projections',[connection]);
  await respondPending('/scope/cards',page([{...assigned,internal:{...assigned.internal,customerName:'Alice updated'}}]));
  assert.match(content(view.toJSON()),/Alice updated/);await act(()=>view.unmount());
 }
});

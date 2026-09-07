import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter,useLocation} from 'react-router-dom';
import ts from 'typescript';
import {transactionDateRange} from '../../apps/admin/src/slash/transactionDateRange.ts';
const now=Date.parse('2026-03-01T01:00:00Z');
test('UTC presets include today and calendar custom dates include the entire selected end day',()=>{
 const result=transactionDateRange(new URLSearchParams('range=7'),now);
 assert.equal(result.from,'2026-02-23T00:00:00.000Z');assert.equal(result.to,'2026-03-02T00:00:00.000Z');assert.equal(result.error,'');
 for(const days of [7,14,30]){const r=transactionDateRange(new URLSearchParams('range='+days),now);assert.equal((Date.parse(r.to)-Date.parse(r.from))/86400000,days);}
 const custom=transactionDateRange(new URLSearchParams('range=custom&fromDate=2024-02-29&toDate=2024-02-29'),now);
 assert.equal(custom.from,'2024-02-29T00:00:00.000Z');assert.equal(custom.to,'2024-03-01T00:00:00.000Z');assert.equal(custom.error,'');
 assert.equal(transactionDateRange(new URLSearchParams(),now).mode,'30');
});
test('invalid, reversed, missing, oversized and future calendar ranges return no request bounds',()=>{
 for(const query of ['range=100','range=custom','range=custom&fromDate=2026-02-30&toDate=2026-03-01','range=custom&fromDate=2026-03-01&toDate=2026-02-28','range=custom&fromDate=2026-01-01&toDate=2026-03-01','range=custom&fromDate=2026-03-01&toDate=2026-03-02']){
  const result=transactionDateRange(new URLSearchParams(query),now);assert.ok(result.error,query);assert.equal(result.from,'');assert.equal(result.to,'');
 }
});

const require=createRequire(import.meta.url),uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const state=globalThis.__moventraDateFilter={requests:[],url:''};
const mock=uri(`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
 const Pass=({children})=>React.createElement('div',null,children);
 export const Alert=Pass,Box=Pass,Grid=Pass,Paper=Pass,Stack=Pass,Tab=Pass,Tabs=Pass,Typography=Pass,Dialog=Pass,DialogContent=Pass,DialogTitle=Pass,ManagementAccess=Pass;
 export const Button=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);
 export const TextField=({label,value,onChange,onKeyDown,select,children,error})=>React.createElement(select?'select':'input',{'aria-label':label,value,onChange,onKeyDown,'aria-invalid':!!error},select?children:undefined);
 export const MenuItem=({children,value})=>React.createElement('option',{value},children);
 export const Chip=({label})=>React.createElement('span',null,label);
 export const DataGrid=props=>React.createElement('grid',props);
 export const GridToolbarColumnsButton=()=>null,LinearProgress=()=>null,PageHeader=()=>null,TransactionStatusChip=()=>null,MerchantCell=()=>null,LogoAttribution=()=>null,CardOwnerEditor=()=>null;
 export const transactionRowStyles={};export const zhCN={components:{MuiDataGrid:{defaultProps:{localeText:{}}}}};
 export const get=async(path,query)=>{const s=globalThis.__moventraDateFilter;s.requests.push({path,query});if(path==='live/transactions'&&s.hold)return new Promise(resolve=>{s.resolve=resolve;});return path==='live/status'?{configured:false}:{rows:[],total:100,page:query.page,pageSize:20,revision:1,summary:{incomingMinor:'0',outgoingMinor:'0',netMinor:'0',statusReview:0}};};
 export const post=()=>Promise.reject(Error('Not used'));export default function Drawer(){return null;}
`);
let {outputText}=ts.transpileModule(readFileSync(new URL('../../apps/admin/src/slash/LiveSlashPage.tsx',import.meta.url),'utf8'),{fileName:'LiveSlashPage.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
outputText=outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:name.includes('cardTransactionFields')?new URL('../../apps/admin/src/components/cardTransactionFields.ts',import.meta.url).href:name==='./transactionDateRange'?new URL('../../apps/admin/src/slash/transactionDateRange.ts',import.meta.url).href:mock)}`);
const {default:LiveSlashPage}=await import(uri(outputText));
function Probe(){state.url=useLocation().search;return null;}
const mount=async(url)=>{let view;await act(async()=>{view=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[url],future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(React.Fragment,null,React.createElement(Probe),React.createElement(LiveSlashPage,{kind:'transactions',fallback:null}))));});return view;};
const transactions=()=>state.requests.filter(r=>r.path==='live/transactions');
const field=(view,label)=>view.root.find(node=>['input','select'].includes(node.type)&&node.props['aria-label']===label);
test('date selection resets pagination, preserves card/search/status, and invalid custom input blocks transaction reads',async()=>{
 state.requests=[];const view=await mount('/transactions?source=slash&cardId=fixture-card&keyword=Meta&status=posted&detailedStatus=settled&page=4');
 try{
  assert.equal(transactions().at(-1).query.page,4);
  await act(async()=>field(view,'时间范围（UTC）').props.onChange({target:{value:'7'}}));
  let query=transactions().at(-1).query;
  assert.equal(query.page,0);assert.equal(query.cardId,'fixture-card');assert.equal(query.keyword,'Meta');assert.equal(query.status,'posted');assert.equal(query.detailedStatus,'settled');assert.equal(query.cardOnly,'true');
  assert.equal((Date.parse(query.to)-Date.parse(query.from))/86400000,7);
  state.hold=true;await act(async()=>view.root.findByType('grid').props.onPaginationModelChange({page:2}));
  assert.equal(transactions().at(-1).query.page,2);assert.equal(transactions().at(-1).query.from,query.from);
  assert.equal(view.root.findByType('grid').props.rowCount,100);assert.equal(view.root.findByType('grid').props.loading,true);
  state.hold=false;await act(async()=>state.resolve({rows:[],total:100,page:2,pageSize:20,revision:1}));
  await act(async()=>field(view,'时间范围（UTC）').props.onChange({target:{value:'custom'}}));
  const start=field(view,'开始日期（UTC）').props.value,count=transactions().length;
  await act(async()=>field(view,'开始日期（UTC）').props.onChange({target:{value:''}}));
  assert.equal(transactions().length,count);assert.equal(view.root.findByType('grid').props.rows.length,0);assert.equal(field(view,'开始日期（UTC）').props['aria-invalid'],true);
  assert.equal(view.root.findAllByType('button').find(b=>b.children.join('')==='查询').props.disabled,true);
  await act(async()=>field(view,'开始日期（UTC）').props.onChange({target:{value:start}}));
  query=transactions().at(-1).query;assert.equal(query.page,0);assert.equal(query.cardId,'fixture-card');assert.equal(new URLSearchParams(state.url).get('range'),'custom');
 }finally{state.hold=false;await act(async()=>view.unmount());}
});
test('invalid custom range from a shared URL never requests transaction data',async()=>{
 state.requests=[];const view=await mount('/transactions?range=custom&fromDate=2026-09-06&toDate=2026-09-01&cardId=fixture-card');
 try{assert.equal(transactions().length,0);assert.equal(field(view,'开始日期（UTC）').props['aria-invalid'],true);assert.match(JSON.stringify(view.toJSON()),/开始日期不能晚于结束日期/);}finally{await act(async()=>view.unmount());}
});

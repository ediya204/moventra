import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const state=globalThis.__restoredDirectories={calls:[],grid:null,auth:{ready:true,authenticated:true,user:{uid:'fixture'},session:{operator:true,mfaVerified:true,staffScopes:[{customerId:'11111111-1111-1111-1111-111111111111',name:'Customer A',permission:'accounts:read'}]}}};
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const mocks=uri(`
import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
const s=globalThis.__restoredDirectories;
const Pass=({children,component:C='div',...props})=>React.createElement(C,props,children);
export const Alert=Pass,Button=Pass,MenuItem=Pass,Paper=Pass,Stack=Pass,TextField=Pass,Typography=Pass,DashboardLayout=Pass;
export const PageSkeleton=()=>null,utcTime=String,authMessage=e=>e.code||'error';
export const zhCN={components:{MuiDataGrid:{defaultProps:{localeText:{}}}}};
export const useAuth=()=>s.auth;
export const DataGrid=props=>{s.grid=props;return null};
export const liveGet=async path=>{s.calls.push(path);if(path==='/admin-api/v1/channel-projections')return [{id:'connection_a',label:'Slash 1',revision:'v1',sourceAt:'2026-09-07T00:00:00Z'}];const q=new URLSearchParams(path.split('?')[1]);return {rows:[{id:q.get('page')==='1'?'card_21':'card_01',cardName:'Saved Card',last4:'0012'}],total:25,sourceAt:'',importedAt:'',coverageReason:'fixture'};};
export const liveGetPage=async path=>{s.calls.push(path);return {data:[{id:'account_fixture',name:'Account A',status:'active'}],meta:{hasMore:!path.includes('offset=20'),offset:0,limit:20}};};
`);
async function component(name){let {outputText}=ts.transpileModule(readFileSync(new URL(`../../apps/admin/src/operations/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});outputText=outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:mocks)}`);return (await import(uri(outputText))).default;}
const Cards=await component('CardsPage'),Customers=await component('CustomerDirectoryPage');
const flush=()=>new Promise(r=>setImmediate(r));
function Location(){state.location=useLocation();return null;}
async function mount(Page,path){state.calls=[];let view;await act(async()=>{view=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Location),React.createElement(Routes,null,React.createElement(Route,{path:'*',element:React.createElement(Page)}))));await flush()});return view;}
test('cards paginate on server and detail link preserves connection and list context',async()=>{
 const view=await mount(Cards,'/cards?connection=connection_a&keyword=Saved&status=active');
 assert.ok(state.calls.some(p=>p.includes('/cards?')&&p.includes('keyword=Saved')&&p.includes('cardStatus=active')));
 await act(async()=>{state.grid.onPaginationModelChange({page:1,pageSize:20});await flush()});
 assert.equal(state.grid.rows[0].id,'card_21');assert.equal(new URLSearchParams(state.location.search).get('page'),'1');
 const link=state.grid.columns.find(c=>c.field==='actions').renderCell({row:state.grid.rows[0]});
 assert.match(link.props.to,/^\/cards\/card_21\?/);const q=new URLSearchParams(link.props.to.split('?')[1]);assert.equal(q.get('connection'),'connection_a');assert.equal(q.get('cardsPage'),'1');assert.equal(q.get('cardsKeyword'),'Saved');
 await act(async()=>view.unmount());
});
test('account directory uses server hasMore and preserves customer scope across pages',async()=>{
 const view=await mount(Customers,'/customers');
 assert.ok(state.calls[0].endsWith('/accounts?limit=20&offset=0'));
 const next=view.root.findAll(n=>n.props.children==='下一页'&&n.props.onClick)[0];
 await act(async()=>{next.props.onClick();await flush()});
 assert.ok(state.calls.some(p=>p.endsWith('/accounts?limit=20&offset=20')));
 assert.equal(view.root.findAll(n=>n.props.children==='下一页'&&n.props.onClick)[0].props.disabled,true);
 await act(async()=>view.unmount());
});
test('unscoped customer URL does not request another customer data',async()=>{
 const view=await mount(Customers,'/customers?customer=22222222-2222-2222-2222-222222222222');
 assert.equal(state.calls.length,0);assert.ok(view.root.findAll(n=>typeof n.props.children==='string'&&n.props.children.includes('不在账户读取授权范围')).length>0);
 await act(async()=>view.unmount());
});

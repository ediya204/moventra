import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const reactURL=pathToFileURL(require.resolve('react')).href;
const fixture=globalThis.__cardNavigation={calls:[],location:null};
const mocks=uri(`
import React from ${JSON.stringify(reactURL)};
const m=globalThis.__cardNavigation;
const Pass=({children})=>React.createElement('div',null,children);
export const DashboardLayout=Pass;export const Alert=Pass,Box=Pass,Container=Pass,MenuItem=Pass,Paper=Pass,Stack=Pass,TextField=Pass,Typography=Pass;
export const Button=({component:Component='button',children,...props})=>React.createElement(Component,props,children);
export const PageSkeleton=()=>null,MerchantCell=Pass,LogoAttribution=()=>null,BrandLogo=()=>null,TransactionStatusChip=()=>null;
export const zhCN={components:{MuiDataGrid:{defaultProps:{localeText:{}}}}};
export const minorText=String,originalText=String,utcTime=String,slashTransactionFilters=[],transactionRowClass=()=>'',transactionRowStyles={};
export const useAuth=()=>({ready:true,authenticated:true,user:{uid:'fixture'},session:{operator:true,mfaVerified:true},signOut:()=>{throw Error('unexpected sign out')}});
export const liveGet=async path=>{m.calls.push(path);if(path==='/admin-api/v1/channel-projections')return [{id:'conn_fixture',label:'Fixture',revision:'v1',sourceAt:''}];if(path.includes('/cards/'))return {rows:[{id:'card_fixture',cardName:'Fixture Card',last4:'0012'}]};return {rows:[{id:'tx_fixture',cardId:'card_fixture',cardName:'Fixture Card',cardLast4:'0012',merchant:'Fixture Merchant'}],total:1};};
export const DataGrid=props=>{m.grid=props;return null};
export default function Drawer(props){m.drawer=props;return null;}
`);
let {outputText}=ts.transpileModule(readFileSync(new URL('../../apps/admin/src/operations/ChannelTransactionsPage.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
outputText=outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:mocks)}`);
const {default:Page}=await import(uri(outputText));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function Location(){fixture.location=useLocation();return null;}
async function mount(){
 fixture.calls=[];
 let view;
 await act(async()=>{
  view=Renderer.create(React.createElement(MemoryRouter,{initialEntries:['/transactions?connection=conn_fixture']},React.createElement(Location),React.createElement(Routes,null,
   React.createElement(Route,{path:'/transactions',element:React.createElement(Page)}),
   React.createElement(Route,{path:'/cards/:id',element:React.createElement(Page)}))));
  await flush();
 });
 return view;
}
test('transaction drawer opens the associated card with router navigation and retains its connection',async()=>{
 const view=await mount();
 const row=fixture.grid.rows[0];
 const action=fixture.grid.columns.find(c=>c.field==='actions').renderCell({row});
 await act(async()=>{action.props.onClick();await flush();});
 assert.equal(fixture.drawer.open,true);
 // In Node there is no window: a document navigation regresses this test.
 await act(async()=>{fixture.drawer.onCard('card_fixture');await flush();});
 assert.equal(fixture.location.pathname,'/cards/card_fixture');
 assert.equal(new URLSearchParams(fixture.location.search).get('connection'),'conn_fixture');
 assert.equal(fixture.drawer.open,false);
 assert.ok(fixture.calls.includes('/admin-api/v1/channel-projections/conn_fixture/cards/card_fixture'));
 assert.match(JSON.stringify(view.toJSON()),/Fixture Card/);
 await act(async()=>view.unmount());
});
test('transaction list exposes the connection-scoped card detail router link',async()=>{
 const view=await mount();
 const cell=fixture.grid.columns.find(c=>c.field==='cardLast4').renderCell({row:fixture.grid.rows[0]});
 let link;
 await act(async()=>{link=Renderer.create(React.createElement(MemoryRouter,null,cell));});
 assert.equal(link.root.findByType('a').props.href,'/cards/card_fixture?connection=conn_fixture');
 await act(async()=>{link.unmount();view.unmount();});
});

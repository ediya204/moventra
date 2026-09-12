import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const resolve=s=>pathToFileURL(require.resolve(s)).href;
const source=p=>ts.transpileModule(readFileSync(new URL(p,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const state=globalThis.__clientWorkspaceFixture={requests:[],auth:null};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};
const Pass=({children,...props})=>React.createElement('div',props,children);
export const Alert=Pass,Avatar=Pass,Box=Pass,Container=Pass,Drawer=({open,children})=>open?React.createElement('div',null,children):null,Chip=({label})=>React.createElement('span',null,label),IconButton=Pass,List=Pass,ListItemIcon=Pass,Paper=Pass,Stack=Pass,Table=Pass,TableBody=Pass,TableCell=Pass,TableContainer=Pass,TableHead=Pass,TableRow=Pass,Typography=Pass;
export const Button=({children,...props})=>React.createElement('button',props,children);
export const ListItemButton=({children,...props})=>React.createElement('a',props,children);
export const ListItemText=({primary})=>React.createElement('span',null,primary);`);
const auth=uri('export const useAuth=()=>globalThis.__clientWorkspaceFixture.auth;');
const api=uri(`export const authMessage=()=> '读取失败';export const liveGet=path=>new Promise((resolve,reject)=>globalThis.__clientWorkspaceFixture.requests.push({path,resolve,reject}));`);
const icon=uri('export const Icon=()=>null;');
const brand=uri('export const BrandLogo=()=>null;');
const session=uri(`import React from ${JSON.stringify(resolve('react'))};export default ()=>React.createElement('span',null,'身份校验中');`);
const navigation=uri(source('../../apps/client/src/portal/workspaceNavigation.ts'));
const compiled=source('../../apps/client/src/portal/ClientHome.tsx').replace(/from ["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(name==='@mui/material'?shell:name==='@iconify/react'?icon:name.endsWith('/AuthContext')?auth:name.endsWith('/liveApi')?api:name.endsWith('/SessionPage')?session:name.endsWith('/BrandLogo')?brand:name==='./workspaceNavigation'?navigation:resolve(name)));
const ClientHome=(await import(uri(compiled))).default;
const flush=()=>new Promise(r=>setImmediate(r));
function reset(customer='A'){state.requests=[];state.auth={ready:true,user:{email:'fixture@example.invalid'},session:{customers:customer?[{id:customer,kind:'personal'}]:[],mfaVerified:true},signOut(){}};}
const content=node=>typeof node==='string'?node:Array.isArray(node)?node.map(content).join(''):node?.children?content(node.children):'';
const text=tree=>content(tree.toJSON());
async function mount(path='/portal'){let tree;await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(ClientHome)));await flush();});return tree;}
test('正式工作台使用产品导航，未知资金不冒充零，金融快捷操作禁用',async()=>{
 reset();const tree=await mount();
 for(const label of ['工作台','资金中心','卡片中心','交易与账单','消息中心','帮助与工单','设置与开户','USD 可用余额','消费与退款趋势','卡片状态分布'])assert.ok(text(tree).includes(label),label);
 for(const label of ['充值 USDT','兑换 USD','充值到卡','申请新卡'])assert.equal(tree.root.findAllByType('button').find(b=>b.props.children===label)?.props.disabled,true);
 assert.equal(state.requests.length,2);assert.ok(state.requests.every(r=>r.path.startsWith('/client-api/v1/customers/A/')));
 await act(async()=>{state.requests.forEach(r=>r.resolve([]));await flush();});assert.ok(text(tree).includes('暂无业务账户'));assert.ok(!text(tree).includes('28,350'));await act(()=>tree.unmount());
});
test('七项导航和原账户安全深链可直接打开，不回退到首页',async()=>{
 for(const path of ['funds','cards','cards/new','transactions','messages','support','settings','accounts','security']){
 reset();const tree=await mount('/portal/'+path);assert.ok(!text(tree).includes('USD 可用余额'),path);await act(()=>tree.unmount());
 }
});
test('未关联和读取失败分别显示，不伪装成空账户',async()=>{
 reset(null);let tree=await mount();assert.equal(state.requests.length,0);assert.ok(text(tree).includes('当前尚未开通个人账户'));await act(()=>tree.unmount());
 reset();tree=await mount();await act(async()=>{state.requests.forEach(r=>r.reject(new Error('failed')));await flush();});assert.ok(text(tree).includes('读取失败'));assert.ok(!text(tree).includes('暂无业务账户'));await act(()=>tree.unmount());
});
test('切换客户后拒绝旧请求结果，保留当前主体数据',async()=>{
 reset();const tree=await mount();const old=[...state.requests];state.auth={...state.auth,session:{customers:[{id:'B',kind:'personal'}]}};
 await act(async()=>{tree.update(React.createElement(MemoryRouter,{},React.createElement(ClientHome)));await flush();});
 await act(async()=>{state.requests.slice(2).forEach(r=>r.resolve([]));old.forEach(r=>r.resolve([{id:'old',name:'OTHER_CUSTOMER_SECRET',status:'active'}]));await flush();});
 assert.ok(!text(tree).includes('OTHER_CUSTOMER_SECRET'));assert.ok(text(tree).includes('暂无业务账户'));await act(()=>tree.unmount());
});

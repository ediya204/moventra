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
export const liveGetPage=async path=>{s.calls.push(path);if(path.startsWith('/admin-api/v1/users')){if(s.directoryError)throw {code:'identity_directory_unavailable'};return {data:s.directoryRows||[{id:'user_fixture',email:'registered@example.com',name:'Registered',registrationStatus:'registered',authStatus:'enabled',emailVerified:true,userStatus:'active',customerLinkState:'linked_restricted',customers:[]}],meta:{hasMore:!path.includes('offset=20')&&!path.includes('email=')}};}if(s.accountsError)throw {code:'temporarily_unavailable'};return {data:[{id:'account_fixture',name:'Account A',status:'active'}],meta:{hasMore:!path.includes('offset=20'),offset:0,limit:20}};};
`);
async function component(name){let {outputText}=ts.transpileModule(readFileSync(new URL(`../../apps/admin/src/operations/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});outputText=outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:mocks)}`);return (await import(uri(outputText))).default;}
const Cards=await component('CardsPage'),Customers=await component('CustomerDirectoryPage'),Users=await component('RegisteredUsersPage'),Details=await component('UserDetailsPage');
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

test('registered users use email lookup, preserve deep link, and keep restricted links absent',async()=>{
 const view=await mount(Users,'/user-groups/users?keyword=registered%40example.com');
 assert.equal(state.calls[0],'/admin-api/v1/users?limit=20&offset=0&email=registered%40example.com');
 assert.equal(state.grid.rows[0].email,'registered@example.com');
 const link=state.grid.columns.find(c=>c.field==='actions').renderCell({row:state.grid.rows[0]});
 assert.equal(link.props.children.length,0);
 const search=view.root.findAll(n=>n.props.label==='完整登录邮箱'&&n.props.onChange)[0];
 await act(async()=>search.props.onChange({target:{value:'second@example.com'}}));
 await act(async()=>{view.root.findAll(n=>n.props.component==='form'&&n.props.onSubmit)[0].props.onSubmit({preventDefault(){}});await flush()});
 assert.equal(new URLSearchParams(state.location.search).get('email'),'second@example.com');
 assert.ok(state.calls.at(-1).includes('second%40example.com'));
 await act(async()=>view.unmount());
});
test('registered directory paginates and never represents provider failure as an empty list',async()=>{
 let view=await mount(Users,'/user-groups/users');
 await act(async()=>{view.root.findAll(n=>n.props.children==='下一页'&&n.props.onClick)[0].props.onClick();await flush()});
 assert.ok(state.calls.at(-1).endsWith('offset=20'));
 await act(async()=>view.unmount());
 state.directoryError=true;
 view=await mount(Users,'/user-groups/users?email=registered%40example.com');
 assert.equal(state.grid.rows.length,0);
 assert.ok(view.root.findAll(n=>n.props.children==='identity_directory_unavailable').length>0);
 assert.equal(view.root.findAll(n=>typeof n.props.children==='string'&&n.props.children.startsWith('未找到该登录邮箱')).length,0);
 state.directoryError=false;await act(async()=>view.unmount());
});
test('registered directory requires admin MFA before any request',async()=>{
 state.auth.session.mfaVerified=false;
 const view=await mount(Users,'/user-groups/users');assert.equal(state.calls.length,0);
 assert.equal(state.location.pathname,'/session');
 state.auth.session.mfaVerified=true;await act(async()=>view.unmount());
});

test('user details link preserves search and supports an identity without registration',async()=>{
 const view=await mount(Users,'/user-groups/users?email=registered%40example.com');
 const column=state.grid.columns.find(c=>c.field==='details');
 let link=column.renderCell({row:state.grid.rows[0]});
 let q=new URLSearchParams(link.props.to.split('?')[1]);
 assert.equal(q.get('userId'),'user_fixture');assert.equal(q.get('returnEmail'),'registered@example.com');
 link=column.renderCell({row:{...state.grid.rows[0],registrationStatus:'identity_only'}});
 q=new URLSearchParams(link.props.to.split('?')[1]);assert.equal(q.get('email'),'registered@example.com');assert.equal(q.has('userId'),false);
 await act(async()=>view.unmount());
});
const targetId='11111111-1111-1111-1111-111111111111';
const detailUser={id:targetId,email:'registered@example.com',name:'Registered',registrationStatus:'registered',authStatus:'enabled',emailVerified:true,userStatus:'active',registeredAt:'2026-09-13T00:00:00Z',customerLinkState:'linked_restricted',customers:[]};
const textNodes=(view,text)=>view.root.findAll(n=>typeof n.props.children==='string'&&n.props.children.includes(text));
test('direct user details shows registration without onboarding and keeps restricted accounts private',async()=>{
 state.directoryRows=[detailUser];
 const view=await mount(Details,`/user-groups/users/detail?userId=${targetId}&returnEmail=registered%40example.com`);
 assert.equal(state.calls.length,1);assert.ok(state.calls[0].includes(`userId=${targetId}`));
 assert.ok(textNodes(view,'registered@example.com').length);assert.ok(textNodes(view,'当前管理员没有该客户的业务查看权限').length);
 assert.equal(view.root.findAll(n=>n.props.to?.startsWith('/onboarding/')).length,0);
 assert.ok(view.root.findAll(n=>n.props.to==='/user-groups/users?email=registered%40example.com').length);
 await act(async()=>view.unmount());delete state.directoryRows;
});
test('details reads only linked authorized accounts, paginates, and separates read failures from empty accounts',async()=>{
 state.directoryRows=[{...detailUser,customerLinkState:'linked',customers:[{id:targetId,name:'Customer A',canReadAccounts:true,canReviewOnboarding:true}]}];
 const view=await mount(Details,`/user-groups/users/detail?userId=${targetId}`);
 assert.ok(state.calls.includes(`/admin-api/v1/customers/${targetId}/accounts?limit=20&offset=0`));
 assert.ok(textNodes(view,'Account A').length);assert.ok(textNodes(view,'账户 ID').length);
 assert.ok(view.root.findAll(n=>n.props.to===`/onboarding/${targetId}`).length);
 state.accountsError=true;
 await act(async()=>{view.root.findAll(n=>n.props.children==='下一页账户'&&n.props.onClick)[0].props.onClick();await flush()});
 assert.ok(state.calls.at(-1).endsWith('offset=20'));assert.ok(textNodes(view,'temporarily_unavailable').length);
 assert.equal(textNodes(view,'该客户暂无账户记录').length,0);assert.equal(textNodes(view,'Account A').length,0);
 assert.ok(textNodes(view,'registered@example.com').length);
 state.accountsError=false;await act(async()=>view.unmount());delete state.directoryRows;
});
test('identity-only user details, missing users, invalid links and no MFA remain distinct',async()=>{
 state.directoryRows=[{...detailUser,id:'identity:fixture',registrationStatus:'identity_only',registeredAt:null,userStatus:null,customerLinkState:'unlinked'}];
 let view=await mount(Details,'/user-groups/users/detail?email=registered%40example.com');
 assert.ok(textNodes(view,'待注册').length);assert.ok(textNodes(view,'尚未关联客户主体').length);assert.equal(state.calls.length,1);
 await act(async()=>view.unmount());state.directoryRows=[];
 view=await mount(Details,`/user-groups/users/detail?userId=${targetId}`);assert.ok(textNodes(view,'未找到该用户').length);await act(async()=>view.unmount());
 view=await mount(Details,'/user-groups/users/detail?userId=bad');assert.equal(state.calls.length,0);assert.ok(textNodes(view,'用户链接无效').length);await act(async()=>view.unmount());
 state.auth.session.mfaVerified=false;
 view=await mount(Details,`/user-groups/users/detail?userId=${targetId}`);assert.equal(state.calls.length,0);assert.equal(state.location.pathname,'/session');
 state.auth.session.mfaVerified=true;await act(async()=>view.unmount());delete state.directoryRows;
});

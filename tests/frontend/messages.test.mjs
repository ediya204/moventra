import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import {messageRoute as edge} from '../../deploy/cloudflare/messages.mjs';
import {handle} from '../../deploy/cloudflare/gateway.mjs';
const require=createRequire(import.meta.url),resolve=n=>pathToFileURL(require.resolve(n)).href,uri=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll('\"react/jsx-runtime\"',JSON.stringify(resolve('react/jsx-runtime')))).toString('base64');
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const contract=uri(source('../../packages/shared/src/auth/messageContract.ts'));const {messageRoute}=await import(contract);
const customer='10000000-0000-0000-0000-000000000001',id='20000000-0000-0000-0000-000000000001',base='/client-api/v1/customers/'+customer+'/messages',admin='/admin-api/v1/message-campaigns';
test('message transport and gateway reject unlisted routes, methods, cross-site writes and duplicate queries',async()=>{
 const paths=[base,base+'?category=otc&status=unread&limit=20',base+'?limit=0',base+'?limit=200',base+'?status=read&status=unread',base+'?category=secret',base+'?q=hello',base+'/'+id,base+'/'+id+'/read',base+'/read-all',base+'/read-all?scope=all',base+'/summary',admin,admin+'/'+id+'/draft',admin+'/'+id+'/publish',admin+'/'+id+'/recipients?page=1',admin+'/requests/'+id,admin+'/requests/'+id+'?secret=1'];
 for(const path of paths)for(const method of ['GET','POST','PATCH','DELETE'])assert.equal(messageRoute(method,path),edge(method,path),method+path);
 assert.equal(edge('POST',base+'/'+id+'/read'),true);assert.equal(edge('POST',base+'/'+id),false);assert.equal(edge('GET',base+'?limit=200'),false);assert.equal(edge('GET',base+'?status=read&status=unread'),false);
 const headers={Authorization:'Bearer synthetic','Content-Type':'application/json','Idempotency-Key':id};let calls=0;
 const ok=await handle(new Request('https://client.invalid'+base+'/'+id+'/read',{method:'POST',headers,body:'{}'}),{SITE_KIND:'client',API_ORIGIN:'https://api.invalid'},async(_,r)=>{calls++;assert.equal(r.method,'POST');return Response.json({data:{unread:1}})});assert.equal(ok.status,200);assert.equal(ok.headers.get('Cache-Control'),'no-store');assert.equal(calls,1);
 assert.equal((await handle(new Request('https://client.invalid'+base+'/read-all',{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body:'{}'}),{SITE_KIND:'client'},()=>assert.fail())).status,403);
 assert.equal((await handle(new Request('https://client.invalid'+admin,{headers}),{SITE_KIND:'client'},()=>assert.fail())).status,404);
});
const events=new EventTarget();globalThis.window=events;globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
const fixture=globalThis.__messageFixture={requests:[]};
const shell=uri(`import React from ${JSON.stringify(resolve('react'))};const Pass=({children})=>React.createElement('div',null,children);export const Stack=Pass,Box=Pass,Paper=Pass,List=Pass,ListItemText=({primary,secondary})=>React.createElement('div',null,primary,secondary),Typography=Pass,Divider=Pass,CircularProgress=Pass,MenuItem=Pass;export const Chip=({label})=>React.createElement('span',null,label);export const TextField=props=>React.createElement('input',props);export const Button=({children,...props})=>React.createElement('button',props,children);export const Alert=({children,action})=>React.createElement('div',null,children,action);export const ListItemButton=({children,...props})=>React.createElement('a',props,children);export const Badge=Pass,IconButton=Button,Popover=({open,children})=>open?React.createElement('div',null,children):null;`);
const api=uri(`export const messageError=e=>e.message;export const messageRequest=(path,body,key)=>new Promise((resolve,reject)=>globalThis.__messageFixture.requests.push({path,body,key,resolve,reject}));`);
const icon=uri('export const Icon=()=>null;');const money=uri(source('../../packages/shared/src/auth/cryptoContract.ts'));
const code=source('../../packages/shared/src/messages/MessageCenter.tsx').replace(/from ['"]([^'"]+)['"]/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?shell:n==='@iconify/react'?icon:n.endsWith('/messageApi')?api:n.endsWith('/messageContract')?contract:n.endsWith('/cryptoContract')?money:resolve(n)));
const {default:Center,MessageBell}=await import(uri(code));
const flush=()=>new Promise(r=>setImmediate(r));const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):'';
const msg={id,category:'otc',title:'OTC兑换已完成',body:'订单完成',priority:'normal',orderId:id,facts:{currency:'USDT',amountMinor:'1239999',toCurrency:'USD',receiveMinor:'122',feeMinor:'0',rate:'0.99',state:'completed'},occurredAt:'2026-09-19T00:00:00Z',deliveredAt:'2026-09-19T00:00:02Z',readAt:null};
const summary={unread:2,categories:{otc:2},snapshotToken:'signed-snapshot'};
const button=(t,label)=>t.root.findAllByType('button').find(n=>text(n.props.children)===label);
async function mount(path,component=Center){fixture.requests=[];let tree;await act(async()=>{tree=Renderer.create(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(component,{customerId:customer})));await flush()});return tree}
test('opening a list or bell never marks messages read; bulk-read submits the displayed snapshot',async()=>{
 let t=await mount('/portal/messages');await act(async()=>{fixture.requests[0].resolve({items:[msg],nextCursor:'',summary});await flush()});assert.equal(fixture.requests.filter(r=>r.body).length,0);assert.match(text(t.toJSON()),/2 条未读/);
 await act(async()=>{button(t,'全部标为已读').props.onClick();await flush()});assert.deepEqual(fixture.requests[1].body,{snapshotToken:'signed-snapshot'});assert.equal(fixture.requests[1].path,base+'/read-all');
 await act(async()=>{fixture.requests[1].reject(new Error('read failed'));await flush()});assert.match(text(t.toJSON()),/read failed/);assert.match(text(t.toJSON()),/2 条未读/);await act(()=>t.unmount());
 t=await mount('/portal',MessageBell);await act(async()=>{fixture.requests[0].resolve({items:[msg],nextCursor:'',summary});await flush()});assert.equal(fixture.requests.filter(r=>r.body).length,0);await act(()=>t.unmount());
});
test('deep-link details show precise historical facts and read only after load; failure stays retryable',async()=>{
 const t=await mount('/portal/messages/'+id+'?status=unread');assert.equal(fixture.requests[0].path,base+'/'+id);await act(async()=>{fixture.requests[0].resolve(msg);await flush()});assert.equal(fixture.requests[1].path,base+'/'+id+'/read');assert.match(text(t.toJSON()),/1.23 USDT/);assert.match(text(t.toJSON()),/1.22 USD/);assert.equal(button(t,'返回消息列表').props.to,'/portal/messages?status=unread');assert.equal(button(t,'查看订单').props.to,'/portal/funds/orders/'+id);
 await act(async()=>{fixture.requests[1].reject(new Error('read failed'));await flush()});assert.ok(button(t,'重试已读'));assert.match(text(t.toJSON()),/未读/);await act(()=>t.unmount());
});
test('query failures are never shown as an empty inbox',async()=>{
 const t=await mount('/portal/messages');await act(async()=>{fixture.requests[0].reject(new Error('service offline'));await flush()});assert.match(text(t.toJSON()),/service offline/);assert.doesNotMatch(text(t.toJSON()),/暂无消息/);assert.ok(button(t,'重试'));await act(()=>t.unmount());
});
test('every message OpenAPI route is reachable through the exact method allowlists',()=>{
 const spec=JSON.parse(source('../../services/api/docs/messages.openapi.json'));
 for(const[path,methods]of Object.entries(spec.paths))for(const method of Object.keys(methods)){
  const concrete=path.replaceAll('{customerId}',customer).replaceAll('{id}',id).replaceAll('{key}',id);
  assert.equal(messageRoute(method.toUpperCase(),concrete),true,method+' '+path);assert.equal(edge(method.toUpperCase(),concrete),true);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {handle} from '../../deploy/cloudflare/gateway.mjs';
const require=createRequire(import.meta.url),uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const fixture=globalThis.__cardControlFixture={calls:[],fail:false};
const mui=uri(`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};const Pass=({children,...p})=>React.createElement('div',p,children);export const Alert=Pass,DialogActions=Pass,DialogContent=Pass,DialogTitle=Pass,Stack=Pass,Typography=Pass;export const Dialog=({open,children})=>open?React.createElement('div',{},children):null;export const Button=({children,...p})=>React.createElement('button',p,children);`);
const api=uri(`export const authMessage=()=> '请求结果未知';export async function liveCardAction(...args){globalThis.__cardControlFixture.calls.push(args);if(globalThis.__cardControlFixture.fail)throw Error('offline');return {state:'queued'}}`);
const output=ts.transpileModule(readFileSync(new URL('../../packages/shared/src/components/CardControls.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ["']([^"']+)["']/g,(_,n)=>'from '+JSON.stringify(n==='@mui/material'?mui:n.endsWith('/liveApi')?api:pathToFileURL(require.resolve(n)).href));
const Controls=(await import(uri(output))).default;
const path='/client-api/v1/customers/10000000-0000-0000-0000-000000000001/card-projections/slash/cards/c1/actions';
const button=(v,label)=>v.root.findAllByType('button').find(b=>b.props.children===label);
test('card actions require confirmation, preserve retry identity and do not infer success',async()=>{
 fixture.calls=[];fixture.fail=true;let refresh=0,v;
 await act(()=>{v=Renderer.create(React.createElement(Controls,{path,row:{controlsEnabled:true,cardStatus:'active',last4:'1234'},onRefresh:()=>refresh++}))});
 assert.equal(fixture.calls.length,0);
 await act(()=>button(v,'停用卡片').props.onClick());assert.equal(fixture.calls.length,0);
 await act(()=>button(v,'确认停用卡片').props.onClick());assert.equal(refresh,0);
 fixture.fail=false;await act(()=>button(v,'确认停用卡片').props.onClick());
 assert.equal(refresh,1);assert.deepEqual(fixture.calls[0],[path,{action:'pause',expectedStatus:'active',confirmClose:false},fixture.calls[1][2]]);
 assert.ok(button(v,'停用卡片'),'no optimistic change to provider status');
 await act(()=>button(v,'更多操作').props.onClick());await act(()=>button(v,'注销卡片').props.onClick());await act(()=>button(v,'确认注销卡片').props.onClick());
 assert.equal(fixture.calls[2][1].confirmClose,true);assert.equal(fixture.calls[2][1].action,'close');
 await act(()=>v.unmount());
});
test('pending and review block writes; closed preserves history without activation',async()=>{
 for(const state of ['queued','submitted','confirming','review']){
  let v;await act(()=>{v=Renderer.create(React.createElement(Controls,{path,row:{controlsEnabled:true,cardStatus:'active',cardAction:{state}},onRefresh:()=>{}}))});
  assert.ok(v.root.findAllByType('button').every(b=>b.props.disabled));await act(()=>v.unmount());
 }
 let v;await act(()=>{v=Renderer.create(React.createElement(Controls,{path,row:{controlsEnabled:true,cardStatus:'closed'},onRefresh:()=>{}}))});assert.equal(v.root.findAllByType('button').length,0);assert.match(JSON.stringify(v.toJSON()),/历史记录/);await act(()=>v.unmount());
});
test('gateway allows only scoped same-origin POST actions',async()=>{
 const env={SITE_KIND:'client',API_ORIGIN:'https://api.example.invalid'};let calls=0;
 const upstream=async (req,init)=>{calls++;assert.equal(init.headers.get('Idempotency-Key'),'request-key');return Response.json({data:{state:'queued'}},{status:202})};
 const request=(method='POST',origin='https://moventra.test')=>new Request('https://moventra.test'+path,{method,headers:{Origin:origin,Authorization:'Bearer token','Idempotency-Key':'request-key'}});
 assert.equal((await handle(request(),env,upstream)).status,202);
 assert.equal((await handle(request('GET'),env,upstream)).status,405);
 assert.equal((await handle(request('POST','https://evil.test'),env,upstream)).status,403);
 assert.equal((await handle(request(),{...env,SITE_KIND:'admin'},upstream)).status,404);assert.equal(calls,1);
});

test('client freeze label retains the existing confirmed pause command',async()=>{
 fixture.calls=[];fixture.fail=false;let v;
 await act(()=>{v=Renderer.create(React.createElement(Controls,{path,pauseLabel:'冻结卡片',row:{controlsEnabled:true,cardStatus:'active'},onRefresh:()=>{}}))});
 await act(()=>button(v,'冻结卡片').props.onClick());assert.equal(fixture.calls.length,0);
 await act(()=>button(v,'确认冻结卡片').props.onClick());assert.equal(fixture.calls[0][1].action,'pause');await act(()=>v.unmount());
});

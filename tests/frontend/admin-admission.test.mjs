import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const mocks=uri(`
const m=globalThis.__moventraAdmission;
export const sessionPath='/admin-api/v1/me';
export const isAdminSite=true,isDemoMode=false,browserPopupRedirectResolver={};
export const clearAccessToken=()=>{},setAccessToken=()=>{},login=()=>{};
export const getFirebaseAuth=()=>m.auth;
export const liveGet=()=>m.pending;
export class SessionError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
export const onIdTokenChanged=(a,cb)=>{m.listener=cb;cb(null);return ()=>{};};
export const signOut=async()=>{m.signouts++;m.auth.currentUser=null;m.listener(null);};
export const signInWithEmailAndPassword=()=>{m.passwordCalls++;throw {code:'auth/multi-factor-auth-required'};},signInWithPopup=()=>{m.googleCalls++;},getMultiFactorResolver=()=>({hints:[{uid:'totp-fixture',factorId:'totp'}]});
export class GoogleAuthProvider {setCustomParameters(){}}
export const TotpMultiFactorGenerator={FACTOR_ID:'totp'};
`);
const m=globalThis.__moventraAdmission={auth:{currentUser:null},signouts:0};
const src=readFileSync(new URL('../../packages/shared/src/auth/AuthContext.tsx',import.meta.url),'utf8');
let {outputText}=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
outputText=outputText.replaceAll('import.meta.env.DEV','false');
outputText=outputText.replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:mocks)}`);
const {AuthProvider,useAuth}=await import(uri(outputText));
let state;
function Probe(){state=useAuth();return null;}
const flush=()=>new Promise(r=>setImmediate(r));
test('admin admission waits for Go and signs out denied identities',async()=>{
 for(const scenario of ['customer','operator','mfa-setup','outage']){
  m.signouts=0;m.auth.currentUser=null;
  let resolve,reject;m.pending=new Promise((a,b)=>{resolve=a;reject=b;});
  let view;await act(async()=>{view=Renderer.create(React.createElement(AuthProvider,null,React.createElement(Probe)));});
  const user={email:'fixture@example.invalid',emailVerified:true};m.auth.currentUser=user;
  await act(async()=>{m.listener(user);});
  assert.equal(state.ready,false);assert.equal(state.user,null);assert.equal(state.authenticated,false);
  await act(async()=>{
   if(scenario==='outage')reject({code:'api_unavailable',status:503});
   else resolve({customers:[],staffScopes:[],role:scenario==='customer'?'customer':'admin',operator:scenario!=='customer',mfaVerified:scenario!=='mfa-setup'});
   await flush();
  });
  if(scenario==='customer'||scenario==='outage'){
   assert.equal(m.signouts,1);assert.equal(m.auth.currentUser,null);assert.equal(state.user,null);assert.equal(state.authenticated,false);
   assert.equal(state.loginError.code,scenario==='customer'?'operator_required':'api_unavailable');assert.equal(state.ready,true);
  }else{
   assert.equal(m.signouts,0);assert.equal(state.user,user);assert.equal(state.authenticated,scenario==='operator');
  }
  await act(async()=>view.unmount());
 }
});

test('admin password login has no frontend email allowlist; Google remains disabled',async()=>{
 m.auth.currentUser=null;m.passwordCalls=0;m.googleCalls=0;
 let view;await act(async()=>{view=Renderer.create(React.createElement(AuthProvider,null,React.createElement(Probe)));});
 await act(async()=>{await state.signIn('new-admin@example.invalid','fixture-password');});
 assert.equal(m.passwordCalls,1);assert.equal(state.factors.length,1);
 await act(async()=>{await assert.rejects(state.signInWithGoogle(),{code:'admin_password_required'});});
 assert.equal(m.googleCalls,0);
 await act(async()=>view.unmount());
});
test('each build has a separate login URL and identity endpoint',async()=>{
 const source=readFileSync(new URL('../../packages/shared/src/auth/site.ts',import.meta.url),'utf8');
 for(const kind of ['admin','client']){
  let {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  outputText=outputText.replaceAll('import.meta.env.VITE_SITE_KIND',JSON.stringify(kind));
  const config=await import(uri(outputText));
  assert.equal(config.loginPath,kind==='admin'?'/admin/login':'/portal/login');
  assert.equal(config.sessionPath,`/${kind}-api/v1/me`);
 }
});
test('client admission rejects administrators and preserves registration recovery',async()=>{
 const clientMocks=uri(Buffer.from(mocks.split(',')[1],'base64').toString().replace('isAdminSite=true','isAdminSite=false').replace('/admin-api/v1/me','/client-api/v1/me'));
 let {outputText}=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
 outputText=outputText.replaceAll('import.meta.env.DEV','false').replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:clientMocks)}`);
 const client=await import(uri(outputText));
 let clientState;
 function ClientProbe(){clientState=client.useAuth();return null;}
 for(const scenario of ['customer','admin','registration']){
  m.signouts=0;m.auth.currentUser=null;
  let resolve,reject;m.pending=new Promise((a,b)=>{resolve=a;reject=b;});
  let view;await act(async()=>{view=Renderer.create(React.createElement(client.AuthProvider,null,React.createElement(ClientProbe)));});
  const user={email:'fixture@example.invalid',emailVerified:true};m.auth.currentUser=user;
  await act(async()=>m.listener(user));
  await act(async()=>{
   if(scenario==='registration')reject({code:'registration_required',status:403});
   else resolve({role:scenario,customers:[],staffScopes:[],operator:scenario==='admin',mfaVerified:true});
   await flush();
  });
  assert.equal(clientState.authenticated,scenario==='customer');
  assert.equal(m.signouts,scenario==='admin'?1:0);
  if(scenario==='admin'){assert.equal(clientState.user,null);assert.equal(clientState.loginError.code,'customer_required');}
  if(scenario==='registration'){assert.equal(clientState.user,user);assert.equal(clientState.sessionError.code,'registration_required');}
  await act(async()=>view.unmount());
 }
});

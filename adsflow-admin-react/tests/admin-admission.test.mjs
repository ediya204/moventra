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
export const isAdminSite=true,isDemoMode=false,browserPopupRedirectResolver={};
export const clearAccessToken=()=>{},setAccessToken=()=>{},login=()=>{};
export const getFirebaseAuth=()=>m.auth;
export const liveGet=()=>m.pending;
export class SessionError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
export const onIdTokenChanged=(a,cb)=>{m.listener=cb;cb(null);return ()=>{};};
export const signOut=async()=>{m.signouts++;m.auth.currentUser=null;m.listener(null);};
export const signInWithEmailAndPassword=()=>{},signInWithPopup=()=>{},getMultiFactorResolver=()=>{};
export class GoogleAuthProvider {setCustomParameters(){}}
export const TotpMultiFactorGenerator={};
`);
const m=globalThis.__moventraAdmission={auth:{currentUser:null},signouts:0};
const src=readFileSync(new URL('../src/auth/AuthContext.tsx',import.meta.url),'utf8');
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
   else resolve({customers:[],staffScopes:[],operator:scenario!=='customer',mfaVerified:scenario!=='mfa-setup'});
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

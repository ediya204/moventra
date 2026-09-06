// Opt-in, real deployed negative-authorization checks. No production DB writes.
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
if(process.env.RUN_DEPLOYED_AUTH_TESTS!=='1')throw new Error('Explicit opt-in required');
const config=JSON.parse(readFileSync(new URL('../src/config/firebase.web.json',import.meta.url)));
if(process.env.FIREBASE_PROJECT_ID!==config.projectId)throw new Error('Explicit project required');
const access=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
async function admin(action,body){
 const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}`,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json','X-Goog-User-Project':config.projectId},body:JSON.stringify({...body,targetProjectId:config.projectId}),signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok)throw new Error(`Admin request HTTP ${response.status}`);return data;
}
const email=`moventra-deployed-test-${Date.now()}@example.invalid`,password=randomBytes(24).toString('base64url');
let uid;const app=initializeApp(config,'deployed-test');
try{
 uid=(await admin('signUp',{email,password,emailVerified:true})).localId;
 const auth=initializeAuth(app,{persistence:inMemoryPersistence});const credential=await signInWithEmailAndPassword(auth,email,password);const token=await credential.user.getIdToken();
 for(const origin of ['https://moventra.apexisnetworking.work','https://moventra-api-ejeq.onrender.com']){
  // curl config via stdin keeps the token out of command arguments and logs.
  const output=execFileSync('curl',['--config','-'],{input:`silent\nshow-error\nmax-time = 30\nurl = "${origin}/api/v1/me"\nheader = "Authorization: Bearer ${token}"\nwrite-out = "\\n%{http_code}"\n`,encoding:'utf8'});
  const split=output.lastIndexOf('\n');assert.equal(output.slice(split+1),'403');assert.equal(JSON.parse(output.slice(0,split)).error.code,'user_not_enabled');
  console.log(`PASS ${origin}: real verified Firebase identity denied without local provisioning.`);
 }
}finally{
 if(uid)await admin('delete',{localId:uid});await deleteApp(app);console.log('Disposable cloud identity removed; no production user/customer/grant inserted.');
}

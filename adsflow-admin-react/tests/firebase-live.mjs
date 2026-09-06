// Explicit opt-in integration test. Creates disposable Firebase accounts and a
// local PostgreSQL database, exercises real TOTP, then removes its own fixtures.
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, multiFactor, TotpMultiFactorGenerator, getMultiFactorResolver, signOut } from 'firebase/auth';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

if (process.env.RUN_LIVE_FIREBASE_TESTS !== '1') throw new Error('Requires RUN_LIVE_FIREBASE_TESTS=1');
const config=JSON.parse(readFileSync(new URL('../src/config/firebase.web.json',import.meta.url)));
if(process.env.FIREBASE_PROJECT_ID!==config.projectId)throw new Error('Explicit project confirmation required');
const adminToken=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const admin=async(action,body)=>{
 const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}`,{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${adminToken}`,'X-Goog-User-Project':config.projectId,'Content-Type':'application/json'},body:JSON.stringify({...body,targetProjectId:config.projectId})});
 const data=await response.json();if(!response.ok)throw new Error(`Admin ${action}: ${response.status} ${data.error?.message}`);return data;
};
function totp(secret){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret.replace(/=/g,''))bits+=alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5,'0');
 const key=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',key).update(counter).digest();const offset=digest[19]&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
const suffix=Date.now().toString(36)+'-'+randomBytes(4).toString('hex');
const temp=mkdtempSync(join(tmpdir(),'moventra-auth-'));const fixtures={},created=[],apps=[];
const db='adsflow_test_live_'+Date.now();let databaseCreated=false;
try {
 for(const name of ['alice','bob','staff','disabled','unverified','unprovisioned','cloudDisabled','revoked']){
  const email=`moventra-auth-test-${name}-${suffix}@example.invalid`;const password=randomBytes(24).toString('base64url');
  const account=await admin('signUp',{email,password,emailVerified:name!=='unverified',displayName:'Disposable auth verification'});created.push(account.localId);
  const app=initializeApp(config,`test-${name}-${suffix}`);apps.push(app);const auth=initializeAuth(app,{persistence:inMemoryPersistence});
  if(name==='alice') await assert.rejects(signInWithEmailAndPassword(auth,email,'deliberately-incorrect-password'));
  let credential=await signInWithEmailAndPassword(auth,email,password);
  fixtures[name]={uid:account.localId,token:await credential.user.getIdToken()};
  if(name==='staff'){
   const secret=await TotpMultiFactorGenerator.generateSecret(await multiFactor(credential.user).getSession());
   await multiFactor(credential.user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret,totp(secret.secretKey)),'Test authenticator');
   await signOut(auth);
   let resolver;try{await signInWithEmailAndPassword(auth,email,password);throw new Error('MFA was not enforced');}catch(error){assert.equal(error.code,'auth/multi-factor-auth-required');resolver=getMultiFactorResolver(auth,error);}
   let invalid=totp(secret.secretKey)==='000000'?'111111':'000000';
   await assert.rejects(resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(resolver.hints[0].uid,invalid)));
   // Firebase rejects reuse of an enrollment code in the same time step.
   await new Promise(resolve => setTimeout(resolve, 31000 - Date.now()%30000));
   credential=await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(resolver.hints[0].uid,totp(secret.secretKey)));
   fixtures.staff={uid:account.localId,token:await credential.user.getIdToken()};
   const claims=JSON.parse(Buffer.from(fixtures.staff.token.split('.')[1],'base64url'));assert.equal(claims.firebase.sign_in_second_factor,'totp');
   // A genuine single-factor token is obtained from a separate operator fixture:
   // enrolling MFA can revoke pre-enrollment tokens, so never rely on that token.
   const noMfaAccount=await admin('signUp',{email:`moventra-auth-test-no-mfa-${suffix}@example.invalid`,password,emailVerified:true});created.push(noMfaAccount.localId);
   const noApp=initializeApp(config,`test-no-mfa-${suffix}`);apps.push(noApp);const noAuth=initializeAuth(noApp,{persistence:inMemoryPersistence});const noCred=await signInWithEmailAndPassword(noAuth,`moventra-auth-test-no-mfa-${suffix}@example.invalid`,password);
   fixtures.staffNoMfa={uid:noMfaAccount.localId,token:await noCred.user.getIdToken()};
   const parts=fixtures.staffNoMfa.token.split('.');const forged=JSON.parse(Buffer.from(parts[1],'base64url'));forged.firebase.sign_in_second_factor='totp';parts[1]=Buffer.from(JSON.stringify(forged)).toString('base64url');fixtures.tampered={uid:noMfaAccount.localId,token:parts.join('.')};
  }
  if(name==='cloudDisabled')await admin('update',{localId:account.localId,disableUser:true});
  if(name==='revoked')await admin('update',{localId:account.localId,validSince:String(Math.floor(Date.now()/1000)+2)});
 }
 writeFileSync(join(temp,'fixtures.json'),JSON.stringify(fixtures),{mode:0o600});
 execFileSync('createdb',['-h','/tmp',db]);databaseCreated=true;
 const api=resolve(new URL('../../adsflow-api',import.meta.url).pathname);
 const result=spawnSync('go',['test','-race','-count=1','-run','^TestLiveFirebaseAuthorization$','-v','./internal/api'],{cwd:api,env:{...process.env,TEST_DATABASE_URL:`postgresql:///${db}?host=/tmp`,LIVE_AUTH_FIXTURES:join(temp,'fixtures.json')},encoding:'utf8'});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0,'Go live authorization failed');
 console.log('PASS: real password login, wrong password, TOTP enrollment/challenge, wrong TOTP, and Go authorization checks.');
} finally {
 if(databaseCreated)execFileSync('dropdb',['-h','/tmp',db]);
 for(const uid of created)await admin('delete',{localId:uid});
 for(const app of apps)await deleteApp(app);
 rmSync(temp,{recursive:true,force:true});
 console.log('Disposable Firebase users and local test database removed.');
}

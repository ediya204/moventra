import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {handle} from '../../deploy/cloudflare/gateway.mjs';
const code=ts.transpileModule(readFileSync(new URL('../../apps/client/src/portal/remoteCvv.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createCvvSession}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const path='/client-api/v1/customers/10000000-0000-0000-0000-000000000001/card-projections/source/cards/card/cvv/reveal';
test('CVV is explicit authenticated remote read, ephemeral, and ignores late responses',async()=>{
 const secret=String(Math.floor(Math.random()*900)+100),requests=[],timers=[];let value='',status;
 const session=createCvvSession({remoteCardId:'card',endpoint:path,authorization:async()=> 'Bearer fixture',write:v=>{value=v},status:v=>{status=v},isActive:()=>true,now:()=>1000,schedule:(callback,ms)=>{const job={callback,ms,cancelled:false};timers.push(job);return ()=>{job.cancelled=true}},fetcher:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
 assert.equal(requests.length,0);const pending=session.show();await new Promise(r=>setImmediate(r));
 assert.equal(requests[0].url,path);assert.equal(requests[0].options.cache,'no-store');assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.headers.Authorization,'Bearer fixture');
 requests[0].resolve(Response.json({source:'upstream',cardId:'card',cvv:secret,expiresAt:new Date(90000).toISOString()},{headers:{'Cache-Control':'private, no-store'}}));await pending;
 assert.ok(value===secret);assert.ok(!JSON.stringify(status).includes(secret));
 const expiry=timers.find(t=>t.ms===30000&&!t.cancelled);assert.ok(expiry);expiry.callback();assert.equal(value,'');
 const late=session.show();await new Promise(r=>setImmediate(r));session.hide();requests[1].resolve(Response.json({source:'upstream',cardId:'card',cvv:secret,expiresAt:new Date(30000).toISOString()},{headers:{'Cache-Control':'no-store'}}));await late;assert.equal(value,'');session.dispose();
});
test('CVV rejects identity mismatch, missing no-store, and never reads upstream errors',async()=>{
 for(const variant of ['mismatch','cache','error']){
  let value='',read=false;const session=createCvvSession({remoteCardId:'card',endpoint:path,write:v=>{value=v},status:()=>{},isActive:()=>true,fetcher:async()=>variant==='error'?{ok:false,status:503,json(){read=true;throw Error('private')}}:Response.json({source:'upstream',cardId:variant==='mismatch'?'other':'card',cvv:String(777),expiresAt:new Date(Date.now()+30000).toISOString()},{headers:variant==='cache'?{}:{'Cache-Control':'no-store'}})});
  await session.show();assert.equal(value,'');assert.equal(read,false);session.dispose();
 }
});
test('CVV gateway isolates customer POST, auth, origin, no-store and upstream errors',async()=>{
 const env={SITE_KIND:'client',API_ORIGIN:'https://api.invalid'},request=(method='POST',extra={})=>new Request('https://web.invalid'+path,{method,headers:{Authorization:'Bearer fixture',...extra}});
 assert.equal((await handle(request('GET'),env)).status,405);assert.equal((await handle(request(),{...env,SITE_KIND:'admin'})).status,404);
 assert.equal((await handle(new Request('https://web.invalid'+path,{method:'POST'}),env)).status,401);
 assert.equal((await handle(request('POST',{Origin:'https://other.invalid'}),env)).status,403);
 const denied=await handle(request(),env,async()=>Response.json({cvv:'DO_NOT_FORWARD'},{status:503}));assert.ok(!(await denied.text()).includes('DO_NOT_FORWARD'));
 const invalid=await handle(request(),env,async()=>Response.json({}));assert.equal(invalid.status,502);
 const success=await handle(request(),env,async()=>Response.json({source:'upstream'},{headers:{'Cache-Control':'private, no-store'}}));assert.equal(success.status,200);assert.equal(success.headers.get('Cache-Control'),'private, no-store');
});

test('full card details are validated, expire together and never enter status',async()=>{
 let cvv='',details=null,status;const timers=[];
 const payload={source:'upstream',cardId:'card',pan:'4'.repeat(16),cvv:'789',name:'Synthetic card',expiryMonth:'09',expiryYear:'2030',expiresAt:new Date(90000).toISOString()};
 const session=createCvvSession({remoteCardId:'card',endpoint:path.replace('/cvv/','/details/'),write:v=>cvv=v,writeDetails:v=>details=v,status:v=>status=v,isActive:()=>true,now:()=>1000,schedule:(fn,ms)=>{timers.push({fn,ms});return ()=>{}},fetcher:async()=>Response.json(payload,{headers:{'Cache-Control':'no-store'}})});
 await session.show();assert.equal(details.pan,payload.pan);assert.equal(cvv,payload.cvv);assert.ok(!JSON.stringify(status).includes(payload.pan));
 timers.find(t=>t.ms===30000).fn();assert.equal(details,null);assert.equal(cvv,'');
 payload.pan='invalid';await session.show();assert.equal(details,null);assert.equal(cvv,'');assert.equal(status.phase,'error');session.dispose();
});
test('full details gateway uses the same owner-only no-store boundary',async()=>{
 const url='https://web.invalid'+path.replace('/cvv/','/details/'),env={SITE_KIND:'client',API_ORIGIN:'https://api.invalid'};
 const request=(method='POST',origin='https://web.invalid')=>new Request(url,{method,headers:{Authorization:'Bearer fixture',Origin:origin}});
 assert.equal((await handle(request('GET'),env)).status,405);
 assert.equal((await handle(request(),{...env,SITE_KIND:'admin'})).status,404);
 assert.equal((await handle(request('POST','https://other.invalid'),env)).status,403);
 const bad=await handle(request(),env,async()=>Response.json({pan:'private-upstream-error'},{status:500}));assert.ok(!(await bad.text()).includes('private-upstream-error'));
 const good=await handle(request(),env,async()=>Response.json({source:'upstream'},{headers:{'Cache-Control':'private, no-store'}}));assert.equal(good.status,200);assert.equal(good.headers.get('Cache-Control'),'private, no-store');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './gateway.mjs';
const id='10000000-0000-0000-0000-000000000001';
const env={API_ORIGIN:'https://api.example.invalid',SITE_KIND:'client'};
const path=`/client-api/v1/customers/${id}/ledger`;
test('ledger proxy only allows authenticated scoped GET',async()=>{
 const request=new Request('https://web.invalid'+path,{headers:{Authorization:'Bearer fixture'}});
 const res=await handle(request,env,async(url,options)=>{
  assert.equal(url.pathname,path);assert.equal(options.method,'GET');
  assert.equal(options.headers.get('Authorization'),'Bearer fixture');
  return Response.json({data:{mode:'shadow'}});
 });assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');
 for(const method of ['POST','PUT','DELETE']){
  const r=await handle(new Request('https://web.invalid'+path,{method}),env,()=>assert.fail('write reached origin'));
  assert.equal(r.status,405);
 }
 assert.equal((await handle(new Request('https://web.invalid'+path),env)).status,401);
 assert.equal((await handle(new Request('https://web.invalid'+path.replace('client-api','admin-api')),env)).status,404);
 assert.equal((await handle(new Request('https://web.invalid'+path+'/resolve'),env)).status,404);
});

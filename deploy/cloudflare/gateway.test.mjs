import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './gateway.mjs';

const customer = '10000000-0000-0000-0000-000000000001';
const env = { API_ORIGIN: 'https://api.example.invalid', ASSETS: { fetch: () => new Response('SPA') } };
test('legacy, local and sensitive APIs never reach the origin or SPA', async () => {
  for (const path of ['/admin-api/login', '/local-slash-demo/state', '/client-api/cards/card/cvv/reveal', '/api', '/admin-api', '/client-api', '/local-slash-demo']) {
    const res = await handle(new Request('https://web.example.invalid' + path), env, () => assert.fail('unexpected upstream'));
    assert.equal(res.status, 404); assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
});
test('only implemented methods can reach the API', async () => {
  const res = await handle(new Request(`https://web.example.invalid/admin-api/v1/customers/${customer}/accounts`, { method: 'POST' }), env, () => assert.fail('unexpected upstream'));
  assert.equal(res.status, 405);
});
test('unconfigured API and missing identity fail closed', async () => {
  const req = new Request('https://web.example.invalid/api/v1/me');
  assert.equal((await handle(req, { ...env, API_ORIGIN: '' })).status, 503);
  assert.equal((await handle(req, env)).status, 401);
});
test('forward only allowlisted headers; never cache identity response', async () => {
  const req = new Request('https://web.example.invalid/api/v1/me', { headers: { Authorization: 'Bearer test-fixture', Cookie: 'private=secret', 'X-User-ID': 'spoofed' } });
  const res = await handle(req, env, async (url, options) => {
    assert.equal(url.href, 'https://api.example.invalid/api/v1/me');
    assert.equal(options.headers.get('Authorization'), 'Bearer test-fixture');
    assert.equal(options.headers.get('Cookie'), null);
    assert.equal(options.headers.get('X-User-ID'), null);
    assert.equal(options.redirect, 'manual');
    return Response.json({ data: {} }, { headers: { 'Cache-Control': 'public', 'Set-Cookie': 'wrong=1' } });
  });
  assert.equal(res.status, 200); assert.equal(res.headers.get('Cache-Control'), 'no-store'); assert.equal(res.headers.get('Set-Cookie'), null);
});
test('redirects and HTML responses are blocked', async () => {
  for (const response of [new Response(null, { status: 302, headers: { Location: 'https://other.invalid' } }), new Response('upstream error')]) {
    const req = new Request('https://web.example.invalid/api/v1/me', { headers: { Authorization: 'Bearer test-fixture' } });
    assert.equal((await handle(req, env, async () => response)).status, 502);
  }
});
test('static frontend requests use the asset binding', async () => {
  assert.equal(await (await handle(new Request('https://web.example.invalid/'), env)).text(), 'SPA');
});

test('registration permits authenticated POST only and preserves its body', async () => {
  const url='https://web.example.invalid/api/v1/register';
  assert.equal((await handle(new Request(url),env,()=>assert.fail('upstream'))).status,405);
  assert.equal((await handle(new Request(url,{method:'POST'}),env,()=>assert.fail('upstream'))).status,401);
  const res=await handle(new Request(url,{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({name:'New user'})}),env,async(target,options)=>{
    assert.equal(target.pathname,'/api/v1/register');
    assert.equal(options.method,'POST');
    assert.deepEqual(await new Response(options.body).json(),{name:'New user'});
    return Response.json({data:{id:'fixture'}});
  });
  assert.equal(res.status,200);
});
test('deployment blocks the opposite API and admin registration before forwarding', async () => {
  for (const [kind, path] of [['client', `/admin-api/v1/customers/${customer}/accounts`], ['admin', `/client-api/v1/customers/${customer}/transactions`], ['admin', '/api/v1/register']]) {
    const res = await handle(new Request('https://web.invalid'+path, {headers:{Authorization:'Bearer fixture'}}), {...env,SITE_KIND:kind}, ()=>assert.fail('cross-site upstream'));
    assert.equal(res.status,404);
  }
});
test('identity discovery separates customer scopes, staff scopes and denies nonoperators', async () => {
  const req = new Request('https://web.invalid/api/v1/me',{headers:{Authorization:'Bearer fixture'}});
  const source = {id:'user', customers:[{id:customer}],operator:true,mfaVerified:true,requiresMfa:false,staffScopes:[{customerId:customer,permission:'accounts:read'}]};
  for (const kind of ['admin','client']) {
    const res = await handle(req,{...env,SITE_KIND:kind},async()=>Response.json({data:source}));
    assert.equal(res.status,200);
    const {data}=await res.json();
    assert.equal(data.customers.length,kind==='admin'?0:1);
    assert.equal(data.staffScopes.length,kind==='admin'?1:0);
    assert.equal(data.operator,kind==='admin');
  }
  const denied=await handle(req,{...env,SITE_KIND:'admin'},async()=>Response.json({data:{...source,operator:false}}));
  assert.equal(denied.status,403);
  const pending=await handle(req,{...env,SITE_KIND:'admin'},async()=>Response.json({data:{...source,mfaVerified:false,requiresMfa:true}}));
  assert.deepEqual((await pending.json()).data.staffScopes,[]);
});

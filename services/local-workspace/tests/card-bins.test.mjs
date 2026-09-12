import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openStore,importDemo,cleanDemo} from '../demo-server/slash/store.mjs';
import {NAMESPACE as ns} from '../demo-server/slash/generate.mjs';
import {seedBins,binsList,binProduct,saveBin} from '../demo-server/slash/bins.mjs';
import {portalState,portalAction} from '../demo-server/slash/portal.mjs';
import {seedManagement,createSession} from '../demo-server/slash/management.mjs';
import {consoleRead} from '../demo-server/slash/console.mjs';
import {createDemoServer} from '../demo-server/slash/server.mjs';
import {readCardQuery,filterCards} from '../../../apps/client/src/portal/cardQuery.ts';
const pid='DEMO-BIN-USD-VISA';
function setup(t){const db=openStore(':memory:');importDemo(db,{persist:false});seedManagement(db,ns);seedBins(db,ns);t.after(()=>db.close());return db;}
function body(p,patch={}){return {name:p.name,binPrefix:p.binPrefix,network:p.network,currency:p.currency,platform:p.platform,upstreamProductId:p.upstreamProductId||'',status:p.status,maxCards:p.maxCards,description:p.description,internalNote:p.internalNote,revision:p.revision,...patch};}
function opening(db,key='DEMO-open',patch={}){const s=portalState(db,ns),p=binProduct(db,ns,pid);return {requestId:key,revision:s.revision,action:{type:'open',name:'Demo BIN Card',productId:pid,productRevision:p.revision,...patch}};}
test('BIN catalogs seed once, paginate, permit multiple products per prefix and hide internal metadata',t=>{
 const db=setup(t);seedBins(db,ns);assert.equal(binsList(db,ns).total,3);
 const p=binProduct(db,ns,pid);saveBin(db,ns,null,body(p,{name:'同BIN其他产品',status:'draft'}));assert.equal(binsList(db,ns,{keyword:p.binPrefix}).total,2);
 assert.equal(binsList(db,ns,{},true).total,3);assert.equal(binsList(db,ns,{status:'draft'},true).total,0);assert.equal(binsList(db,ns,{pageSize:1,page:1}).rows.length,1);
 for(const r of binsList(db,ns,{},true).rows){for(const f of ['internalNote','upstreamProductId','platform'])assert.ok(!(f in r));assert.ok(/^\d{6}(\d{2})?$/.test(r.binPrefix));}
 assert.throws(()=>saveBin(db,ns,null,body(p,{binPrefix:'9'.repeat(16)})),/完整卡号/);
 assert.throws(()=>saveBin(db,ns,null,body(p,{currency:'EUR'})),/USD/);
});
test('Opening uses authoritative product, persists snapshot and links, preserves zero balance and idempotency',t=>{
 const db=setup(t),before=portalState(db,ns),request=opening(db),result=portalAction(db,ns,request);
 const card=result.state.cards.find(c=>c.id===result.id);assert.equal(card.binProduct.id,pid);assert.equal(card.binProduct.binPrefix,'990001');assert.equal(card.balance,0);assert.equal(result.state.balance,before.balance);assert.match(card.last4,/^\d{4}$/);
 assert.equal(binProduct(db,ns,pid).issuedCount,1);assert.equal(db.prepare('SELECT count(*) n FROM bin_card_links').get().n,1);
 const replay=portalAction(db,ns,request);assert.equal(replay.id,result.id);assert.equal(binProduct(db,ns,pid).issuedCount,1);
 const p=binProduct(db,ns,pid);saveBin(db,ns,pid,body(p,{name:'新名称',status:'paused'}));assert.equal(portalState(db,ns).cards.find(c=>c.id===card.id).binProduct.name,card.binProduct.name);assert.equal(portalState(db,ns).cards.find(c=>c.id===card.id).frozen,false);
 assert.throws(()=>saveBin(db,ns,pid,body(binProduct(db,ns,pid),{binPrefix:'990009'})),/发行标识/);
 assert.equal(consoleRead(db,ns,'audit',{action:'bin.update'}).rows[0].targetType,'bins');
});
test('Server rejects missing/forged/stale/paused/archived products and enforces per-product quota atomically',t=>{
 const db=setup(t);let request=opening(db);assert.throws(()=>portalAction(db,ns,{...request,action:{type:'open',name:'x'}}),/请选择/);
 assert.throws(()=>portalAction(db,ns,{...request,action:{...request.action,binPrefix:'990099'}}),/Unexpected/);
 saveBin(db,ns,pid,body(binProduct(db,ns,pid),{maxCards:1}));assert.throws(()=>portalAction(db,ns,request),/配置已更新/);
 const r=portalAction(db,ns,opening(db));assert.throws(()=>portalAction(db,ns,opening(db,'DEMO-over-quota')),/数量限制/);assert.equal(portalState(db,ns).revision,r.state.revision);
 saveBin(db,ns,pid,body(binProduct(db,ns,pid),{status:'paused'}));assert.throws(()=>portalAction(db,ns,opening(db,'DEMO-paused')),/暂停/);
 saveBin(db,ns,pid,body(binProduct(db,ns,pid),{status:'archived'}));assert.ok(!binsList(db,ns,{},true).rows.some(p=>p.id===pid));assert.throws(()=>saveBin(db,ns,pid,body(binProduct(db,ns,pid),{status:'active'})),/归档/);
 assert.ok(!binsList(db,ns).rows.some(p=>p.id===pid));
 assert.equal(binsList(db,ns,{status:'archived'}).rows[0].id,pid);
 assert.equal(binProduct(db,ns,pid).issuedCount,1);
 assert.equal(portalState(db,ns).cards.find(c=>c.id===r.id).binProduct.id,pid);
});
test('Legacy cards remain unassociated; new card BIN and product filters agree with saved snapshots',t=>{
 const db=setup(t);assert.ok(portalState(db,ns).cards.every(c=>!c.binProduct));const r=portalAction(db,ns,opening(db));
 assert.deepEqual(filterCards(r.state.cards,readCardQuery(new URLSearchParams(`productId=${pid}`))).map(c=>c.id),[r.id]);
 assert.deepEqual(filterCards(r.state.cards,readCardQuery(new URLSearchParams('q=990001'))).map(c=>c.id),[r.id]);
});
test('Product edits use optimistic versions and namespace cleanup preserves other catalogs',t=>{
 const db=setup(t),p=binProduct(db,ns,pid);saveBin(db,ns,pid,body(p,{description:'updated'}));assert.throws(()=>saveBin(db,ns,pid,body(p)),/已更新/);
 importDemo(db,{namespace:'bin-other',persist:false});seedBins(db,'bin-other');portalAction(db,ns,opening(db));cleanDemo(db,ns,{persist:false});assert.equal(db.prepare('SELECT count(*) n FROM bin_card_links WHERE namespace=?').get(ns).n,0);assert.equal(binsList(db,'bin-other').total,3);
});
test('Public client catalog is sanitized while management writes require operator and local Origin',async t=>{
 const db=setup(t),server=createDemoServer(db);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo/`,cookie=`adsflow_demo_ops=${createSession(db,ns,'operator','demo-operator')}`;
 const client=await (await fetch(base+'portal/bin-products')).json();assert.equal(client.data.total,3);assert.ok(!JSON.stringify(client).includes('internalNote'));
 assert.equal((await fetch(base+'management/bins')).status,401);
 const payload=JSON.stringify(body(binProduct(db,ns,pid),{status:'paused'}));assert.equal((await fetch(base+'management/bins/'+pid,{method:'POST',headers:{Cookie:cookie,Origin:'https://external.example'},body:payload})).status,403);
 assert.equal((await fetch(base+'management/bins/'+pid,{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:8850'},body:payload})).status,200);
 assert.equal((await (await fetch(base+'portal/bin-products?keyword=990001')).json()).data.rows[0].status,'paused');
});

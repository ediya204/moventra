import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {openStore,importDemo,counts,cleanDemo,rollback,listRecords,getDetail,summary,receiveEvent,assertLocal} from '../demo-server/slash/store.mjs';
import {NAMESPACE,definitions,generateScenario} from '../demo-server/slash/generate.mjs';
import {safeSource,balanceOf,decimal,dto} from '../demo-server/slash/model.mjs';
import {createDemoServer} from '../demo-server/slash/server.mjs';
const schemas=JSON.parse(readFileSync(new URL('../demo-server/slash/official-schema.json',import.meta.url),'utf8')).schemas;
const db=openStore(':memory:');importDemo(db,{persist:false});
const sid=n=>`S${String(n).padStart(2,'0')}-R001`;
const tid=(n,suffix='T1')=>`DEMO-SLASH-${sid(n)}-${suffix}`;
function check(value,schema,path){
 if(schema.$ref)return check(value,schemas[schema.$ref.split('/').at(-1)],path);
 if(value===null&&schema.nullable)return;
 if(schema.type){const actual=Array.isArray(value)?'array':typeof value;assert.equal(actual,schema.type==='integer'?'number':schema.type,path);}
 if(schema.enum)assert.ok(schema.enum.includes(value),`${path}: ${value} is not an official enum`);
 if(schema.required)for(const k of schema.required)assert.notEqual(value[k],undefined,`${path}.${k} required`);
 if(schema.type==='object')for(const [k,v]of Object.entries(value))if(schema.properties?.[k])check(v,schema.properties[k],`${path}.${k}`);
 if(schema.items)for(let i=0;i<value.length;i++)check(value[i],schema.items,`${path}[${i}]`);
 if(schema.format==='date-time')assert.ok(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)&&!Number.isNaN(Date.parse(value)),path);
}
test('Generated transactions/cards/fees/virtual accounts satisfy official schema excerpts',()=>{
 for(let n=1;n<=20;n++){
  const d=generateScenario(n);
  for(const r of [...d.records,...d.versions]){
   const name={transaction:'Transaction',card:'Card',fee:'FeeTransaction',virtualAccount:'VirtualAccountModel',account:'Account'}[r.kind];
   // Account whitelist intentionally omits routing and account numbers; validate full synthetic fixture shape.
   if(name)check(r.kind==='account'?{...r.source,accountNumber:'DEMO-NOT-ROUTABLE',routingNumber:'DEMO-NOT-ROUTABLE'}:r.source,schemas[name],`${sid(n)}.${name}`);
   if(r.kind==='transaction'){assert.ok(Number.isSafeInteger(r.source.amountCents));assert.match(r.source.date,/Z$/);}
  }
 }
});
test('All scenario final posted/available amounts independently match stated expectations',()=>{
 for(let n=1;n<=20;n++){
  const account=getDetail(db,NAMESPACE,'account',tid(n,'ACCOUNT'));const balance=account.balances[0].source;
  assert.equal(balance.posted.amountCents,100000+definitions[n-1][1],sid(n));
  assert.equal(balance.available.amountCents,100000+definitions[n-1][1]-definitions[n-1][2],sid(n));
  const tx=listRecords(db,NAMESPACE,'transaction',{scenario:sid(n)}).rows;
  const posted=tx.filter(t=>t.source.status==='posted').reduce((a,t)=>a+BigInt(t.source.amountCents),0n);
  const adjustments=db.prepare('SELECT amount_cents FROM internal_adjustments WHERE namespace=? AND scenario_id=?').all(NAMESPACE,sid(n));
  const net=posted+adjustments.reduce((a,x)=>a+BigInt(x.amount_cents),0n);
  assert.equal(net,BigInt(definitions[n-1][1]),sid(n));
 }
});
test('Authorization hold is released without double debit; under/over capture and partial reversal',()=>{
 for(const [n,final]of [[1,90000],[2,92000],[3,88000]]){
  const snap=getDetail(db,NAMESPACE,'transaction',tid(n)).snapshots;
  assert.equal(snap[1].posted_cents,100000);assert.equal(snap[1].available_cents,90000);
  assert.equal(snap.at(-1).posted_cents,final);assert.equal(snap.at(-1).available_cents,final);
 }
 const partial=getDetail(db,NAMESPACE,'transaction',tid(7)).snapshots;assert.deepEqual(partial.map(b=>b.available_cents),[100000,90000,94000]);
 assert.equal(balanceOf([{amountCents:-10000,status:'pending',detailedStatus:'pending_approval'}]).available,100000);
});
test('Multiple refunds remain independent and trace back to original purchase',()=>{
 const result=listRecords(db,NAMESPACE,'transaction',{scenario:sid(12)});assert.equal(result.total,3);
 const purchase=result.rows.find(r=>r.id.endsWith('-T1'));assert.equal(purchase.source.amountCents,-10000);
 const refunds=result.rows.filter(r=>r.source.detailedStatus==='refund');assert.deepEqual(refunds.map(r=>r.source.amountCents),[2000,3000]);
 for(const refund of refunds){const d=getDetail(db,NAMESPACE,'transaction',refund.id);assert.equal(d.relations[0].to_id,purchase.id);assert.equal(d.relations[0].confirmation,'待Slash确认');}
 assert.equal(getDetail(db,NAMESPACE,'transaction',tid(13,'REF1')).source.status,'failed');
});
test('FX fee and cashback metadata do not cause a second ledger entry',()=>{
 const fx=getDetail(db,NAMESPACE,'transaction',tid(15));assert.equal(fx.source.amountCents,-11000);assert.equal(fx.source.originalCurrency.amountCents,-10000);assert.equal(fx.source.originalCurrency.code,'EUR');assert.equal(fx.source.fxFeeInfo.amountCents,220);
 assert.equal(fx.fees[0].source.feeAmountCents,220);assert.equal(fx.balances[0].source.posted.amountCents,88780);
 const rewards=getDetail(db,NAMESPACE,'transaction',tid(16));assert.equal(rewards.source.cashbackInfo.amountCents,200);assert.equal(rewards.balances[0].source.posted.amountCents,90150);
});
test('Duplicate and out-of-order webhook delivery does not roll back projection',()=>{
 const deliveries=db.prepare('SELECT result FROM event_deliveries WHERE namespace=? AND source_id LIKE ?').all(NAMESPACE,`DEMO-SLASH-${sid(18)}-%`).map(d=>d.result);
 for(const required of ['duplicate_ignored','stale_response_ignored','resync_without_notification'])assert.ok(deliveries.includes(required),required);
 for(const k of ['T1','T2','T3']){const detail=getDetail(db,NAMESPACE,'transaction',tid(18,k));assert.equal(detail.source.status,'posted');assert.equal(detail.internal.version,2);assert.equal(detail.versions.length,2);}
 const [old,current]=generateScenario(18).versions.slice(0,2);const event={event:'aggregated_transaction.update',eventId:'DEMO-NEW-ID',entityId:old.entityId,eventTimestamp:old.collectedAt,sourceId:old.source.id,collectedAt:old.collectedAt};
 assert.equal(receiveEvent(db,NAMESPACE,event,old,old.version,'DEMO-LATE-REPLAY'),'stale_response_ignored');
 assert.equal(getDetail(db,NAMESPACE,'transaction',current.source.id).source.status,'posted');
});
test('Cross-month refunds use posting date, distinct from authorization date',()=>{
 const august=listRecords(db,NAMESPACE,'transaction',{scenario:sid(17),from:'2026-08-01',to:'2026-08-31',status:'posted'});
 const september=listRecords(db,NAMESPACE,'transaction',{scenario:sid(17),from:'2026-09-01',to:'2026-09-30',status:'posted'});
 assert.equal(august.rows[0].source.amountCents,-10000);assert.equal(september.rows[0].source.amountCents,2500);
 assert.equal(august.rows[0].source.authorizedAt,'2026-07-31T23:50:00.000Z');
 assert.equal(listRecords(db,NAMESPACE,'transaction',{scenario:sid(17),from:'2026-07-01',to:'2026-07-31',timeBasis:'authorizedAt'}).total,1);
});
test('Backend filtering, sort, pagination, details and summaries are consistent',()=>{
 const all=listRecords(db,NAMESPACE,'transaction',{pageSize:100,sort:'amount',order:'asc'});
 assert.equal(all.total,33);assert.deepEqual(all.rows.map(r=>r.source.amountCents),all.rows.map(r=>r.source.amountCents).sort((a,b)=>a-b));
 assert.equal(listRecords(db,NAMESPACE,'transaction',{pageSize:10,page:1,sort:'amount',order:'asc'}).rows[0].id,all.rows[10].id);
 const net=all.rows.filter(r=>r.source.status==='posted').reduce((s,r)=>s+BigInt(r.source.amountCents),0n);assert.equal(BigInt(summary(db).totals[0].postedNetCents),net);
 for(const r of all.rows)assert.deepEqual(getDetail(db,NAMESPACE,'transaction',r.id).source,r.source);
 assert.equal(listRecords(db,NAMESPACE,'transaction',{originalCurrency:'EUR'}).total,1);
 assert.equal(listRecords(db,NAMESPACE,'transaction',{keyword:'DEMO-ORDER-S12'}).total,3);
 assert.equal(listRecords(db,NAMESPACE,'transaction',{status:"posted' OR 1=1 --"}).total,0);
 assert.ok(listRecords(db,NAMESPACE,'transaction',{risk:'1'}).rows.every(r=>r.internal.matchingStatus!=='demo_verified'));
});
test('Missing optional fields, true zero and unknown enums remain distinguishable',()=>{
 const zero=getDetail(db,NAMESPACE,'transaction',tid(20));assert.equal(zero.source.amountCents,0);assert.equal(zero.source.authorizedAt,undefined);assert.equal(zero.source.originalCurrency,undefined);assert.equal(zero.amount,'0.00');
 assert.throws(()=>balanceOf([{amountCents:100,status:'new_status'}]),/Unknown source status/);
 assert.equal(decimal(null),null);assert.equal(decimal(-101),'-1.01');
 const legacy={namespace:'test',platform:'other',entity_id:'e',source_id:'legacy',kind:'transaction',source_json:JSON.stringify({status:'upstream_new',detailedStatus:'future'}),internal_json:'{}',version:1};
 const projected=dto(legacy);assert.equal(projected.amount,null);assert.equal(projected.statusLabel,'未知状态 (upstream_new)');assert.equal(projected.source.detailedStatus,'future');
 assert.equal(getDetail(db,NAMESPACE,'transaction',tid(9)).internal.matchingStatus,'unmatched');
});
test('Whitelist strips sensitive values at every nested supported boundary',()=>{
 const card=safeSource('card',{id:'demo',pan:'sensitive',cvv:'sensitive',apiKey:'sensitive',mleSecret:'sensitive',spendingConstraint:{spendingRule:{utilizationLimitV2:[{preset:'monthly',limitAmount:{amountCents:100,cvv:'sensitive'},pan:'sensitive'}]}}});
 assert.ok(!JSON.stringify(card).includes('sensitive'));
 const fee=safeSource('fee',{id:'demo',card:{pan:'sensitive',cvv:'sensitive'},originalTransaction:{memo:'safe',merchantData:{description:'demo',categoryCode:'0000',location:{pan:'sensitive'}}},otp:'sensitive'});
 assert.ok(!JSON.stringify(fee).includes('sensitive'));
});
test('Deterministic namespace import, scale, isolated cleanup and rollback',()=>{
 const temp=openStore(':memory:');importDemo(temp,{persist:false});const before=counts(temp);importDemo(temp,{persist:false});assert.deepEqual(counts(temp),before);
 importDemo(temp,{namespace:'other-demo',replicas:2,batchSize:7,persist:false});assert.equal(counts(temp,'other-demo').scenarios,40);assert.throws(()=>importDemo(temp,{seed:99,persist:false}),/different seed/);
 cleanDemo(temp,'other-demo',{persist:false});assert.deepEqual(counts(temp),before);assert.throws(()=>rollback(temp),/Clean all/);
 // In-memory cleanup only SQL; avoid deleting the real default fixture batch in this test.
 temp.prepare('DELETE FROM demo_batches WHERE namespace=?').run(NAMESPACE);rollback(temp);assert.equal(temp.prepare("SELECT count(*) n FROM sqlite_master WHERE name='source_records'").get().n,0);temp.close();
});
test('Production and remote targets rejected before opening storage',()=>{
 for(const env of [{NODE_ENV:'production'},{ADSFLOW_ENV:'prod'},{DATABASE_URL:'postgres://db.example.com/live'},{VITE_API_PROXY_TARGET:'https://api.slash.com'}])assert.throws(()=>assertLocal(env),/Refusing Demo write/);
 assert.doesNotThrow(()=>assertLocal({VITE_API_PROXY_TARGET:'http://127.0.0.1:8862'}));
});
test('HTTP list/detail/filter/export and empty behavior use the same local projection',async()=>{
 const server=createDemoServer(db);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo`;
 try{
  const body=await(await fetch(`${base}/transactions?scenario=${sid(15)}`)).json();assert.equal(body.data.total,2);
  const detail=await(await fetch(`${base}/transactions/${tid(15)}`)).json();assert.equal(detail.data.source.originalCurrency.code,'EUR');
  const csv=await(await fetch(`${base}/transactions.csv?scenario=${sid(12)}`)).text();assert.equal(csv.trim().split('\r\n').length,4);assert.ok(csv.includes('"refund"'));
  const empty=await(await fetch(`${base}/transactions?keyword=NO_SUCH_DEMO`)).json();assert.equal(empty.data.total,0);
  for(const endpoint of ['cards','accounts','balances']){const exported=await(await fetch(`${base}/${endpoint}.csv`)).text();assert.equal(exported.trim().split('\r\n').length,21);assert.ok(!exported.includes('cvv'));}
  assert.equal((await fetch(`${base}/transactions/does-not-exist`)).status,404);
  assert.equal((await fetch(`${base}/transactions`,{method:'POST'})).status,405);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Every account/virtual account/card/fee reference resolves within its entity and scenario',()=>{
 const rows=db.prepare('SELECT * FROM source_records WHERE namespace=?').all(NAMESPACE).map(dto);
 for(const r of rows){const s=r.source;
  for(const [field,kind]of [['accountId','account'],['virtualAccountId','virtualAccount'],['cardId','card']])if(s[field]){
   const parent=rows.find(p=>p.kind===kind&&p.id===s[field]&&p.internal.entityId===r.internal.entityId);assert.ok(parent,`${r.id}.${field}`);assert.equal(parent.internal.scenarioId,r.internal.scenarioId);
   if(s.date&&parent.source.createdAt)assert.ok(parent.source.createdAt<=s.date,`${field} must precede transaction`);
  }
  if(r.kind==='balance'){assert.equal(s.type,'debit');assert.ok(Number.isSafeInteger(s.available.amountCents));assert.ok(Number.isSafeInteger(s.posted.amountCents));assert.match(s.timestamp,/Z$/);}
  if(r.kind==='fee'){const original=rows.find(t=>t.kind==='transaction'&&t.id===s.originalTransaction.id);assert.ok(original);assert.equal(original.source.accountId,s.accountId);}
 }
 const events=db.prepare('SELECT * FROM source_events WHERE namespace=?').all(NAMESPACE);for(const e of events){assert.ok(['aggregated_transaction.create','aggregated_transaction.update'].includes(e.event));assert.ok(rows.some(r=>r.kind==='transaction'&&r.id===e.source_id));}
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('Source identity collision requires explicit entity scope and legacy nullable fields are preserved',()=>{
 const temp=openStore(':memory:');importDemo(temp,{persist:false});
 const row=temp.prepare('SELECT * FROM source_records WHERE kind=? AND source_id=?').get('transaction',tid(20));
 const columns=Object.keys(row);temp.prepare(`INSERT INTO source_records(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(k=>k==='entity_id'?'DEMO-ENTITY-002':row[k]));
 assert.throws(()=>getDetail(temp,NAMESPACE,'transaction',tid(20)),/scope required/);
 assert.equal(getDetail(temp,NAMESPACE,'transaction',tid(20),{entityId:'DEMO-ENTITY-001',platform:'slash'}).source.amountCents,0);
 temp.close();
});
test('Account list balances match details, keep zero/missing and isolate entity/platform scopes',async()=>{
 const temp=openStore(':memory:');importDemo(temp,{persist:false});
 const accountId=tid(1,'ACCOUNT');
 const row=temp.prepare("SELECT * FROM source_records WHERE kind='balance' AND account_id=?").get(accountId);
 const columns=Object.keys(row),insert=temp.prepare(`INSERT INTO source_records(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
 for(const [suffix,entity,platform,currency,type,value]of [
  ['credit',row.entity_id,row.platform,'USD','credit',0],
  ['eur',row.entity_id,row.platform,'EUR','cash',12345],
  ['foreign','DEMO-OTHER-ENTITY',row.platform,'USD','debit',999999],
  ['provider',row.entity_id,'other','USD','debit',888888],
 ]){
  const source={...JSON.parse(row.source_json),type,available:{amountCents:value}};
  const clone={...row,source_id:`DEMO-BALANCE-${suffix}`,entity_id:entity,platform,source_json:JSON.stringify(source),currency,internal_json:JSON.stringify({...JSON.parse(row.internal_json),currency})};
  insert.run(...columns.map(k=>clone[k]));
 }
 const result=listRecords(temp,NAMESPACE,'account',{keyword:accountId,pageSize:1});
 assert.equal(result.total,1);assert.equal(result.rows.length,1);
 const balances=result.rows[0].balances;
 assert.equal(balances.length,3);
 assert.deepEqual(balances.map(b=>b.source.available.amountCents).sort((a,b)=>a-b),[0,12345,90000]);
 assert.deepEqual(balances.map(b=>b.id).sort(),getDetail(temp,NAMESPACE,'account',accountId).balances.map(b=>b.id).sort());
 assert.equal(result.rows[0].internal.email,'demo.s01-r001@example.com');
 const server=createDemoServer(temp);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const base=`http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo`;
  const list=await(await fetch(`${base}/accounts?keyword=${accountId}`)).json();
  assert.equal(list.data.rows[0].balances.length,3);
  const csv=await(await fetch(`${base}/accounts.csv?keyword=${accountId}`)).text();
  assert.match(csv,/email,balanceType,balanceId/);assert.match(csv,/demo.s01-r001@example.com/);
  assert.equal(csv.trim().split('\r\n').length,4);assert.doesNotMatch(csv,/999999|888888/);
  temp.prepare("DELETE FROM source_records WHERE kind='balance' AND account_id=? AND entity_id=? AND platform=?").run(accountId,row.entity_id,row.platform);
  assert.deepEqual(listRecords(temp,NAMESPACE,'account',{keyword:accountId}).rows[0].balances,[]);
 }finally{await new Promise(resolve=>server.close(resolve));temp.close();}
});

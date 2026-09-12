import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {safeSource,cents,dto} from './model.mjs';
import {NAMESPACE,AS_OF,definitions,generateScenario} from './generate.mjs';
export const DATA_DIR=fileURLToPath(new URL('./data/',import.meta.url));
export function assertLocal(env=process.env){
 if(env.NODE_ENV==='production'||/prod/i.test(env.ADSFLOW_ENV||''))throw new Error('Refusing Demo write: production configuration');
 for(const k of ['DATABASE_URL','SLASH_API_BASE_URL','SLASH_BASE_URL','ADSFLOW_API_BASE_URL','VITE_API_PROXY_TARGET']){
  if(!env[k])continue;
  let u;try{u=new URL(env[k]);}catch{throw new Error(`Refusing Demo write: invalid ${k}`);}
  if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error(`Refusing Demo write: non-local ${k}`);
 }
}
export function openStore(path=join(DATA_DIR,'projection.sqlite')){
 assertLocal();if(path!==':memory:'){if(!resolve(path).startsWith(resolve(DATA_DIR)+'/'))throw new Error('Only fixed local Demo directory is writable');mkdirSync(DATA_DIR,{recursive:true});}
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
 db.exec(readFileSync(new URL('./migrations/001_source_projection.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(1,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/002_unified_portal.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(2,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/003_user_management.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(3,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/004_admin_console.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(4,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/005_card_bins.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(5,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/006_card_channels.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(6,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/007_cross_currency.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(7,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/008_unified_card_transactions.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(8,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/009_card_administration.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(9,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/010_crypto_finance.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(10,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/011_finance_approval_policy.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(11,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/012_finance_fixed_pricing.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(12,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/013_internal_card_ownership.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(13,?)').run(AS_OF);
 db.exec(readFileSync(new URL('./migrations/014_card_unfreeze_requests.sql',import.meta.url),'utf8'));
 db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(14,?)').run(AS_OF);return db;
}
export function validateSource(kind,s){
 if(kind==='transaction'){
  for(const k of ['id','date','description','amountCents','status','detailedStatus','accountId','accountSubtype'])if(s[k]==null)throw new Error(`Missing ${k}`);
  cents(s.amountCents);if(s.originalCurrency)cents(s.originalCurrency.amountCents);
 }
 // Nullable optional fields remain absent; strict generated-fixture schema validation is in tests.
}
export function putRecord(db,namespace,record,version=1,collectedAt=AS_OF){
 const source=safeSource(record.kind,record.source);validateSource(record.kind,source);
 const id=record.id||source.id||`${source.accountId}-BALANCE`,entity=record.entityId;
 const existing=db.prepare('SELECT version FROM source_records WHERE namespace=? AND platform=? AND entity_id=? AND kind=? AND source_id=?').get(namespace,'slash',entity,record.kind,id);
 if(existing&&existing.version>=version)return false;
 const fields=['namespace','platform','entity_id','source_id','kind','scenario_id','source_json','internal_json','account_id','virtual_account_id','card_id','status','detailed_status','signed_amount_cents','currency','original_currency','original_amount_cents','conversion_rate_decimal','source_date','authorized_at','account_subtype','order_id','reference_number','authorization_id','mcc','version'];
 const internal={customerId:record.internal.customerId,customerName:record.internal.customerName,email:record.internal.email,firstCollectedAt:record.internal.firstCollectedAt,lastSyncedAt:record.internal.lastSyncedAt,syncError:record.internal.syncError,matchingStatus:record.internal.matchingStatus,assumption:record.internal.assumption,...(record.internal.openingBalanceCents!=null?{openingBalanceCents:record.internal.openingBalanceCents}:{}),...(record.internal.currency?{currency:record.internal.currency}:{})};
 const values=[namespace,'slash',entity,id,record.kind,record.internal.scenarioId,JSON.stringify(source),JSON.stringify(internal),source.accountId,source.virtualAccountId,source.cardId,source.status,source.detailedStatus,source.amountCents,record.kind==='transaction'?'USD':null,source.originalCurrency?.code,source.originalCurrency?.amountCents,source.originalCurrency?String(source.originalCurrency.conversionRate):null,source.date,source.authorizedAt,source.accountSubtype,source.orderId,source.referenceNumber,source.providerAuthorizationId,source.merchantData?.categoryCode,version].map(v=>v??null);
 db.prepare(`INSERT INTO source_records(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')}) ON CONFLICT(namespace,platform,entity_id,kind,source_id) DO UPDATE SET ${fields.slice(5).map(k=>`${k}=excluded.${k}`).join(',')}`).run(...values);
 db.prepare('INSERT OR IGNORE INTO source_versions VALUES(?,?,?,?,?,?,?,?)').run(namespace,'slash',entity,record.kind,id,version,JSON.stringify(source),collectedAt);
 return true;
}
export function receiveEvent(db,namespace,event,record,version,deliveryId,receivedAt=AS_OF){
 const seen=event&&db.prepare('SELECT 1 FROM source_events WHERE namespace=? AND entity_id=? AND event_id=?').get(namespace,event.entityId,event.eventId);
 if(event&&!seen)db.prepare('INSERT INTO source_events VALUES(?,?,?,?,?,?,?)').run(namespace,event.entityId,event.eventId,event.event,event.eventTimestamp,event.sourceId,event.collectedAt);
 const result=seen?'duplicate_ignored':putRecord(db,namespace,record,version,receivedAt)?event?'applied':'resync_without_notification':'stale_response_ignored';
 db.prepare('INSERT OR IGNORE INTO event_deliveries VALUES(?,?,?,?,?,?)').run(namespace,deliveryId,event?.eventId||null,record.id||record.source.id,receivedAt,result);return result;
}
function insert(db,table,values){db.prepare(`INSERT OR IGNORE INTO ${table} VALUES(${values.map(()=>'?').join(',')})`).run(...values);}
export function importScenario(db,namespace,data){
 const s=data.scenario;insert(db,'scenarios',[namespace,s.id,s.title,s.description,s.expectedNetCents,s.expectedHoldCents,s.confirmation]);
 for(const r of data.records.filter(r=>r.kind!=='transaction'))putRecord(db,namespace,r);
 // Actual ingestion exercises duplicates, late responses and repair sync, rather than only labelling them.
 if(s.id.startsWith('S18')){
  for(const suffix of ['T1','T2','T3']){
   const versions=data.versions.filter(v=>v.source.id.endsWith(`-${suffix}`));const [pending,posted]=versions;
   const events=data.events.filter(e=>e.sourceId===pending.source.id);const ev=(v)=>events.find(e=>e.eventTimestamp===v.collectedAt);
   if(suffix==='T2'){receiveEvent(db,namespace,ev(posted),posted,posted.version,`${s.id}-${suffix}-1`);receiveEvent(db,namespace,ev(pending),pending,pending.version,`${s.id}-${suffix}-2`);}
   else{receiveEvent(db,namespace,ev(pending),pending,pending.version,`${s.id}-${suffix}-1`);receiveEvent(db,namespace,ev(posted),posted,posted.version,`${s.id}-${suffix}-2`);if(suffix==='T1')receiveEvent(db,namespace,ev(posted),posted,posted.version,`${s.id}-${suffix}-3`);}
  }
  // Preserve even stale historical observations independently of the current projection.
  for(const v of data.versions)insert(db,'source_versions',[namespace,'slash',v.entityId,v.kind,v.source.id,v.version,JSON.stringify(safeSource(v.kind,v.source)),v.collectedAt]);
 }else{
  for(const v of data.versions)putRecord(db,namespace,v,v.version,v.collectedAt);
  for(const e of data.events)insert(db,'source_events',[namespace,e.entityId,e.eventId,e.event,e.eventTimestamp,e.sourceId,e.collectedAt]);
  for(const d of data.deliveries)insert(db,'event_deliveries',[namespace,d.id,d.eventId,d.sourceId,d.receivedAt,d.result]);
 }
 for(const r of data.relations)insert(db,'internal_relations',[namespace,r.id,r.scenarioId,r.fromId,r.toId,r.type,r.evidence,r.confirmation]);
 for(const a of data.adjustments)insert(db,'internal_adjustments',[namespace,a.id,a.scenarioId,a.accountId,a.sourceId,a.amountCents,a.occurredAt,a.reason,a.confirmation]);
 for(const b of data.snapshots)insert(db,'balance_snapshots',[namespace,b.id,b.scenarioId,b.accountId,b.currency,b.type,b.availableCents,b.postedCents,b.timestamp,b.step]);
}
export function importDemo(db,{namespace=NAMESPACE,seed=20260906,replicas=1,batchSize=20,persist=true}={}){
 assertLocal();if(!/^[a-z][a-z0-9-]{2,60}$/.test(namespace))throw new Error('Invalid namespace');
 if(!Number.isSafeInteger(seed)||seed<0)throw new Error('Seed must be a nonnegative safe integer');
 if(!Number.isInteger(replicas)||replicas<1||replicas>5000||!Number.isInteger(batchSize)||batchSize<1||batchSize>200)throw new Error('Invalid scale (replicas 1..5000, batch size 1..200)');
 const old=db.prepare('SELECT seed FROM demo_batches WHERE namespace=?').get(namespace);if(old&&old.seed!==seed)throw new Error('Namespace already belongs to a different seed');
 insert(db,'demo_batches',[namespace,seed,AS_OF]);let pending=[];let count=0;
 const flush=()=>{db.exec('BEGIN');try{for(const d of pending)importScenario(db,namespace,d);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}pending=[];};
 for(let r=1;r<=replicas;r++)for(let i=1;i<=definitions.length;i++){
  const data=generateScenario(i,r,seed);
  if(persist){const folder=join(DATA_DIR,namespace);mkdirSync(folder,{recursive:true});const path=join(folder,`${data.scenario.id}.json`);if(existsSync(path)&&readFileSync(path,'utf8')!==JSON.stringify({namespace,seed,...data}))throw new Error('Fixture differs from generator; use a new namespace or clean only this batch before reimport');if(!existsSync(path)){writeFileSync(`${path}.tmp`,JSON.stringify({namespace,seed,...data}));renameSync(`${path}.tmp`,path);}}
  pending.push(data);count++;if(pending.length>=batchSize)flush();
 }if(pending.length)flush();return {namespace,seed,requestedScenarios:count,...counts(db,namespace)};
}
export function counts(db,ns=NAMESPACE){return Object.fromEntries(['scenarios','source_records','source_versions','source_events','event_deliveries','internal_relations','internal_adjustments','balance_snapshots'].map(t=>[t,db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE namespace=?`).get(ns).n]));}
export function cleanDemo(db,namespace=NAMESPACE,{persist=true}={}){assertLocal();if(!/^[a-z][a-z0-9-]{2,60}$/.test(namespace))throw new Error('Invalid namespace');db.prepare('DELETE FROM demo_batches WHERE namespace=?').run(namespace);if(persist)rmSync(join(DATA_DIR,namespace),{recursive:true,force:true});}
export function rollback(db){if(db.prepare('SELECT COUNT(*) AS n FROM demo_batches').get().n)throw new Error('Clean all Demo batches before rolling back schema');db.exec(readFileSync(new URL('./migrations/012_finance_fixed_pricing.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/011_finance_approval_policy.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/010_crypto_finance.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/009_card_administration.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/008_unified_card_transactions.down.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./migrations/007_cross_currency.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/006_card_channels.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/005_card_bins.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/004_admin_console.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/003_user_management.down.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/001_source_projection.down.sql',import.meta.url),'utf8'));}
const sortFields={id:'source_id',amount:'signed_amount_cents',date:'source_date',authorizedAt:'authorized_at',status:'status',detailedStatus:'detailed_status',originalCurrency:'original_currency',createdAt:"json_extract(source_json,'$.createdAt')",timestamp:"json_extract(source_json,'$.timestamp')",available:"json_extract(source_json,'$.available.amountCents')",posted:"json_extract(source_json,'$.posted.amountCents')"};
export function listRecords(db,ns,kind,q={}){
 let sql='namespace=? AND kind=?';const args=[ns,kind];
 const eq={status:'status',detailedStatus:'detailed_status',platform:'platform',entityId:'entity_id',currency:'currency',originalCurrency:'original_currency',accountSubtype:'account_subtype',accountId:'account_id',virtualAccountId:'virtual_account_id',cardId:'card_id',scenario:'scenario_id',orderId:'order_id',referenceNumber:'reference_number',providerAuthorizationId:'authorization_id',mcc:'mcc'};
 for(const [param,column]of Object.entries(eq))if(q[param]){sql+=` AND ${column}=?`;args.push(q[param]);}
 if(q.risk==='1'){sql+=" AND (json_extract(internal_json,'$.matchingStatus') IS NULL OR json_extract(internal_json,'$.matchingStatus')!='demo_verified')";}
 if(q.matchingStatus){sql+=" AND json_extract(internal_json,'$.matchingStatus')=?";args.push(q.matchingStatus);}
 if(q.keyword){sql+=" AND (instr(lower(source_id),lower(?))>0 OR instr(lower(scenario_id),lower(?))>0 OR instr(lower(source_json),lower(?))>0 OR instr(lower(internal_json),lower(?))>0 OR source_id IN(SELECT source_id FROM source_events WHERE namespace=? AND instr(lower(event_id),lower(?))>0))";const k=String(q.keyword);args.push(k,k,k,k,ns,k);}

 const dateField=q.timeBasis==='authorizedAt'?'authorized_at':'source_date';
 if(q.from){if(!/^\d{4}-\d{2}-\d{2}$/.test(q.from))throw new Error('Invalid from date');sql+=` AND ${dateField}>=?`;args.push(q.from);}
 if(q.to){if(!/^\d{4}-\d{2}-\d{2}$/.test(q.to))throw new Error('Invalid to date');sql+=` AND ${dateField}<?`;args.push(new Date(Date.parse(q.to)+86400000).toISOString().slice(0,10));}
 for(const [key,op]of [['minAmount','>='],['maxAmount','<=']])if(q[key]!=null&&q[key]!==''){cents(Number(q[key]));sql+=` AND signed_amount_cents${op}?`;args.push(Number(q[key]));}
 const page=Math.max(0,Math.min(1000000,Math.trunc(Number(q.page))||0)),pageSize=Math.max(1,Math.min(100,Math.trunc(Number(q.pageSize))||25));
 const total=db.prepare(`SELECT count(*) AS n FROM source_records WHERE ${sql}`).get(...args).n;
 const rows=db.prepare(`SELECT * FROM source_records WHERE ${sql} ORDER BY ${sortFields[q.sort]||'source_id'} ${q.order==='desc'?'DESC':'ASC'},source_id ASC LIMIT ? OFFSET ?`).all(...args,pageSize,page*pageSize).map(dto);
 if(kind==='account'&&rows.length){
  // Enrich only this page. Source account IDs are scoped by namespace, platform and entity.
  const scope=rows.map(()=>'(platform=? AND entity_id=? AND account_id=?)').join(' OR ');
  const balances=db.prepare(`SELECT * FROM source_records WHERE namespace=? AND kind='balance' AND (${scope}) ORDER BY source_id`).all(ns,...rows.flatMap(r=>[r.internal.platform,r.internal.entityId,r.id])).map(dto);
  for(const r of rows)r.balances=balances.filter(b=>b.internal.platform===r.internal.platform&&b.internal.entityId===r.internal.entityId&&b.source.accountId===r.id);
 }
 return {rows,total,page,pageSize};
}
export function getDetail(db,ns,kind,id,scope={}){
 let where='namespace=? AND kind=? AND source_id=?';const parameters=[ns,kind,id];
 for(const [key,column] of [['platform','platform'],['entityId','entity_id']])if(scope[key]){where+=` AND ${column}=?`;parameters.push(scope[key]);}
 const candidates=db.prepare(`SELECT * FROM source_records WHERE ${where} LIMIT 2`).all(...parameters);
 if(candidates.length>1)throw new Error('Ambiguous source ID: platform and entityId scope required');
 const row=candidates[0];if(!row)return null;
 const result=dto(row);const accountId=result.source.accountId||(kind==='account'?id:null);
 const all=(table,where,args)=>db.prepare(`SELECT * FROM ${table} WHERE namespace=? AND ${where}`).all(ns,...args);
 result.versions=all('source_versions','platform=? AND entity_id=? AND kind=? AND source_id=? ORDER BY version',[row.platform,row.entity_id,kind,id]).map(v=>({version:v.version,source:safeSource(kind,JSON.parse(v.source_json)),collectedAt:v.collected_at}));
 result.events=all('source_events','source_id=? ORDER BY event_timestamp,event_id',[id]).map(e=>({event:e.event,eventId:e.event_id,entityId:e.entity_id,eventTimestamp:e.event_timestamp,collectedAt:e.collected_at}));
 result.deliveries=all('event_deliveries','source_id=? ORDER BY received_at',[id]);
 result.relations=all('internal_relations','from_id=? OR to_id=?',[id,id]);
 result.adjustments=all('internal_adjustments','source_id=? ORDER BY occurred_at',[id]);
 result.fees=all('source_records',"kind='fee' AND (source_id=? OR json_extract(source_json,'$.originalTransaction.id')=?)",[id,id]).map(dto);
 result.balances=accountId?all('source_records',"kind='balance' AND account_id=? AND platform=? AND entity_id=?",[accountId,row.platform,row.entity_id]).map(dto):[];
 result.virtualAccounts=accountId?all('source_records',"kind='virtualAccount' AND account_id=?",[accountId]).map(dto):[];
 result.snapshots=accountId?all('balance_snapshots','account_id=? ORDER BY timestamp,id',[accountId]):[];
 return result;
}
export function summary(db,ns=NAMESPACE){
 const totals=db.prepare(`SELECT currency,account_subtype,SUM(CASE WHEN status='posted' THEN signed_amount_cents ELSE 0 END) AS postedNetCents,SUM(CASE WHEN status='posted' AND signed_amount_cents<0 THEN -signed_amount_cents ELSE 0 END) AS postedDebitCents,SUM(CASE WHEN status='posted' AND signed_amount_cents>0 THEN signed_amount_cents ELSE 0 END) AS postedCreditCents,SUM(CASE WHEN status='pending' AND detailed_status!='pending_approval' AND signed_amount_cents<0 THEN -signed_amount_cents ELSE 0 END) AS holdCents,COUNT(*) AS count FROM source_records WHERE namespace=? AND kind='transaction' GROUP BY currency,account_subtype`).all(ns);
 const monthly=db.prepare(`SELECT substr(source_date,1,7) AS month,currency,account_subtype,SUM(signed_amount_cents) AS netCents FROM source_records WHERE namespace=? AND kind='transaction' AND status='posted' GROUP BY month,currency,account_subtype ORDER BY month`).all(ns);
 const adjustments=db.prepare('SELECT substr(occurred_at,1,7) AS month,SUM(amount_cents) AS amountCents FROM internal_adjustments WHERE namespace=? GROUP BY month').all(ns);
 return {totals,monthly,adjustments,counts:counts(db,ns),asOf:AS_OF,timeBasis:'UTC / posted交易按date入账月；内部调整单列',balances:db.prepare("SELECT * FROM source_records WHERE namespace=? AND kind='balance' ORDER BY source_id LIMIT 100").all(ns).map(dto)};
}

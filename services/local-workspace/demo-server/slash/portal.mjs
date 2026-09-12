import {assertPersonalAction,isRetiredNotice} from "../../../../packages/shared/src/portal/personalV1.ts";
import {overlayCardAdmin,clientCardFreeze,clientUnfreezeRequest} from './card-admin.mjs';
import {queryMessages,messageRows} from '../../../../apps/client/src/portal/messageQuery.ts';
import {seedBins,validateOpening} from './bins.mjs';
import {randomUUID,randomInt} from 'node:crypto';
import {initialState,transition} from '../../../../apps/client/src/portal/model.ts';
import {spendingTrend} from '../../../../apps/client/src/portal/chartData.ts';
import {dto} from './model.mjs';

function projectTransactions(db,ns,sourceRows){
 const fees=new Set(sourceRows.filter(r=>r.kind==='fee').map(r=>r.id));
 const refunds=new Set(db.prepare("SELECT from_id FROM internal_relations WHERE namespace=? AND relation_type='refund'").all(ns).map(r=>r.from_id));
 const entries=[];
 for(const r of sourceRows.filter(r=>r.kind==='transaction')){const s=r.source;
  const kind=refunds.has(r.id)||s.detailedStatus==='refund'?'退款':fees.has(r.id)?'费用':s.detailedStatus==='reversed'?'授权撤销':s.detailedStatus==='declined'?'授权拒绝':s.detailedStatus==='canceled'?'授权取消':s.status==='pending'?'授权':'消费';
  entries.push({id:r.id,time:s.date,kind,name:s.merchantData?.description||s.description,amount:s.amountCents,status:s.status==='posted'?'已完成':s.status==='pending'?'处理中':s.status==='failed'?'失败':'未知状态',statusText:`${r.statusLabel} / ${r.detailedStatusLabel}`,card:s.cardId,currency:'USD',slash:r});
 }
 return entries;
}
export function seedPortal(db,ns){
 const existing=db.prepare('SELECT * FROM portal_state WHERE namespace=?').get(ns);if(existing)return;
 let state=initialState();const sourceRows=db.prepare("SELECT * FROM source_records WHERE namespace=? AND scenario_id LIKE '%-R001' AND kind IN('card','transaction','balance','fee')").all(ns).map(dto);
 const balances=sourceRows.filter(r=>r.kind==='balance');
 for(const r of sourceRows.filter(r=>r.kind==='card')){const s=r.source,b=balances.find(b=>b.source.accountId===s.accountId);
  state.cards.push({id:r.id,name:s.name,balance:0,balanceKind:'internal_budget',frozen:s.status!=='active',platform:'Slash',project:r.internal.scenarioId,createdAt:s.createdAt,last4:s.last4,slash:r,sourceBalance:b?.source});
 }
 state.entries.push(...projectTransactions(db,ns,sourceRows));
 const apply=(action,id)=>{state=transition(state,action,id,'2026-09-06 10:00:00');};
 apply({type:'finance/deposit',amount:100_000000},'DEMO-PORTAL-SEED-DEPOSIT');
 for(const event of ['detect','review','complete'])apply({type:'finance/simulate',orderId:'DEMO-PORTAL-SEED-DEPOSIT',event,eventId:`DEMO-PORTAL-DEPOSIT-${event}`},`DEMO-PORTAL-DEPOSIT-${event}`);
 const card=state.cards.find(c=>c.slash&&!c.frozen);
 if(card)apply({type:'topup',id:card.id,amount:10000},'DEMO-PORTAL-SEED-CARD-TOPUP');
 apply({type:'finance/address',label:'演示收款地址',address:'DEMO:TRON:portal'},'DEMO-PORTAL-SEED-ADDRESS');
 apply({type:'finance/withdraw',addressId:'DEMO-PORTAL-SEED-ADDRESS',amount:50_000000,verified:true},'DEMO-PORTAL-SEED-WITHDRAW');
 state.unified=true;
 db.prepare('INSERT INTO portal_state VALUES(?,0,?)').run(ns,JSON.stringify(state));
}
// One API projection for list, detail, action responses and export. No browser-side order joins.
function clientEntry(entry,state){
 const card=state.cards.find(c=>c.id===entry.card);
 const order=!entry.slash&&entry.orderId?state.finance.orders.find(o=>o.id===entry.orderId):undefined;
 return {...entry,currency:entry.currency??'USD',statusText:entry.slash||entry.ledgerOperationId||entry.nonFinancial?entry.statusText:order?.status??entry.status,
  cardSummary:card?{id:card.id,name:card.name,last4:card.last4}:undefined,
  financeSummary:order?{id:order.id,status:order.status,currency:order.currency,toCurrency:order.toCurrency,fee:order.fee,receive:order.receive}:undefined};
}
function load(db,ns){seedPortal(db,ns);const row=db.prepare('SELECT * FROM portal_state WHERE namespace=?').get(ns);const state=JSON.parse(row.state_json);
 // Refresh the source projection on every read; internal budget actions never overwrite upstream fields.
 const sourceRows=db.prepare("SELECT * FROM source_records WHERE namespace=? AND scenario_id LIKE '%-R001' AND kind IN('card','transaction','balance','fee')").all(ns).map(dto);
 state.entries=[...state.entries.filter(e=>!e.slash),...projectTransactions(db,ns,sourceRows)];
 for(const card of state.cards.filter(c=>c.slash)){
  const r=sourceRows.find(r=>r.kind==='card'&&r.id===card.id);if(!r)continue;
  card.slash=r;card.name=r.source.name??card.name;card.last4=r.source.last4;card.sourceBalance=sourceRows.find(b=>b.kind==='balance'&&b.source.accountId===r.source.accountId)?.source;
  if(r.source.status!=='active')card.frozen=true;
 }
 overlayCardAdmin(db,ns,state);
 state.entries=state.entries.map(e=>clientEntry(e,state));
 return {state,revision:row.revision};}
function personalView(state,hiddenIds=new Set()) {
 const {teams,members,...rest}=state;
 const {subBalances={},...finance}=state.finance;
 return {...rest,cards:state.cards.map(({team,...card})=>card),
  finance:{...finance,subBalances:{},legacyRestrictedUsd:Object.values(subBalances).reduce((sum,v)=>sum+v,0)},
  notices:state.notices.filter(n=>!hiddenIds.has(n.id)&&!isRetiredNotice(n))};
}
function view(db,ns,state) {
 const ids=new Set(db.prepare("SELECT record_id FROM portal_actions WHERE namespace=? AND json_extract(action_json,'$.type') IN ('team','invite')").all(ns).map(a=>a.record_id));
 return personalView(state,ids);
}
function publicState(state,revision){
 return {...state,revision,entries:state.entries.map(e=>clientEntry(e,state)).sort((a,b)=>b.time.localeCompare(a.time)||a.id.localeCompare(b.id)).slice(0,5),entryCount:state.entries.length,analytics:{7:spendingTrend(state.entries,7),30:spendingTrend(state.entries,30)}};
}
export function portalState(db,ns){const {state,revision}=load(db,ns);return publicState(view(db,ns,state),revision);}
export function portalList(db,ns,q={}){
 const {state}=load(db,ns);let rows=state.entries;const key=String(q.keyword||q.eq||'').toLowerCase();
 rows=rows.filter(e=>(!key||`${e.id} ${e.name} ${e.card||''} ${e.orderId||''} ${e.slash?.source.orderId||''}`.toLowerCase().includes(key))&&(!q.accountId||e.slash?.source.accountId===q.accountId)&&(!q.cardId||e.card===q.cardId)&&(!q.scenario||e.slash?.internal.scenarioId===q.scenario)&&(!q.platform||(e.slash?'Slash':'ADSFLOW')===q.platform)&&(!q.kind||e.kind===q.kind)&&(!q.status||e.status===q.status)&&(!q.currency||(e.currency||'USD')===q.currency)&&(!q.detailedStatus||e.slash?.source.detailedStatus===q.detailedStatus)&&(!q.from||e.time.slice(0,10)>=q.from)&&(!q.to||e.time.slice(0,10)<=q.to)&&(!q.group||(q.group==='transactions'?Boolean(e.slash)||['消费','退款'].includes(e.kind):q.group==='funds'?Boolean(e.orderId||e.ledgerOperationId):!e.slash&&!e.orderId&&!e.ledgerOperationId&&!['消费','退款'].includes(e.kind))));
 const sort=q.sort==='amount'?'amount':'time',direction=q.direction==='asc'?1:-1;
 rows.sort((a,b)=>direction*(sort==='amount'?a.amount-b.amount:a.time.localeCompare(b.time))||a.id.localeCompare(b.id));
 const page=Math.max(0,Math.trunc(Number(q.page)||0)),size=Math.max(1,Math.min(100,Math.trunc(Number(q.pageSize)||10)));
 const groupCounts={transactions:0,funds:0,activity:0};for(const e of rows){const group=e.slash||['消费','退款'].includes(e.kind)?'transactions':e.orderId||e.ledgerOperationId?'funds':'activity';groupCounts[group]++;}
 return {groupCounts,rows:rows.slice(page*size,(page+1)*size),total:rows.length,page,pageSize:size,postedSpendCents:rows.filter(e=>e.kind==='消费'&&e.status==='已完成'&&e.amount<0).reduce((sum,e)=>sum+Math.abs(e.amount),0)};
}
export function portalEntry(db,ns,id){return load(db,ns).state.entries.find(e=>e.id===id)||null;}
export function portalAction(db,ns,body){
 assertPersonalAction(body?.action);
 seedPortal(db,ns);seedBins(db,ns);if(!body||typeof body.requestId!=='string'||!/^DEMO-[A-Za-z0-9-]{1,100}$/.test(body.requestId))throw new Error('Invalid demo request ID');
 const allowed=['unfreeze-request','open','topup','freeze','read','onboard','ticket','finance/deposit','finance/quote','finance/exchange','finance/address','finance/address-toggle','finance/withdraw','finance/cancel','finance/card-return','finance/simulate'];
 if(!allowed.includes(body.action?.type))throw new Error('Unsupported demo action');
 const actionFields={'unfreeze-request':['id','reason','evidence','freezeRevision'],open:['name','productId','productRevision'],topup:['id','amount','source'],freeze:['id'],read:['ids','read'],onboard:['name','email'],ticket:['text'],'finance/deposit':['amount'],'finance/quote':['from','amount','now'],'finance/exchange':['quoteId','now'],'finance/address':['label','address'],'finance/address-toggle':['addressId'],'finance/withdraw':['addressId','amount','verified'],'finance/cancel':['orderId'],'finance/card-return':['cardId','amount'],'finance/simulate':['orderId','event','eventId']};
 if(Object.keys(body.action).some(key=>key!=='type'&&!actionFields[body.action.type].includes(key)))throw new Error('Unexpected action fields');
 const json=JSON.stringify(body.action);db.exec('BEGIN IMMEDIATE');
 try{
  const replay=db.prepare('SELECT * FROM portal_actions WHERE namespace=? AND request_id=?').get(ns,body.requestId);
  if(replay){if(replay.action_json!==json)throw new Error('Request ID reused with different action');const result={id:replay.record_id,state:portalState(db,ns)};db.exec('COMMIT');return result;}
  const {state,revision}=load(db,ns);if(body.revision!==revision)throw new Error('数据已在其他页面更新，请刷新后重试');
  const controlledId=body.action.id||body.action.cardId;
  const controlled=db.prepare('SELECT id FROM ca_cards WHERE namespace=? AND id=?').get(ns,controlledId||'');
  if(controlled&&['topup','finance/card-return'].includes(body.action.type)&&db.prepare('SELECT 1 FROM ca_accounts WHERE namespace=? AND card_id=?').get(ns,controlledId))throw new Error('此卡由独立资金账本管理，请通过后台审批转入或转出，不能使用原预算钱包');
  if(body.action.type==='unfreeze-request'){
   const id=clientUnfreezeRequest(db,ns,controlledId,body.requestId,body.action);
   db.prepare('UPDATE portal_state SET revision=revision+1 WHERE namespace=?').run(ns);
   db.prepare('INSERT INTO portal_actions VALUES(?,?,?,?)').run(ns,body.requestId,json,id);
   db.exec('COMMIT');return {id,state:portalState(db,ns)};
  }
  if(controlled&&body.action.type==='freeze'){
   const id=clientCardFreeze(db,ns,controlledId,body.requestId);
   db.prepare('UPDATE portal_state SET revision=revision+1 WHERE namespace=?').run(ns);
   db.prepare('INSERT INTO portal_actions VALUES(?,?,?,?)').run(ns,body.requestId,json,id);
   db.exec('COMMIT');return {id,state:portalState(db,ns)};
  }
  if(body.action.type==='freeze'){const card=state.cards.find(c=>c.id===body.action.id);if(card?.slash&&card.slash.source.status!=='active')throw new Error('来源卡片非启用状态；本地演示不能解冻或重新激活上游卡片');}
  const product=body.action.type==='open'?validateOpening(db,ns,body.action):null;
  const id=`DEMO-CLIENT-${randomUUID()}`;const next=transition(state,body.action,id,new Date().toISOString());
  if(product){const card=next.cards.find(c=>c.id===id);card.binProduct=product;card.last4=String(randomInt(10000)).padStart(4,'0');db.prepare('INSERT INTO bin_card_links VALUES(?,?,?,?,?,?)').run(ns,id,product.id,product.revision,JSON.stringify(product),new Date().toISOString());}
  db.prepare('UPDATE portal_state SET revision=?,state_json=? WHERE namespace=?').run(revision+1,JSON.stringify(next),ns);
  db.prepare('INSERT INTO portal_actions VALUES(?,?,?,?)').run(ns,body.requestId,json,id);
  db.exec('COMMIT');return {id,state:publicState(view(db,ns,next),revision+1)};
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function portalMessages(db,ns,q={}){return queryMessages(view(db,ns,load(db,ns).state),q);}
export function portalMessage(db,ns,id){return messageRows(view(db,ns,load(db,ns).state)).find(n=>n.id===id)||null;}

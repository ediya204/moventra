// Audited field whitelist; never store or return an arbitrary provider response.
export const statuses = {pending:'处理中',posted:'已入账',failed:'未入账 / 失败'};
export const details = {pending:'待处理',pending_approval:'待审批',in_review:'审核中',canceled:'已取消',failed:'失败',settled:'已结算',declined:'授权拒绝',refund:'退款',reversed:'授权撤销',returned:'退回',dispute:'争议'};
const object = (value, fields) => Object.fromEntries(fields.filter(k => value?.[k] !== undefined).map(k => [k,value[k]]));
export function safeSource(kind, input) {
 const s = input || {};
 if(kind==='transaction') {
  const out=object(s,['id','date','description','memo','merchantDescription','amountCents','status','detailedStatus','accountId','virtualAccountId','accountSubtype','cardId','orderId','referenceNumber','authorizedAt','declineReason','approvalReason','providerAuthorizationId']);
  if(s.merchantData){out.merchantData=object(s.merchantData,['description','categoryCode']);if(s.merchantData.location)out.merchantData.location=object(s.merchantData.location,['city','state','country','zip']);}
  for(const [key,fields] of [['originalCurrency',['code','amountCents','conversionRate']],['fxFeeInfo',['amountCents']],['cashbackInfo',['amountCents','rate']]])if(s[key])out[key]=object(s[key],fields);
  if(s.feeInfo)out.feeInfo=s.feeInfo.relatedTransaction?{relatedTransaction:object(s.feeInfo.relatedTransaction,['id','amount'])}:{};
  return out;
 }
 if(kind==='card') {
  const out=object(s,['id','accountId','virtualAccountId','last4','name','expiryMonth','expiryYear','status','isPhysical','isSingleUse','cardGroupId','cardGroupName','createdAt','cardProductId']);
  const limits=s.spendingConstraint?.spendingRule?.utilizationLimitV2;
  if(limits)out.spendingConstraint={spendingRule:{utilizationLimitV2:limits.map(l=>({...object(l,['preset','timezone','startDate']),limitAmount:object(l.limitAmount,['amountCents'])}))}};
  return out;
 }
 if(kind==='account')return object(s,['id','status','name','createdAt','type','balances']); // omit routing/account numbers even when synthetic
 if(kind==='virtualAccount')return object(s,['id','name','accountId','accountType','closedAt']);
 if(kind==='balance')return {...object(s,['accountId','type','timestamp']),available:object(s.available,['amountCents']),posted:object(s.posted,['amountCents'])};
 if(kind==='fee')return {...object(s,['id','dateCharged','feeAmountCents','feeType','accountId']),...(s.originalTransaction?{originalTransaction:safeSource('transaction',s.originalTransaction)}:{}),...(s.card?{card:safeSource('card',s.card)}:{})};
 throw new Error('Unsupported source kind');
}
export function cents(value){if(!Number.isSafeInteger(value))throw new Error('Amount must be safe integer cents');return value;}
export function decimal(value){if(value==null)return null;const n=BigInt(value);return `${n<0n?'-':''}${(n<0n?-n:n)/100n}.${String((n<0n?-n:n)%100n).padStart(2,'0')}`;}
export function impact(s){
 if(!['pending','posted','failed'].includes(s.status))throw new Error('Unknown source status: reconciliation must remain pending');
 const n=BigInt(cents(s.amountCents));
 if(s.status==='posted')return {posted:n,hold:0n};
 if(s.status==='pending'&&s.detailedStatus!=='pending_approval')return {posted:0n,hold:n<0n?-n:0n};
 return {posted:0n,hold:0n};
}
export function balanceOf(transactions,adjustments=[],opening=100000){
 let posted=BigInt(opening),hold=0n;
 for(const t of transactions){const i=impact(t);posted+=i.posted;hold+=i.hold;}
 for(const a of adjustments)posted+=BigInt(cents(a.amountCents));
 return {posted:cents(Number(posted)),available:cents(Number(posted-hold)),hold:cents(Number(hold))};
}
export function dto(row){
 const source=safeSource(row.kind,JSON.parse(row.source_json));
 const internal=JSON.parse(row.internal_json);
 return {id:row.source_id,kind:row.kind,source,internal:{...internal,platform:row.platform,entityId:row.entity_id,scenarioId:row.scenario_id,version:row.version,namespace:row.namespace},
 ...(row.kind==='transaction'?{currency:row.currency,amount:decimal(source.amountCents),direction:source.amountCents==null?null:source.amountCents<0?'debit':source.amountCents>0?'credit':'zero',statusLabel:statuses[source.status]||`未知状态 (${source.status})`,detailedStatusLabel:details[source.detailedStatus]||`未知状态 (${source.detailedStatus})`,dateMeaning:source.status==='posted'?'入账时间':['pending','failed'].includes(source.status)?'创建时间':'未知状态，日期语义待确认',postedAt:source.status==='posted'?source.date:null}: {})};
}

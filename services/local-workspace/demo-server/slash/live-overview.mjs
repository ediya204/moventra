const DAY_MS=86400000;
const HK_OFFSET_MS=8*3600000;
const validMinor=value=>typeof value==='string'&&/^(?:0|-?[1-9]\d*)$/.test(value);
const dateKey=ms=>new Date(ms+HK_OFFSET_MS).toISOString().slice(0,10);
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const reviewDetails=new Set(['reversed','pending','pending_approval','failed','declined','canceled','in_review']);

// Aggregates one caller-owned SQLite read transaction. Amounts deliberately follow
// source status=posted, including contradictory combinations flagged for review;
// this is neither confirmed settlement nor an available-funds calculation.
export function readLiveOverview(db,config,meta,query={},runtime={}){
 if(Object.keys(query).some(key=>key!=='days'))fail('不支持的查询参数');
 const value=query.days===undefined?'7':query.days;
 if(typeof value!=='string'||!['7','14','30'].includes(value))fail('days 仅支持 7、14 或 30');
 const days=Number(value),now=runtime.now??Date.now();
 const today=Math.floor((now+HK_OFFSET_MS)/DAY_MS)*DAY_MS-HK_OFFSET_MS;
 const from=today-(days-1)*DAY_MS;
 const bins=new Map(Array.from({length:days},(_,index)=>[dateKey(from+index*DAY_MS),{incoming:0n,outgoing:0n,posted:0,pending:0,failed:0,total:0,validPosted:0,invalidPosted:0}]));
 const counts=new Map(),currencyCounts=new Map(),merchantTotals=new Map();
 let incoming=0n,outgoing=0n,posted=0,pending=0,failed=0,review=0,transactions=0,invalidAmounts=0;
 for(const row of db.prepare("SELECT data FROM live_records WHERE connection_id=? AND kind='transaction' AND date_ms>=? AND date_ms<?").iterate(config.connectionId,from,now)){
  const record=JSON.parse(row.data),time=Date.parse(record.date);
  if(!Number.isFinite(time)||time<from||time>=now)continue;
  const bucket=bins.get(dateKey(time));
  if(!bucket)continue;
  const sourceStatus=typeof record.status==='string'&&record.status?record.status:'unknown';
  counts.set(sourceStatus,(counts.get(sourceStatus)||0)+1);transactions++;bucket.total++;
  if(sourceStatus==='posted'){posted++;bucket.posted++;}
  if(sourceStatus==='pending'){pending++;bucket.pending++;}
  if(sourceStatus==='failed'){failed++;bucket.failed++;}
  const isReview=sourceStatus==='posted'&&reviewDetails.has(record.detailedStatus);
  if(isReview)review++;
  // Slash documents omitted originalCurrency as USD. A supplied but invalid code
  // remains unknown; no inferred currency conversion enters the USD amount sum.
  const original=record.originalCurrency;
  const code=original===undefined?'USD':typeof original?.code==='string'&&/^[A-Z]{3}$/.test(original.code)?original.code:'UNKNOWN';
  currencyCounts.set(code,(currencyCounts.get(code)||0)+1);
  if(sourceStatus!=='posted')continue;
  if(!validMinor(record.amountCents)){invalidAmounts++;bucket.invalidPosted++;continue;}
  bucket.validPosted++;
  const amount=BigInt(record.amountCents);
  if(amount>=0n){incoming+=amount;bucket.incoming+=amount;}else{outgoing-=amount;bucket.outgoing-=amount;}
  const merchant=record.merchantData?.description??record.merchant;
  if(amount<0n&&record.detailedStatus==='settled'&&typeof record.cardId==='string'&&record.cardId.trim()&&typeof merchant==='string'&&merchant.trim()){
   const current=merchantTotals.get(merchant)||{amount:0n,count:0};
   current.amount-=amount;current.count++;merchantTotals.set(merchant,current);
  }
 }
 const selected=config.selectedCards&&typeof config.selectedCards==='object'&&!Array.isArray(config.selectedCards)?new Set(Object.keys(config.selectedCards)):null;
 let active=0,knownCards=0;
 if(selected)for(const row of db.prepare("SELECT id,data FROM live_records WHERE connection_id=? AND kind='card'").iterate(config.connectionId)){
  if(!selected.has(row.id))continue;
  knownCards++;
  if(JSON.parse(row.data).cardStatus==='active')active++;
 }
 const reason='仅统计当前连接已导入的有限交易记录；抓取分页及历史覆盖不完整，不能据此确认全量收支或结算。'+(invalidAmounts?` ${invalidAmounts} 笔已入账记录金额无效，未计入金额。`:'');
 return {
  mode:'real_readonly',asOf:new Date(now).toISOString(),revision:String(meta.revision),
  range:{from:new Date(from).toISOString(),to:new Date(now).toISOString(),timezone:'Asia/Hong_Kong',days},
  coverage:{complete:false,reason},currency:'USD',scale:2,timeBasis:'source_date',
  totals:{incomingMinor:String(incoming),outgoingMinor:String(outgoing),netMinor:String(incoming-outgoing),transactions,posted,pending,failed,review,activeCards:selected&&knownCards===selected.size?active:null,selectedCards:selected?.size??null,customers:null,activeCustomers:null},
  daily:[...bins].map(([date,bucket])=>{
   const known=bucket.total>0&&!(bucket.invalidPosted>0&&bucket.validPosted===0);
   return {date,incomingMinor:known?String(bucket.incoming):null,outgoingMinor:known?String(bucket.outgoing):null,netMinor:known?String(bucket.incoming-bucket.outgoing):null,posted:bucket.posted,pending:bucket.pending,failed:bucket.failed,total:bucket.total};
  }),
  statuses:[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([status,count])=>({status,count})),
  merchants:[...merchantTotals].sort(([an,a],[bn,b])=>a.amount===b.amount?an.localeCompare(bn):a.amount>b.amount?-1:1).slice(0,8).map(([name,total])=>({name,amountMinor:String(total.amount),count:total.count})),
  currencies:[...currencyCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([code,count])=>({code,count})),
  availability:{merchants:merchantTotals.size>0,cards:selected!==null&&knownCards===selected.size,customers:false},
  sync:{lastSuccessAt:meta.lastSuccessAt??null,state:runtime.processError?'error':runtime.running?'syncing':meta.state??'unknown',mode:'manual'},
 };
}

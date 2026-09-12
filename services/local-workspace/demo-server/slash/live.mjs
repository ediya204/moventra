import {cardOwner} from './card-ownership.mjs';
import {readLiveOverview} from './live-overview.mjs';
import {liveDateRange} from './live-date-range.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const folder=fileURLToPath(new URL('../../../adsflow-api/.slash-preview/',import.meta.url));
const script=fileURLToPath(new URL('../../../adsflow-api/scripts/slash_live.py',import.meta.url));
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createLiveBridge(options={}){
 const configPath=options.configPath||`${folder}live-config.json`,dbPath=options.dbPath||`${folder}live.sqlite`;
 let running=false,processError=null,child;
 const config=()=>{if(!existsSync(configPath))return null;return JSON.parse(readFileSync(configPath,'utf8'));};
 const dbRead=fn=>{const db=new DatabaseSync(dbPath,{readOnly:true});db.exec('PRAGMA busy_timeout=3000');try{return fn(db);}finally{db.close();}};
 const meta=()=>dbRead(db=>JSON.parse(db.prepare('SELECT data FROM live_meta WHERE id=1').get().data));
 async function trigger(){
  if(running)return {accepted:false,running:true};
  const c=config();if(!c?.enabled)fail('真实数据同步未启用',409);
  running=true;processError=null;
  try{
   if(options.sync)await options.sync();
   else await new Promise((resolve,reject)=>{
    child=spawn('python3',[script,'sync'],{stdio:['ignore','ignore','ignore'],env:{...process.env,PYTHONUNBUFFERED:'1'}});
    const watchdog=setTimeout(()=>{child?.kill('SIGTERM');reject(new Error('同步超时'));},240000);watchdog.unref();
    child.once('error',()=>{clearTimeout(watchdog);reject(new Error('无法启动同步进程'));});
    child.once('exit',code=>{clearTimeout(watchdog);code===0?resolve():reject(new Error('本轮同步失败，请查看同步状态'));});
   });
  }catch(e){processError=e.message;}
  finally{running=false;child=null;}
  return {accepted:true,running:false};
 }
 function status(){const c=config();if(!c)return {configured:false};const m=meta();return {
  ...m,configured:true,enabled:c.enabled,syncMode:'manual',webhookConnected:false,intervalSeconds:null,selectedCards:Object.keys(c.selectedCards).length,
  workerRunning:false,running,nextAt:null,processError,
  stale:!m.lastSuccessAt||Date.now()-Date.parse(m.lastSuccessAt)>900*1000,
  state:processError?'error':running?'syncing':m.state,
  fixedSelection:true,selectionAt:c.selectionAt,
 };}
 function read(path,q={},ownershipDb=null){
  const c=config();if(!c){if(path==='status')return {configured:false};fail('尚未配置真实 Slash 数据',503);}
  if(path==='status'){if(Object.keys(q).length)fail('不支持的查询参数');return status();}
  if(path==='overview')return dbRead(db=>{
   db.exec('BEGIN');
   const m=JSON.parse(db.prepare('SELECT data FROM live_meta WHERE id=1').get().data);
   return readLiveOverview(db,c,m,q,{running,processError,now:options.now?.()??Date.now()});
  });
  const match=/^(cards|transactions)(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
  if(!match)fail('接口不存在',404);
  const allowed=['page','pageSize','keyword','status','detailedStatus','cardOnly','group','cardId','revision','source','originalCurrency','from','to'];
  if(Object.keys(q).some(k=>!allowed.includes(k)))fail('不支持的查询参数');
  const page=Number(q.page??0),size=Number(q.pageSize??20);
  if(!Number.isInteger(page)||page<0||page>10000||!Number.isInteger(size)||size<1||size>100)fail('无效分页');
  if(String(q.keyword||'').length>100)fail('关键词过长');
  if(q.cardOnly!==undefined&&(match[1]!=='transactions'||!['true','false'].includes(String(q.cardOnly))))fail('无效卡交易范围');
  if(q.detailedStatus&&(match[1]!=='transactions'||typeof q.detailedStatus!=='string'||q.detailedStatus.length>80))fail('无效交易详细状态');
  if(match[1]!=='transactions'&&(q.from!==undefined||q.to!==undefined))fail('时间范围仅适用于交易');
  const window=match[1]==='transactions'?liveDateRange(q,options.now?.()??Date.now()):null;
  return dbRead(db=>{
   db.exec('BEGIN');
   const m=JSON.parse(db.prepare('SELECT data FROM live_meta WHERE id=1').get().data);
   if(q.revision&&String(m.revision)!==String(q.revision))fail('数据已更新，请回到第一页重新读取',409);
   const kind=match[1]==='cards'?'card':'transaction';
   const relatedCard=db.prepare("SELECT data,kind FROM live_records WHERE connection_id=? AND id=? AND kind IN ('card','card-reference') ORDER BY kind LIMIT 2");
   const resultRow=r=>{
    const row=JSON.parse(r.data);
    if(r.kind==='card-reference'){row.referenceOnly=true;row.maskedCardNumber=row.maskedCardNumber||(/^[0-9]{4}$/.test(row.last4||'')?`**** ${row.last4}`:null);}
    // Join our database; cardholder/merchant names never imply ownership.
    row.internal=cardOwner(ownershipDb,c.namespace,'slash',c.connectionId,kind==='card'?row.id:row.cardId);
    row.fieldAvailability={customer:row.internal.customerId?'available':'not_bound',attachments:'not_connected'};
    if(kind==='transaction'){
     row.cardLast4=null;row.cardName=null;
     for(const reference of relatedCard.all(c.connectionId,row.cardId||'')){
      const card=JSON.parse(reference.data);
      const value=reference.kind==='card-reference'?card.last4:/^(?:\*{4}|•{4}) ([0-9]{4})$/.exec(card.maskedCardNumber||'')?.[1];
      if(!row.cardName&&typeof card.cardName==='string')row.cardName=card.cardName;
      if(typeof value==='string'&&/^[0-9]{4}$/.test(value))row.cardLast4=value;
      if(row.cardLast4&&row.cardName)break;
     }
     row.fieldAvailability.cardLast4=row.cardLast4===null?'not_collected':'available';
     row.sourceRequestInWindow=row.inWindow;
     row.inWindow=Number.isFinite(Date.parse(row.date))&&Date.parse(row.date)>=window.from&&Date.parse(row.date)<window.to;
     row.issues=(row.issues||[]).filter(x=>x!=='来源日期在请求区间外，未计入汇总');
     if(!row.inWindow&&!row.issues.some(x=>x.includes('日期')))row.issues.push('来源日期不在当前展示区间，未计入汇总');
    }
    return {...row,observedAt:r.observed_at,fetchError:(m.errors||[]).find(e=>e.kind===kind&&e.id===r.id)?.message||null};
   };
   if(match[2]){
    const r=kind==='card'?db.prepare("SELECT * FROM live_records WHERE connection_id=? AND kind IN ('card','card-reference') AND id=? ORDER BY kind LIMIT 1").get(c.connectionId,match[2]):db.prepare('SELECT * FROM live_records WHERE connection_id=? AND kind=? AND id=?').get(c.connectionId,kind,match[2]);
    if(!r)fail('记录不存在或不在当前连接范围',404);
    return {row:resultRow(r),revision:m.revision};
   }
   let where='connection_id=? AND kind=?',args=[c.connectionId,kind];
   if(kind==='transaction'){where+=window.includeUnknown?' AND ((date_ms>=? AND date_ms<?) OR date_ms IS NULL)':' AND date_ms>=? AND date_ms<?';args.push(window.from,window.to);}
   if(String(q.cardOnly)==='true'){where+=" AND json_type(data,'$.cardId')='text' AND length(trim(json_extract(data,'$.cardId')))>0";}
   if(q.keyword){where+=" AND (instr(lower(data),lower(?))>0)";args.push(String(q.keyword));}
   if(q.status){where+=' AND status=?';args.push(q.status);}
   if(q.detailedStatus){where+=" AND json_extract(data,'$.detailedStatus')=?";args.push(q.detailedStatus);}
   if(q.group){if(!['latestCreated','recentConsumption'].includes(q.group)||kind!=='card')fail('无效分组');where+=" AND EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.groups')) WHERE value=?)";args.push(q.group);}
   if(q.cardId){if(kind!=='transaction')fail('无效卡片筛选');where+=" AND json_extract(data,'$.cardId')=?";args.push(q.cardId);}
   if(q.originalCurrency){if(!/^[A-Z]{3}$/.test(q.originalCurrency))fail('无效币种');where+=" AND json_extract(data,'$.originalCurrency.code')=?";args.push(q.originalCurrency);}
   const total=db.prepare(`SELECT COUNT(*) n FROM live_records WHERE ${where}`).get(...args).n;
   const rows=db.prepare(`SELECT * FROM live_records WHERE ${where} ORDER BY date_ms DESC,id LIMIT ? OFFSET ?`).all(...args,size,page*size).map(resultRow);
   let summary=null;
   if(kind==='transaction'){
    let incoming=0n,outgoing=0n,review=0;
    for(const r of db.prepare(`SELECT data FROM live_records WHERE ${where}`).iterate(...args)){
     const d=JSON.parse(r.data);if(d.status==='posted'&&['reversed','pending','pending_approval','failed','declined','canceled'].includes(d.detailedStatus))review++;
     if(!d.date||!Number.isFinite(Date.parse(d.date))||Date.parse(d.date)<window.from||Date.parse(d.date)>=window.to||d.status!=='posted'||d.amountCents==null||!(/^-?\d+$/.test(d.amountCents)))continue;
     const n=BigInt(d.amountCents);if(n>=0n)incoming+=n;else outgoing-=n;
    }
    summary={incomingMinor:String(incoming),outgoingMinor:String(outgoing),netMinor:String(incoming-outgoing),statusReview:review,currency:'USD'};
   }
   return {rows,total,page,pageSize:size,revision:m.revision,summary};
  });
 }
 return {
  config,status,read,trigger,
  // Compatibility hook: startup never schedules or starts a provider request.
  start(){},
  stop(){child?.kill('SIGTERM');},
  authorize(actor,namespace){const c=config();if(!c)return;if(c.namespace!==namespace||!c.authorizedActors.includes(actor))fail('没有此真实渠道连接的读取或同步权限',403);},
 };
}
export function liveRequestGuard(req){
 const remote=req.socket.remoteAddress;
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))fail('真实数据仅允许本机访问',403);
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||''))fail('真实数据仅允许本机域名',403);
 if(req.headers['sec-fetch-site']==='cross-site')fail('拒绝跨站读取真实数据',403);
 if(req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost):(8850|8852)$/.test(req.headers.origin))fail('来源不受信任',403);
}
export function auditLive(db,namespace,actor,path){db.prepare('INSERT INTO mg_audit VALUES(?,?,?,?,?,?,?)').run(namespace,randomUUID(),actor,'slash.live.read',path,'读取真实 Slash 本地投影',new Date().toISOString());}

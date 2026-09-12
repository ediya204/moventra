import {processQueuedCardJobs} from './card-admin.mjs';
import {createLiveBridge} from './live.mjs';
import {binsList} from './bins.mjs';
import http from 'node:http';
import {managementHandler} from './management-http.mjs';
import {fileURLToPath} from 'node:url';
import {openStore,assertLocal,listRecords,getDetail,summary} from './store.mjs';
import {portalState,portalList,portalEntry,portalAction,portalMessages,portalMessage} from './portal.mjs';
import {NAMESPACE} from './generate.mjs';
assertLocal();
export function createDemoServer(db,namespace=NAMESPACE,options={}){
 const manage=managementHandler(db,namespace,options);
 const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-ADSFLOW-Data-Mode':'isolated-slash-demo'});res.end(JSON.stringify({success:status<400,data,...(status>=400?{message:data.message}:{})}));};
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
   if(/^\/admin-api\/settlement-management\/demo\/(portal|management)\/(teams?|members|invites?|invitations?)(\/|$)/.test(path))return send(res,{message:'V1 暂不支持团队协作'},410);
   if(await manage(req,res,url))return;
   if(req.method==='POST'&&path==='/admin-api/login'){
    let body='';for await(const c of req){body+=c;if(body.length>4096)return send(res,{message:'Body too large'},413);}
    const input=JSON.parse(body);
    if(!['demo@moventra.local','demo@adsflow.local'].includes(input.username)||input.password!=='demo-only')return send(res,{message:'Demo账号或密码错误'},401);
    return send(res,{username:input.username,nickname:'Slash Demo 运营',roles:['demo-readonly'],permissions:['read:*'],accessToken:'isolated-slash-demo-local'});
   }
   if(req.method==='POST'&&path==='/admin-api/settlement-management/demo/portal/action'){
    if(!/^http:\/\/(127\.0\.0\.1|localhost):(8850|8852)$/.test(req.headers.origin||''))return send(res,{message:'Local Demo origin required'},403);
    let text='';for await(const c of req){text+=c;if(text.length>16384)return send(res,{message:'Body too large'},413);}
    return send(res,portalAction(db,namespace,JSON.parse(text)));
   }
   if(req.method!=='GET')return send(res,{message:'Demo仅允许读取'},405);
   if(!path.startsWith('/admin-api/settlement-management/demo/'))return send(res,{message:'本地Slash Demo没有接入此接口'},404);
   const endpoint=path.slice('/admin-api/settlement-management/demo/'.length),q=Object.fromEntries(url.searchParams);
   if(endpoint==='portal/bin-products')return send(res,binsList(db,namespace,q,true));
   if(endpoint==='portal/messages')return send(res,portalMessages(db,namespace,q));
   if(endpoint.startsWith('portal/messages/')){const row=portalMessage(db,namespace,decodeURIComponent(endpoint.slice('portal/messages/'.length)));return row?send(res,row):send(res,{message:'消息不存在'},404);}
   if(endpoint==='portal/state')return send(res,portalState(db,namespace));
   if(endpoint==='portal/transactions')return send(res,portalList(db,namespace,q));
   if(endpoint.startsWith('portal/transactions/')){const entry=portalEntry(db,namespace,decodeURIComponent(endpoint.slice('portal/transactions/'.length)));return entry?send(res,entry):send(res,{message:'未找到订单交易'},404);}
   if(endpoint==='portal/transactions.csv'){
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="client-transactions.csv"','Cache-Control':'no-store'});
    const escape=v=>'"'+String(v??'').replace(/^[=+@]/,"'$&").replaceAll('"','""')+'"';
    res.write('\uFEFF编号,卡片,商户或名称,类型,金额最小单位,币种,处理状态,详细状态,来源状态,时间,资金订单,商户订单,显示状态\r\n');let page=0;
    do{const result=portalList(db,namespace,{...q,page,pageSize:100});for(const e of result.rows)res.write([e.id,e.card,e.name,e.kind,e.amount,e.currency||'USD',e.status,e.slash?.source.detailedStatus,e.slash?.source.status,e.time,e.orderId,e.slash?.source.orderId,e.statusText||e.status].map(escape).join(',')+'\r\n');if(++page*100>=result.total)break;}while(!res.destroyed);return res.end();
   }
   if(endpoint==='health')return send(res,{mode:'isolated-slash-demo',namespace,local:true});
   if(endpoint==='summary')return send(res,summary(db,namespace));
   if(endpoint==='scenarios'){
    const size=Math.max(1,Math.min(100,Number(q.pageSize)||25)),page=Math.max(0,Number(q.page)||0),keyword=`%${q.keyword||''}%`;
    const where='namespace=? AND (id LIKE ? OR title LIKE ? OR description LIKE ?)';
    const args=[namespace,keyword,keyword,keyword];
    return send(res,{rows:db.prepare(`SELECT * FROM scenarios WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...args,size,page*size),total:db.prepare(`SELECT COUNT(*) n FROM scenarios WHERE ${where}`).get(...args).n,page,pageSize:size});
   }
   if(['accounts.csv','cards.csv','balances.csv'].includes(endpoint)){
    const kind={ 'accounts.csv':'account','cards.csv':'card','balances.csv':'balance' }[endpoint];
    const keys=['id','platform','entityId','scenarioId','accountId','virtualAccountId','name','status','type','last4','expiryMonth','expiryYear','cardGroupId','cardGroupName','cardProductId','createdAt','currency','availableCents','postedCents','timestamp',...(kind==='account'?['email','balanceType','balanceId']:[])];
    const escape=v=>`"${String(v??'').replace(/^[=+@]/,"'$&").replaceAll('"','""')}"`;
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="slash-demo-${endpoint}"`,'Cache-Control':'no-store'});
    res.write('\uFEFF'+keys.join(',')+'\r\n');let page=0;
    do{const result=listRecords(db,namespace,kind,{...q,page,pageSize:100});for(const r of result.rows){const s=r.source,i=r.internal;for(const b of kind==='account'?(r.balances?.length?r.balances:[null]):[r]){res.write([r.id,i.platform,i.entityId,i.scenarioId,s.accountId,s.virtualAccountId,s.name,s.status,s.type,s.last4,s.expiryMonth,s.expiryYear,s.cardGroupId,s.cardGroupName,s.cardProductId,s.createdAt,b?.internal.currency,b?.source.available?.amountCents,b?.source.posted?.amountCents,b?.source.timestamp,...(kind==='account'?[i.email,b?.source.type,b?.id]:[])].map(escape).join(',')+'\r\n');}}page++;if(page*100>=result.total)break;}while(!res.destroyed);
    return res.end();
   }
   if(endpoint==='transactions.csv'){
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="slash-demo-transactions.csv"','Cache-Control':'no-store'});
    const keys=['id','scenario','platform','entityId','accountId','virtualAccountId','cardId','status','detailedStatus','amountCents','currency','direction','originalCurrency','originalAmountCents','conversionRate','accountSubtype','authorizedAt','date','dateMeaning','orderId','referenceNumber','providerAuthorizationId','merchant','mcc','city','state','country','zip','memo','declineReason','approvalReason','fxFeeCents','cashbackCents','cashbackRate','firstCollectedAt','lastSyncedAt','syncError','matchingStatus'];
    const escape=value=>{let str=String(value??'');if(/^[=+@\t\r]|^-\D/.test(str))str=`'${str}`;return `"${str.replaceAll('"','""')}"`;};
    res.write('\uFEFF'+keys.map(escape).join(',')+'\r\n');let page=0;
    do{const result=listRecords(db,namespace,'transaction',{...q,page,pageSize:100});for(const r of result.rows){const s=r.source,i=r.internal;const values=[r.id,i.scenarioId,i.platform,i.entityId,s.accountId,s.virtualAccountId,s.cardId,s.status,s.detailedStatus,s.amountCents,r.currency,r.direction,s.originalCurrency?.code,s.originalCurrency?.amountCents,s.originalCurrency?.conversionRate,s.accountSubtype,s.authorizedAt,s.date,r.dateMeaning,s.orderId,s.referenceNumber,s.providerAuthorizationId,s.merchantData?.description,s.merchantData?.categoryCode,s.merchantData?.location?.city,s.merchantData?.location?.state,s.merchantData?.location?.country,s.merchantData?.location?.zip,s.memo,s.declineReason,s.approvalReason,s.fxFeeInfo?.amountCents,s.cashbackInfo?.amountCents,s.cashbackInfo?.rate,i.firstCollectedAt,i.lastSyncedAt,i.syncError,i.matchingStatus];res.write(values.map(escape).join(',')+'\r\n');}page++;if(page*100>=result.total)break;}while(!res.destroyed);
    return res.end();
   }
   const match=endpoint.match(/^(transactions|accounts|cards|virtual-accounts)(?:\/([^/]+))?$/);
   if(match){const kind={transactions:'transaction',accounts:'account',cards:'card','virtual-accounts':'virtualAccount'}[match[1]];
    if(!match[2])return send(res,listRecords(db,namespace,kind,q));
    const d=getDetail(db,namespace,kind,decodeURIComponent(match[2]),q);return d?send(res,d):send(res,{message:'Demo记录不存在'},404);
   }
   return send(res,{message:'接口不存在'},404);
  }catch(error){send(res,{message:error.message},error.status||400);}
 });
 const worker=setInterval(()=>{try{processQueuedCardJobs(db,namespace);}catch{}},500);worker.unref();
 server.on('close',()=>clearInterval(worker));
 return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const db=openStore();const live=createLiveBridge();const server=createDemoServer(db,NAMESPACE,{live});server.listen(Number(process.env.MOVENTRA_WORKSPACE_PORT||8862),'127.0.0.1',()=>{console.log('Local workspace API ready on loopback');live.start();});server.on('close',()=>live.stop());process.on('SIGTERM',()=>server.close(()=>db.close()));}

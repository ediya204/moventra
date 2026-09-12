import {balanceOf,safeSource} from './model.mjs';
export const NAMESPACE='slash-clearing-v1';
export const AS_OF='2026-09-06T00:00:00.000Z';
export const definitions=[
 ['正常授权后全额清算',-10000,0,'授权100，入账100；释放全部冻结。'],
 ['授权100，清算80',-8000,0,'授权100，最终支出80；释放多冻结20。'],
 ['授权100，清算120',-12000,0,'授权100，最终支出120；补扣20的渠道规则待确认。'],
 ['一次授权分两次清算',-10000,0,'内部将两笔60/40清算关联原授权；公开API未给出通用父授权字段。'],
 ['授权拒绝',0,0,'拒绝不影响已入账或可用余额。'],
 ['授权全额撤销',0,0,'原冻结100全部释放，支出0。'],
 ['部分授权撤销',0,6000,'释放40，剩余授权冻结60；表达方式待确认。'],
 ['授权过期后延迟清算',-10000,0,'内部过期释放后收到100清算；过期来源状态映射待确认。'],
 ['未匹配原授权的清算',-8000,0,'80支出正常计入已入账；关联仍未匹配，禁止自动对账成功。'],
 ['清算后全额退款',0,0,'原消费100保留，独立退款+100。'],
 ['清算后部分退款',-7000,0,'原消费100，独立退款+30，净支出70。'],
 ['同一订单多次部分退款',-5000,0,'原消费100，退款+20、+30分别累计；订单号不唯一。'],
 ['退款处理失败',-10000,0,'原消费100，失败退款+100无余额影响。'],
 ['争议、临时贷记与扣回',-10000,0,'消费100；内部临时贷记+100、后续扣回-100；Slash表示方式待确认。'],
 ['外币消费与外汇费用',-11220,0,'原币100 EUR，美元入账110，独立外汇费2.20；费用信息不重复扣款。'],
 ['费用冲回、返现与调整',-9850,0,'消费100+费用3；内部费用冲回3、返现2、返现调整-0.50；净支出98.50。'],
 ['跨月清算与退款',-7500,0,'7月31日授权100，8月1日入账100，9月1日退款25；按入账月统计。'],
 ['Webhook重复、乱序及补同步',-9000,0,'三笔30消费；重复通知幂等、旧响应不回退、漏通知通过补同步恢复。'],
 ['待审批不占用余额',0,0,'pending_approval金额100，但可用与已入账余额都不变。'],
 ['缺失可选字段与真实零值',0,0,'零值入账交易保留0；未提供授权时间、汇率及商户数据保持缺失。'],
];
export function generateScenario(index,replica=1,seed=20260906){
 const def=definitions[index-1],id=`S${String(index).padStart(2,'0')}-R${String(replica).padStart(3,'0')}`;
 const prefix=`DEMO-SLASH-${id}`,accountId=`${prefix}-ACCOUNT`,cardId=`${prefix}-CARD`,virtualAccountId=`${prefix}-VA`,entityId='DEMO-ENTITY-001';
 const uncertain=[3,4,7,8,9,10,11,12,13,14,15,16,17,18].includes(index);
 const scenario={id,title:def[0],description:def[3],expectedNetCents:def[1],expectedHoldCents:def[2],confirmation:uncertain?'待Slash确认':'Demo规则验证'};
 const records=[],versions=[],relations=[],adjustments=[],events=[],deliveries=[],snapshots=[];
 const current=new Map();let seq=0;
 const time=n=>`2026-08-20T${String(10+Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}:00.000Z`;
 const internal={customerId:`DEMO-CUSTOMER-${id}`,customerName:`演示客户 ${id}`,email:`demo.${id.toLowerCase()}@example.com`,entityId,platform:'slash',scenarioId:id,firstCollectedAt:time(0),lastSyncedAt:AS_OF,syncError:null,matchingStatus:uncertain?(index===9?'unmatched':'pending_confirmation'):'demo_verified',assumption:'合成样本；客户映射、清算关系及版本仅为内部Demo假设。'};
 const add=(kind,source,extra={})=>records.push({kind,source:safeSource(kind,source),internal:{...internal,...extra},id:source.id||`${accountId}-BALANCE`,entityId});
 const card={id:cardId,accountId,virtualAccountId,last4:String(1000+((seed+index*31+replica*7)%9000)),name:`Demo ${id}`,expiryMonth:'12',expiryYear:'2028',status:index===5?'paused':'active',isPhysical:false,isSingleUse:false,cardGroupId:'DEMO-CARD-GROUP',cardGroupName:'Demo 运营验证',cardProductId:'DEMO-CARD-PRODUCT',createdAt:'2026-07-01T00:00:00.000Z',spendingConstraint:{spendingRule:{utilizationLimitV2:[{limitAmount:{amountCents:50000},preset:'monthly',timezone:'UTC'}]}}};
 add('account',{id:accountId,status:'open',name:`Demo ${id}`,type:'debit',createdAt:'2026-07-01T00:00:00.000Z',balances:['debit']},{openingBalanceCents:100000,currency:'USD'});
 add('virtualAccount',{id:virtualAccountId,name:`Demo 虚拟账户 ${id}`,accountId,accountType:'default'});
 add('card',card);
 const snapshot=(step,at)=>{const b=balanceOf([...current.values()],adjustments);snapshots.push({id:`${prefix}-B${snapshots.length}`,accountId,scenarioId:id,currency:'USD',type:'debit',availableCents:b.available,postedCents:b.posted,timestamp:at,step});};
 snapshot('期初余额：内部Demo假设',time(0));
 const write=(suffix,amountCents,status,detailedStatus,extra={},at=time(++seq))=>{
  const tid=`${prefix}-${suffix}`;const prior=versions.filter(v=>v.source.id===tid);
  const s={id:tid,date:at,description:`${id} ${def[0]} / ${suffix}`,amountCents,status,detailedStatus,accountId,virtualAccountId,accountSubtype:'cash',cardId,orderId:`DEMO-ORDER-${id}`,referenceNumber:`DEMO-REF-${id}-${suffix}`,memo:`Demo / 模拟数据 · ${def[3]}`,merchantData:{description:`DEMO MERCHANT ${id}`,categoryCode:'5734',location:{city:'Demo City',state:'CA',country:'US',zip:'00000'}},...extra};
  versions.push({kind:'transaction',source:safeSource('transaction',s),internal:{...internal,firstCollectedAt:prior[0]?.collectedAt||at},entityId,version:prior.length+1,collectedAt:at});current.set(tid,safeSource('transaction',s));snapshot(`${suffix} → ${status}/${detailedStatus}`,at);return tid;
 };
 const purchase=(amount=10000,postedAmount=amount)=>{const authorizedAt=time(++seq);write('T1',-amount,'pending','pending',{authorizedAt,providerAuthorizationId:`DEMO-AUTH-${id}`},authorizedAt);return write('T1',-postedAmount,'posted','settled',{authorizedAt,providerAuthorizationId:`DEMO-AUTH-${id}`});};
 const relate=(from,to,type,evidence='内部Demo测试脚本显式指定关联；非Slash父交易字段')=>relations.push({id:`${prefix}-REL${relations.length+1}`,scenarioId:id,fromId:from,toId:to,type,evidence,confirmation:'待Slash确认'});
 const adjust=(sourceId,amountCents,reason)=>{const a={id:`${prefix}-ADJ${adjustments.length+1}`,scenarioId:id,accountId,sourceId,amountCents,occurredAt:time(++seq),reason,confirmation:'待Slash确认'};adjustments.push(a);snapshot(reason,a.occurredAt);};
 const refund=(original,suffix,amount,status='posted',at)=>{const r=write(suffix,amount,status,status==='posted'?'refund':'failed',{},at);relate(r,original,'refund');return r;};
 if(index<=3)purchase(10000,[10000,8000,12000][index-1]);
 if(index===4){const auth=write('AUTH',-10000,'pending','pending');write('AUTH',-10000,'failed','reversed');for(const [key,amount]of [['T1',6000],['T2',4000]])relate(write(key,-amount,'posted','settled'),auth,'capture');}
 if(index===5)write('T1',-10000,'failed','declined',{declineReason:'Demo: insufficient funds'});
 if(index===6){write('T1',-10000,'pending','pending');write('T1',-10000,'failed','reversed');}
 if(index===7){write('T1',-10000,'pending','pending');write('T1',-6000,'pending','pending',{memo:'内部模拟部分撤销40；Slash具体表达待确认'});}
 if(index===8){const a=write('AUTH',-10000,'pending','pending');write('AUTH',-10000,'failed','canceled',{memo:'内部过期假设；canceled与到期映射待Slash确认'});relate(write('T1',-10000,'posted','settled'),a,'late_capture');}
 if(index===9)write('T1',-8000,'posted','settled');
 if(index>=10&&index<=13){const p=purchase();if(index===10)refund(p,'REF1',10000);if(index===11)refund(p,'REF1',3000);if(index===12){refund(p,'REF1',2000);refund(p,'REF2',3000);}if(index===13)refund(p,'REF1',10000,'failed');}
 if(index===14){const p=purchase();relate(p,p,'dispute','内部争议测试，来源争议状态与资金影响未获确认');adjust(p,10000,'争议临时贷记（内部模拟）');adjust(p,-10000,'争议贷记扣回（内部模拟）');}
 if(index===15){const p=write('T1',-11000,'posted','settled',{originalCurrency:{code:'EUR',amountCents:-10000,conversionRate:1.1},fxFeeInfo:{amountCents:220}});const fee=write('FEE',-220,'posted','settled');add('fee',{id:fee,dateCharged:time(seq),feeAmountCents:220,feeType:'demo_fx_fee',accountId,originalTransaction:current.get(p),card},{assumption:'feeType是任意字符串；此演示值及收费规则待Slash确认'});relate(fee,p,'fee','FeeTransaction.originalTransaction（合成数据，不证明真实清算关联）');}
 if(index===16){const p=purchase();const source=current.get(p);write('T1',-10000,'posted','settled',{...source,cashbackInfo:{amountCents:200,rate:0.02}});const fee=write('FEE',-300,'posted','settled');add('fee',{id:fee,dateCharged:time(seq),feeAmountCents:300,feeType:'demo_service_fee',accountId,originalTransaction:current.get(p),card});relate(fee,p,'fee');adjust(fee,300,'费用冲回（内部模拟）');adjust(p,200,'返现入账（内部模拟，非cashbackInfo自动入账）');adjust(p,-50,'返现调整（内部模拟）');}
 if(index===17){const at='2026-07-31T23:50:00.000Z';// opening precedes the first operation
  snapshots[0].timestamp='2026-07-31T00:00:00.000Z';
  write('T1',-10000,'pending','pending',{authorizedAt:at},at);const p=write('T1',-10000,'posted','settled',{authorizedAt:at},'2026-08-01T00:10:00.000Z');refund(p,'REF1',2500,'posted','2026-09-01T09:00:00.000Z');}
 if(index===18){for(const k of ['T1','T2','T3']){write(k,-3000,'pending','pending');write(k,-3000,'posted','settled');}}
 if(index===19)write('T1',-10000,'pending','pending_approval');
 if(index===20)write('T1',0,'posted','settled',{merchantData:undefined,authorizedAt:undefined,orderId:undefined,referenceNumber:undefined});
 // Store all historical source versions, but keep only the authoritative current projection.
 for(const source of current.values())add('transaction',source,{firstCollectedAt:versions.find(v=>v.source.id===source.id).collectedAt});
 for(const v of versions){const eventId=`DEMO-EVENT-${id}-${events.length+1}`;events.push({event:v.version===1?'aggregated_transaction.create':'aggregated_transaction.update',eventId,entityId,eventTimestamp:v.collectedAt,sourceId:v.source.id,collectedAt:v.collectedAt});deliveries.push({id:`${eventId}-D1`,eventId,sourceId:v.source.id,receivedAt:v.collectedAt,result:'applied'});}
 if(index===18){
  const t1=events.find(e=>e.sourceId.endsWith('-T1'));deliveries.push({id:`${t1.eventId}-D2`,eventId:t1.eventId,sourceId:t1.sourceId,receivedAt:AS_OF,result:'duplicate_ignored'});
  const t2=events.find(e=>e.sourceId.endsWith('-T2'));deliveries.push({id:`${t2.eventId}-LATE`,eventId:t2.eventId,sourceId:t2.sourceId,receivedAt:AS_OF,result:'stale_response_ignored'});
  const missing=events.find(e=>e.sourceId.endsWith('-T3')&&e.event.endsWith('update'));events.splice(events.indexOf(missing),1);deliveries.splice(deliveries.findIndex(d=>d.eventId===missing.eventId),1);deliveries.push({id:`${prefix}-SYNC`,eventId:null,sourceId:missing.sourceId,receivedAt:AS_OF,result:'resync_without_notification'});
 }
 const final=snapshots.at(-1);add('balance',{accountId,type:'debit',available:{amountCents:final.availableCents},posted:{amountCents:final.postedCents},timestamp:AS_OF},{currency:'USD',assumption:'按Demo版本和内部调整计算的合成余额，不是Slash实时余额'});
 return {scenario,records,versions,relations,adjustments,events,deliveries,snapshots};
}

import {cardAdminRead,principal} from './card-admin.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
// Source projection and internal authorization remain distinct. No funding is inferred from a card limit.
export function readCardWorkspace(db,ns,actor,id,q,live){
 const p=principal(db,ns,actor);
 if(!p.permissions.includes('card.read'))fail('没有卡片查看权限',403);
 live.authorize(actor,ns);
 const row=live.read(`cards/${id}`,{},db).row;
 const owner=row.internal;
 const catalog=row.cardProductId?db.prepare("SELECT DISTINCT p.prefix FROM channel_products p JOIN card_channels c ON c.namespace=p.namespace AND c.id=p.channel_id WHERE p.namespace=? AND c.provider='slash' AND c.account_ref=? AND p.source_id=?").all(ns,row.accountId||'',row.cardProductId):[];
 row.bin=catalog.length===1?catalog[0].prefix:null;
 const page=Number(q.page||0);if(!Number.isInteger(page)||page<0||page>100000)fail('分页参数无效');
 if(p.owner_scope!=='*'&&p.owner_scope!==owner?.customerId)fail('卡片不在授权范围',403);
 const reasons={freeze:'Slash 写权限及执行通道尚未启用',unfreeze:'尚未接入此渠道的客户解冻流程',transfer_in:'未建立经过确认的卡资金账户映射',transfer_out:'未建立经过确认的卡资金账户映射',debit:'未建立卡资金映射及正式收款科目'};
 const permissions={freeze:'card.freeze',unfreeze:'card.unfreeze.request',transfer_in:'card.transfer_in',transfer_out:'card.transfer_out',debit:'card.debit'};
 const actions=Object.fromEntries(Object.entries(reasons).map(([k,v])=>[k,{allowed:false,reason:!p.permissions.includes(permissions[k])?'无此操作权限':!owner?.customerId?'未绑定内部用户':v}]));
 const audit=db.prepare("SELECT id,actor,action,description AS note,created_at FROM mg_audit WHERE namespace=? AND target_id=? AND json_valid(description) AND json_extract(description,'$.connection')=? AND json_extract(description,'$.platform')='slash' ORDER BY created_at DESC,id DESC LIMIT 10 OFFSET ?");
 // Ownership audit uses composite resource; do not merge another connection's card with the same ID.

 return {card:{id,name:row.cardName||row.name||'卡片名称未采集',last4:row.maskedCardNumber?.slice(-4)||null,owner_id:owner?.customerId||null,owner:owner?.customerId?{id:owner.customerId,name:owner.customerName,email:owner.email}:null,status:'unmanaged',provider_status:row.cardStatus||'unknown',self_frozen:null,risk_frozen:null,reason:null,actor:null,operated_at:null,revision:owner?.ownershipRevision||0,balance:null,executionMode:'Slash 只读接入',fundingNote:'当前未建立内部卡资金分户及上游资金池映射。消费限额不是可用资金。',actions,channel:'Slash',observedAt:row.observedAt||null,source:row,latestExecution:null},accounts:[],operations:{rows:[],total:0,page:0,pageSize:10},unfreezeRequests:[],audit:audit.all(ns,id,live.config().connectionId,page*10).map(a=>({...a,note:`用户绑定：${JSON.parse(a.note).previousUserId||'未绑定'} → ${JSON.parse(a.note).userId}；${JSON.parse(a.note).reason}`})),ledger:[],sourceMode:'slash'};
}
export function readCardTransactions(db,ns,actor,id,q,live){
 if(q.source==='slash'){readCardWorkspace(db,ns,actor,id,q,live);return live.read('transactions',{...q,cardId:id,cardOnly:'true'},db);}
 cardAdminRead(db,ns,actor,`cards/${id}`);
 const page=Math.max(0,Math.trunc(Number(q.page)||0)),size=10;
 let where="namespace=? AND kind='transaction' AND card_id=?",args=[ns,id];
 if(q.detailedStatus){where+=' AND detailed_status=?';args.push(q.detailedStatus);}
 if(q.originalCurrency){where+=' AND original_currency=?';args.push(q.originalCurrency);}
 if(q.from){where+=' AND source_date>=?';args.push(q.from);}
 if(q.to){where+=' AND source_date<?';args.push(q.to);}
 const total=db.prepare(`SELECT count(*) n FROM source_records WHERE ${where}`).get(...args).n;
 const rows=db.prepare(`SELECT source_json FROM source_records WHERE ${where} ORDER BY source_date DESC,source_id LIMIT ? OFFSET ?`).all(...args,size,page*size).map(r=>{const s=JSON.parse(r.source_json);return {...s,merchant:s.merchantData?.description||s.description,amountCents:s.amountCents==null?null:String(s.amountCents),originalCurrency:s.originalCurrency?{...s.originalCurrency,amountCents:String(s.originalCurrency.amountCents)}:null,postedAt:s.status==='posted'?s.date:null};});
 return {rows,total,page,pageSize:size};
}

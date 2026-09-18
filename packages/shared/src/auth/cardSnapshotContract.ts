// Read-only, personal-customer test snapshots. No admin/provider proxy.
export function isCardSnapshotPath(path: string): boolean {
 if (path.includes('#') || path.split('?').length > 2) return false;
 const [pathname,query='']=path.split('?');
 const base='/client-api/v1/customers/[0-9a-f-]{36}/card-projections';
 if(new RegExp(`^${base}$`).test(pathname))return !query;
 if(new RegExp(`^${base}/[A-Za-z0-9_-]+/(cards|transactions)/[A-Za-z0-9_-]+$`).test(pathname))return !query;
 if(!new RegExp(`^${base}/[A-Za-z0-9_-]+/(cards|transactions)$`).test(pathname))return false;
 const params=new URLSearchParams(query);
 const allowed=pathname.endsWith('/cards')?['page','revision','keyword','cardStatus']:['page','revision','keyword','detailedStatus','from','to','cardId','metric'];
 return [...params.keys()].every(key=>allowed.includes(key)&&params.getAll(key).length===1);
}
export function snapshotAmount(value?:string|null, currency='USD'):string {
 if(value==null || !/^(0|-?[1-9][0-9]*)$/.test(value))return '未知';
 if(!['USD','CNY','AED'].includes(currency))return `${currency} ${value}`;
 const negative=value.startsWith('-'), digits=(negative?value.slice(1):value).padStart(3,'0');
 return `${currency} ${negative?'−':''}${digits.slice(0,-2)}.${digits.slice(-2)}`;
}

export function isCardSyncPath(path:string):boolean {
 return /^\/(?:client-api\/v1\/customers\/[0-9a-f-]{36}\/card-projections|admin-api\/v1\/channel-projections)\/[A-Za-z0-9_-]+\/cards\/[A-Za-z0-9_-]+\/(?:sync|metrics-sync)$/.test(path);
}
export type CardSyncInfo={metrics?:CardMetrics;syncState?:string;checkedAt?:string;controlsEnabled?:boolean;cardAction?:{id:string;state:string;targetStatus:string;error?:string}|null};
export function cardSyncLabel(row:CardSyncInfo):string {
 const labels:Record<string,string>={synced:'已核验',pending:'同步中',unverified:'尚未核验',stale:'待核实',error:'同步异常'};
 return row.syncState ? (labels[row.syncState]||'待核实')+(row.checkedAt?' · '+new Date(row.checkedAt).toLocaleString('zh-CN'):' · 尚未核验') : '导入快照';
}

export function isCardActionPath(path:string):boolean { return path.endsWith("/actions") && isCardSyncPath(path.slice(0,-8)+"/sync"); }

export type CardMetrics={cycleSpendMinor?:string|null;totalLimitMinor?:string|null;currency:string;scale:number;availableMinor:string|null;availableAt:string|null;availability:'unknown'|'not_supported'|'available';sharedGroup:boolean;nextResetAt:string|null;from:string|null;to:string|null;updatedAt:string|null;coverage:'complete'|'incomplete';spendingMinor:string|null;refundMinor:string|null;syncState:'idle'|'pending'|'error'};
export function cardMetricDisplay(metrics:CardMetrics|undefined,kind:'available'|'spending'):{value:string;help:string} {
 if(!metrics)return {value:'待同步',help:'尚未完成历史数据同步。'};
 const asOf=kind==='available'?metrics.availableAt:metrics.to;
 const time=asOf?new Date(asOf).toLocaleString('zh-CN',{hour12:false}):'未知';
 if(kind==='available')return {value:metrics.availableMinor===null?(metrics.availability==='not_supported'?'未提供':'待同步'):snapshotAmount(metrics.availableMinor,metrics.currency),help:`可消费额度，非可提现余额${metrics.sharedGroup?'；受卡组限制':''}。采集时间：${time}。`};
 return {value:metrics.coverage==='complete'&&metrics.spendingMinor!==null?snapshotAmount(metrics.spendingMinor,metrics.currency):'同步未完成',help:`截至 ${time} 的近 30 天已入账消费；退款、费用及待入账分开统计。${metrics.syncState==='error'?'同步异常，请重试。':metrics.syncState==='pending'?'正在更新。':''}`};
}

// Progress is meaningful only when one observed card limit reconciles exactly.
export function cardQuotaDisplay(metrics?:CardMetrics){
 const valid=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
 const supported=metrics?.currency==='USD'&&metrics.scale===2;
 const amount=(v:unknown)=>supported&&valid(v)?snapshotAmount(v,'USD'):'未提供';
 const remaining=metrics?.availability==='available'?metrics.availableMinor:null;
 const total=metrics?.sharedGroup?null:metrics?.totalLimitMinor;
 const used=metrics?.cycleSpendMinor;
 let percent:number|null=null;
 if(supported&&valid(total)&&valid(used)&&valid(remaining)&&BigInt(total)>0n&&BigInt(used)+BigInt(remaining)===BigInt(total))percent=Number(BigInt(used)*10000n/BigInt(total))/100;
 return {remaining:metrics?amount(remaining):'待同步',used:metrics?amount(used):'待同步',total:metrics?amount(total):'待同步',percent};
}

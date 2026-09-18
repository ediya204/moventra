export type ManualOrder={id:string;customerId:string;actorId?:string;reviewerId?:string;direction:'credit'|'debit';source:string;currency:string;amountMinor:string;state:string;revision:number;note?:string;evidenceRef?:string;originalId:string;error?:string;paymentEvidence?:string;walletBeforeMinor:string|null;walletAfterMinor:string|null;createdAt:string;updatedAt:string};
export type BalanceRow={userId:string;customerId:string;name:string;email:string|null;status:string;onboarding:string;service:string;currency:string;walletMinor:string|null;heldMinor:string|null;cardsMinor:string|null;totalMinor:string|null;pendingOperations:number;coverage:string;walletRegistered:boolean};
export type BalanceData={rows:BalanceRow[];total:number;page:number;currency:string;summary:{walletMinor:string|null;heldMinor:string|null;cardsMinor:string|null;totalMinor:string|null;coverage:string};mode:string;enabled:boolean;observedAt:string;permissions?:string[];movements?:{id:string;operationId:string;kind:string;evidenceRef:string;amountMinor:string;from:string;to:string;createdAt:string}[];movementTotal?:number;cards?:{id:string;name:string;connection:string;cardId:string;amountMinor:string}[];cardTotal?:number};
const id='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function manualFundsRoute(method:string,path:string):boolean{
 if(path.includes('#')||path.split('?').length>2)return false;
 const [p,q='']=path.split('?'),params=new URLSearchParams(q);
 const query=(keys:string[])=>[...params].every(([k,v])=>keys.includes(k)&&params.getAll(k).length===1&&(k!=='page'||/^(0|[1-9][0-9]{0,4})$/.test(v)&&Number(v)<=10000));
 if(method==='GET'){
  if(p==='/admin-api/v1/balances')return query(['page','q','currency','status']);
  if(new RegExp(`^/admin-api/v1/balances/${id}$`).test(p))return query(['currency','page']);
  if(new RegExp(`^/(client|admin)-api/v1/customers/${id}/manual-funds$`).test(p))return query(['page']);
  return new RegExp(`^/(client|admin)-api/v1/customers/${id}/manual-funds/orders/${id}$`).test(p)&&!q;
 }
 return method==='POST'&&!q&&new RegExp(`^/admin-api/v1/customers/${id}/manual-funds/orders(?:/${id}/(?:approve|reject|cancel|confirm_payment|payment_failed|reconcile))?$`).test(p);
}
export const manualLabels:Record<string,string>={platform_advance:'平台垫资',offline_receipt:'线下到账',advance_recovery:'垫资回收',offline_payout:'线下付款',reversal:'冲正',pending_review:'待审核',reserving:'预占中',processing:'记账中',awaiting_payment:'待确认付款',releasing:'释放预占中',completed:'已完成',rejected:'已拒绝',cancelled:'已取消',failed:'失败',credit:'入金',debit:'出金',journal_only:'账本记录',pending_reconciliation:'处理中，待核对',not_opened:'未开通',ledger_disabled:'资金服务未启用'};

export type Wallet={id:string;customer:string;asset:string;network:string;scale:number;postedMinor:string;heldMinor:string;availableMinor:string};
export type FixedPrice = {
  version: number;
  usdPerUsdt: string;
  actor: string;
  reason: string;
  updatedAt: string;
  mode: "fixed";
  scope: string;
};
export type Context = {
  fixedPrice: FixedPrice;
  actor: string;
  permissions: string[];
  wallets: Wallet[];
  counts: Record<string, number>;
  customers: string[];
  policy: string;
  channel: string;
  formalPolicy: string;
  withdrawalPolicy: {
    feeMinor: string;
    minMinor: string;
    maxMinor: string;
    asset: string;
    network: string;
  };
};
export type Quote = {
  id: string;
  sellAsset: string;
  buyAsset: string;
  sellMinor: string;
  buyMinor: string;
  feeMinor: string;
  rate: string | null;
  mode?: "fixed";
  priceVersion?: number;
  usdPerUsdt?: string;
  rateDirection: string;
  source: string;
  lockCondition: string;
  expiresAt: string | null;
};
export type Order={id:string;kind:string;customer:string;asset:string;network:string;amount_minor:string;fee_minor:string;approval:string;execution:string;state:string;risk:string;revision:number;requester:string;parent_id:string|null;created_at:string;updated_at:string;address:string|null;memo:string|null;source:string|null;target:string|null;reason:string;evidence:string|null;accounting:string;chain:string;deliveredMinor:string;remainingMinor:string;feePostedMinor:string;error:string|null;quote?:Quote;requiredNodes:string[];policyVersion:string;txHash?:string|null;confirmations?:number|null;channelReference?:string|null;receiptState?:string;paymentState?:string;counterparty?:string};
export type Movement={id:string;order_id:string;journal_id:string;account_id:string;customer:string;kind:string;asset:string;network:string;amount_minor:string;before_minor:string;after_minor:string;created_at:string;direction?:string;order?:Order};
export type Detail={order:Order;wallet:Wallet|null;reviews:{revision:number;actor:string;node:string;decision:string;note:string;created_at:string}[];timeline:{id:string;actor:string;action:string;note:string;created_at:string}[];events:{event_id:string;result:string;received_at:string;payload:{status:string;cumulativeMinor:string;confirmations?:number}}[];movements:Movement[];related:Order[];job:{submission_key:string;revision:number;queries:number}|null};
export type Page<T>={rows:T[];total:number;page:number;pageSize:number;totals:{asset:string;network:string;inMinor:string;outMinor:string;netMinor:string}[];meta:{asOf:string;coverage:string;timeBasis:string}};
export const names:Record<string,string>={deposit:'充值入账',withdrawal:'出金',otc:'OTC 兑换',transfer:'内部转账',fee:'手续费',refund:'退款',adjustment:'账务调整',draft:'草稿',awaiting_execution:'待执行',pending:'待审批',reviewing:'审批中',approved:'已批准',rejected:'已拒绝',cancelled:'已撤销',returned:'待补充资料',not_required:'无需审批',not_submitted:'未提交执行',submitting:'提交中',channel_processing:'通道处理中',chain_confirming:'链上确认中',processing:'处理中',completed:'已完成',failed:'明确失败',unknown:'结果待确认',exception:'异常',unposted:'未入账',posted:'已入账',partially_posted:'部分入账',not_applicable:'不适用',not_broadcast:'未广播',confirming:'确认中',confirmed:'已确认（测试）',partially_confirmed:'部分已确认',unchecked:'未检查',demo_checked:'隔离检查完成',blocked:'测试风险拦截',received:'已收到',not_received:'未收款',paid:'已支付',not_paid:'未付款',approve:'批准',reject:'拒绝',reviewer:'审核员',controller:'控制员'};
export const label=(s?:string|null)=>s?(names[s]||s):'—';
export const scale=(asset:string)=>asset==='USDT'?6:2;
export function money(v: string | null | undefined, asset: string) {
  if (v == null) return "—";
  const n = BigInt(v),
    a = n < 0n ? -n : n,
    p = asset === 'USDT' || asset === 'USD' ? 2 : scale(asset),
    divisor = 10n ** BigInt(scale(asset) - p),
    rounded = (a + divisor / 2n) / divisor,
    f = 10n ** BigInt(p);
  return `${asset} ${n < 0n && rounded !== 0n ? "-" : ""}${(rounded / f).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(rounded % f).padStart(p, "0")}`;
}
// Editing must retain source precision instead of parsing rounded display text.
export function amountInput(v: string, asset: string) {
  const n = BigInt(v), a = n < 0n ? -n : n, p = scale(asset), f = 10n ** BigInt(p);
  return `${n < 0n ? '-' : ''}${a / f}.${String(a % f).padStart(p, '0')}`;
}
export function units(v:string,asset:string){const p=scale(asset);if(!new RegExp(`^\\d+(\\.\\d{1,${p}})?$`).test(v))throw new Error(`请输入最多 ${p} 位小数的正金额`);const [w,d='']=v.split('.');const n=BigInt(w)*10n**BigInt(p)+BigInt(d.padEnd(p,'0'));if(n<=0n||n>1000000000000n)throw new Error('金额超出本地演示范围');return String(n);}
export const date=(s?:string|null)=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'—';
export const orderLink=(o:Pick<Order,'id'|'kind'>)=>`/finance/${o.kind==='otc'?'otc':o.kind==='withdrawal'?'withdrawals':'records'}/${encodeURIComponent(o.id)}`;

// Presentation gate only; the service rechecks price version and policy at submission.
export function quoteUsable(quote: Quote | null | undefined, priceVersion: number, now: number) {
  if (!quote) return false;
  if (quote.mode === 'fixed') return quote.priceVersion === priceVersion;
  return quote.expiresAt != null && Date.parse(quote.expiresAt) > now;
}

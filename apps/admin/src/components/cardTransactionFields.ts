// Display-only contract. Source values and server query parameters are unchanged.
export const fieldLabels = {
  cardName: '卡片名称', last4: '卡号后四位', cardStatus: '卡片状态', providerStatus: '渠道状态',
  merchant: '商户 / 交易', cardId: '所属卡片', original: '原币金额', amount: '账户金额',
  status: '入账状态', detailedStatus: '详细状态', authorizedAt: '授权时间 · UTC',
  postedAt: '入账时间 · UTC', sourceDate: '来源日期 · UTC', observedAt: '采集时间 · UTC',
  createdAt: '创建时间 · UTC', sync: '同步状态', action: '操作', category: '业务类型',
} as const;
export const postingLabels: Record<string,string> = {pending:'待入账',posted:'已入账',failed:'入账失败'};
export const detailLabels: Record<string,string> = {pending:'待处理',pending_approval:'待批准',in_review:'审核中',canceled:'已取消',failed:'失败',settled:'已结算',declined:'已拒绝',refund:'退款',reversed:'授权已撤销',returned:'退回',dispute:'争议'};
export const cardLabels: Record<string,string> = {active:'使用中',paused:'渠道暂停',inactive:'未激活',closed:'已关闭'};
export type TransactionStatusColor = 'default' | 'success' | 'warning' | 'error' | 'info';
// UI projection only: keep both Slash source status fields unchanged.
export function transactionStatus(status?: string | null, detail?: string | null): {label:string;color:TransactionStatusColor} {
 const raw = detail || status;
 if (!raw) return {label:'—',color:'default'};
 if ((status && !postingLabels[status]) || (detail && !detailLabels[detail]))
  return {label:`未知状态 · ${detail && !detailLabels[detail] ? detail : status}`,color:'default'};
 if (detail === 'settled') return status === 'posted'
  ? {label:'已结算',color:'success'} : {label:'待核实',color:'warning'};
 if (detail === 'refund') return status === 'posted'
  ? {label:'已退款',color:'info'} : status === 'pending'
   ? {label:'退款处理中',color:'warning'} : {label:'待核实',color:'warning'};
 const specific: Record<string,{label:string;color:TransactionStatusColor}> = {
  pending:{label:'待入账',color:'warning'}, pending_approval:{label:'待批准',color:'warning'},
  in_review:{label:'审核中',color:'warning'}, canceled:{label:'已取消',color:'default'},
  failed:{label:'失败',color:'error'}, declined:{label:'已拒绝',color:'error'},
  reversed:{label:'已撤销',color:'info'}, returned:{label:'已退回',color:'info'},
  dispute:{label:'争议中',color:'error'},
 };
 if (detail) return specific[detail];
 return {label:postingLabels[status!],color:status==='posted'?'success':status==='failed'?'error':'warning'};
}
// Derive presentation from the current response each render; never persist a previous row tone.
export function transactionRowClass(status?:string|null,detail?:string|null):string {
 const display=transactionStatus(status,detail);
 if(display.label.startsWith('未知状态')||display.label==='待核实')return '';
 if(detail==='reversed')return 'transaction-reversed';
 if(display.color==='error')return 'transaction-error';
 if(display.color==='warning')return 'transaction-pending';
 return '';
}
export function sourceLabel(value: unknown, labels: Record<string,string>): string {
 if (value == null || value === '') return '—';
 const raw=String(value); return labels[raw] ? `${labels[raw]} · ${raw}` : `未知状态 · ${raw}`;
}
export function utcTime(value?: string | null): string {
 if (!value) return '—';
 const date=new Date(value); if (!Number.isFinite(date.getTime())) return '无效时间';
 return date.toISOString().slice(0,19).replace('T',' ');
}
export function minorText(value?: string | null, scale=2): string {
 if (value == null || value === '') return '—';
 if (!/^-?\d+$/.test(value) || !Number.isInteger(scale) || scale<0 || scale>18) return '无效金额';
 const n=BigInt(value),a=n<0n?-n:n,f=10n**BigInt(scale);
 return `${n<0n?'−':''}${(a/f).toLocaleString('en-US')}${scale?'.'+String(a%f).padStart(scale,'0'):''}`;
}
export function originalText(value?: {code?:string|null;amountCents?:string|null} | null): string {
 if (!value || value.amountCents == null) return '—';
 // Only the validated two-decimal source currencies are formatted as major units.
 if (!value.code || !['USD','CNY','AED'].includes(value.code)) return `${value.code || '币种未知'} ${value.amountCents}（来源最小单位）`;
 return `${value.code} ${minorText(value.amountCents)}`;
}

// Common card-transaction detailedStatus filters; retain all raw states in detailLabels.
export const slashTransactionFilters: {value:string;label:string;color:TransactionStatusColor}[] = [
 {value:'pending',label:'待入账',color:'warning'},
 {value:'settled',label:'已结算',color:'success'},
 {value:'declined',label:'已拒绝',color:'error'},
 {value:'reversed',label:'已撤销',color:'info'},
 {value:'refund',label:'退款',color:'info'},
 {value:'dispute',label:'争议中',color:'error'},
];

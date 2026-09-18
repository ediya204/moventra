import {snapshotAmount} from '../../../../packages/shared/src/auth/cardSnapshotContract';

export const transactionStatuses: Record<string,string> = {
 pending:'待处理',pending_approval:'待批准',in_review:'审核中',settled:'已结算',
 declined:'已拒绝',failed:'失败',refund:'退款',reversed:'已撤销',returned:'退回',canceled:'已取消',dispute:'争议',
};
export type TransactionFilters={keyword:string;status:string;from:string;to:string};
export const emptyTransactionFilters:TransactionFilters={keyword:'',status:'',from:'',to:''};
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function transactionFilterError(filters:TransactionFilters){
 if(filters.keyword.length>200)return '搜索内容不能超过 200 个字符。';
 if(filters.status&&!transactionStatuses[filters.status])return '交易状态无效，请清空筛选后重试。';
 if((filters.from&&!validDate(filters.from))||(filters.to&&!validDate(filters.to)))return '请输入有效日期。';
 if(filters.from&&filters.to&&filters.from>filters.to)return '结束日期不能早于开始日期。';
 if(filters.to==='9999-12-31')return '结束日期超出支持范围。';
 return '';
}
export function transactionQuery(filters:TransactionFilters,page:number,revision:string){
 const error=transactionFilterError(filters);if(error)throw new Error(error);
 const query=new URLSearchParams({page:String(page),revision});
 if(filters.keyword)query.set('keyword',filters.keyword);
 if(filters.status)query.set('detailedStatus',filters.status);
 if(filters.from)query.set('from',filters.from+'T00:00:00Z');
 if(filters.to)query.set('to',new Date(Date.parse(filters.to+'T00:00:00Z')+86400000).toISOString());
 return query;
}
export type ExportTransaction={id:string;merchant?:string;cardId?:string;cardName?:string;cardLast4?:string;amountCents?:string;originalCurrency?:{code?:string;amountCents?:string};status?:string;detailedStatus?:string;date?:string};
type ExportPage<T>={rows:T[];total:number;revision:string};
export async function collectTransactions<T extends {id:string}>(read:(page:number)=>Promise<ExportPage<T>>,revision:string,onProgress:(count:number,total:number)=>void,canceled:()=>boolean){
 const rows:T[]=[],seen=new Set<string>();let total:number|undefined;
 for(let page=0;;page++){
  if(canceled())throw new Error('已取消导出。');
  const next=await read(page);
  if(canceled())throw new Error('已取消导出。');
  if(next.revision!==revision||total!==undefined&&next.total!==total)throw new Error('交易数据已更新，请刷新后重新导出。');
  total=next.total;
  if(!Number.isSafeInteger(total)||total<0||total>5000)throw new Error('单次最多导出 5,000 条，请缩小日期范围后重试。');
  for(const row of next.rows){if(seen.has(row.id))throw new Error('分页数据发生变化，请刷新后重新导出。');seen.add(row.id);rows.push(row);}
  if(rows.length>total)throw new Error('交易数据已更新，请刷新后重新导出。');
  onProgress(rows.length,total);
  if(rows.length===total)return rows;
  if(next.rows.length!==20)throw new Error('交易数据不完整，请刷新后重新导出。');
 }
}
function csvCell(value:string){return '"'+(/^[\s\u0000-\u001f]*[=+@-]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';}
export function transactionsCsv(rows:ExportTransaction[]){
 const lines=[['交易 ID','商户','卡片名称','卡号后四位','账户金额（USD）','原币金额','原币代码','入账状态','详细状态','来源时间（UTC）'],
 ...rows.map(row=>[row.id,row.merchant||'未知商户',row.cardName||'',row.cardLast4?"'"+row.cardLast4:'',snapshotAmount(row.amountCents),snapshotAmount(row.originalCurrency?.amountCents,row.originalCurrency?.code||'币种未知'),row.originalCurrency?.code||'',row.status||'未知',row.detailedStatus||'未知',row.date||'未知'])];
 return '\uFEFF'+lines.map(line=>line.map(csvCell).join(',')).join('\r\n');
}

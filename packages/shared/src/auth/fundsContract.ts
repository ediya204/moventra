export type FundsCommand={action:string;currency?:string;amountMinor?:string;quoteId?:string;orderId?:string;revision?:number;recipientLabel?:string;note?:string};
const id='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function isFundsPath(path:string,write=false){
 if(path.includes('#')||path.split('?').length>2)return false;
 const [base,query='']=path.split('?');
 if(write)return !query&&new RegExp(`^/(client|admin)-api/v1/customers/${id}/test-funds/commands$`).test(base);
 if(base==='/admin-api/v1/test-funds-scopes')return !query;
 if(new RegExp(`^/(client|admin)-api/v1/customers/${id}/test-funds/orders/${id}$`).test(base))return !query;
 if(!new RegExp(`^/(client|admin)-api/v1/customers/${id}/test-funds$`).test(base))return false;
 const params=new URLSearchParams(query);return [...params.keys()].every(k=>['kind','status','page'].includes(k)&&params.getAll(k).length===1);
}
export function parseFundsAmount(value:string,currency:string){
 const scale=currency==='USD'?2:6;
 if(!new RegExp(`^(0|[1-9][0-9]{0,6})(?:\\.[0-9]{1,${scale}})?$`).test(value))throw new Error('请输入有效金额，USD 最多 2 位小数，USDT 最多 6 位小数。');
 const [whole,fraction='']=value.split('.');const n=BigInt(whole+fraction.padEnd(scale,'0'));
 if(n<=0n||n>1000000n*10n**BigInt(scale))throw new Error('单笔金额必须大于 0，且不超过 1,000,000。');return n.toString();
}
export function fundsAmount(value:string,currency:string){const scale=currency==='USD'?2:6;const n=BigInt(value);const digits=(n<0n?-n:n).toString().padStart(scale+1,'0');return `${n<0n?'−':''}${digits.slice(0,-scale).replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${digits.slice(-scale)} ${currency}`;}

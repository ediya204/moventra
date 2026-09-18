export type CryptoSettings={networkFees?:Record<string,string|null>;cardDepositFeeMinor?:string|null;cardWithdrawFeeMinor?:string|null;revision:number;otcEnabled:boolean;withdrawEnabled:boolean;usdtToUsd:string;usdToUsdt:string;withdrawalFeeMinor:string|null};
export type CryptoQuote={id:string;kind:'otc'|'withdrawal'|'card_transfer';network?:string;cardId?:string;direction?:string;customerId:string;currency:'USD'|'USDT';toCurrency:'USD'|'USDT';amountMinor:string;receiveMinor:string;feeMinor:string;rate:string;policyRevision:number;expiresAt:string};
export type CryptoOrder={id:string;customerId:string;kind:'deposit'|'withdrawal'|'otc'|'card_transfer';network?:string;cardId?:string;direction?:string;state:string;revision:number;currency:'USD'|'USDT';toCurrency:'USD'|'USDT';amountMinor:string;receiveMinor:string;feeMinor:string;address:string;quote?:CryptoQuote;approvalStatus:string;providerStatus:string;chainStatus:string;postingStatus:string;error:string;txHash:string;createdAt:string;updatedAt:string};
export type CryptoSnapshot={pendingDepositsMinor?:Record<string,string>;capabilities?:{currencies:string[];network:string;realWrites:false;quoteSeconds:number};mode:'shadow'|'live';executionEligible:boolean;customerId:string;settings:CryptoSettings;ledger:{accounts:{id:string;kind:string;currency:'USD'|'USDT';postedMinor:string;heldMinor:string;ledgerAvailableMinor:string}[];reconciliation:string;totalsMinor:Record<string,string>};orders:CryptoOrder[];addresses:{address:string;network:string;mode:string}[];total:number;page:number};
const id='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function cryptoRoute(method:string,path:string):boolean{
 if(path.includes('#')||path.split('?').length>2)return false;
 const [pathname,query='']=path.split('?'),params=new URLSearchParams(query);
 if(method==='POST'&&query)return false;
 if(new RegExp(`^/client-api/v1/customers/${id}/deposit-addresses$`).test(pathname))return method==='POST'?!query:method==='GET'&&[...params].every(([k,v])=>params.getAll(k).length===1&&(k==='page'?/^\d+$/.test(v):k==='event'&&new RegExp(`^${id}$`).test(v)));
 if(method==='GET'){
  if(new RegExp(`^/admin-api/v1/crypto-sources/[A-Za-z0-9_-]+/events/${id}$`).test(pathname))return !query;
  if(pathname==='/admin-api/v1/crypto-scopes'||pathname==='/admin-api/v1/crypto-sources')return !query;
  if(/^\/admin-api\/v1\/crypto-sources\/[A-Za-z0-9_-]+\/events$/.test(pathname))return [...params].every(([k,v])=>k==='page'&&params.getAll(k).length===1&&/^\d+$/.test(v));
  const base=new RegExp(`^/(client|admin)-api/v1/customers/${id}/crypto$`);
  if(base.test(pathname))return [...params].every(([k])=>['page','kind','status','limit','cardId'].includes(k)&&params.getAll(k).length===1);
  return new RegExp(`^/(client|admin)-api/v1/customers/${id}/crypto/orders/${id}$`).test(pathname)&&!query;
 }
 if(method!=='POST')return false;
 return new RegExp(`^/client-api/v1/customers/${id}/crypto/(addresses|otc/(quotes|orders)|withdrawals/(quotes|orders)|cards/(quotes|orders)|cancel)$`).test(pathname)||new RegExp(`^/admin-api/v1/customers/${id}/crypto/(settings|approve|reject|recover)$`).test(pathname)||/^\/admin-api\/v1\/crypto-sources\/[A-Za-z0-9_-]+\/sync$/.test(pathname);
}
export function cryptoUnits(value:string,currency:string):string{const scale=currency==='USDT'?6:2;if(!new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${scale}})?$`).test(value))throw new Error('请输入有效金额');const [w,d='']=value.split('.');const n=BigInt(w)*10n**BigInt(scale)+BigInt(d.padEnd(scale,'0'));if(n<=0n||n.toString().length>38)throw new Error('金额超出范围');return n.toString();}
export function cryptoMoney(value:string,currency:string):string{const scale=currency==='USDT'?6:2;const n=BigInt(value),a=n<0n?-n:n,p=10n**BigInt(scale);return `${n<0n?'-':''}${a/p}.${(a%p).toString().padStart(scale,'0')} ${currency}`;}

// Keep in parity with shared cryptoContract.ts; covered by gateway tests.
const id='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function cryptoRoute(method,path){
 if(path.includes('#')||path.split('?').length>2)return false;
 const [pathname,query='']=path.split('?'),params=new URLSearchParams(query);
 if(method==='POST'&&query)return false;
 if(new RegExp(`^/client-api/v1/customers/${id}/deposit-addresses$`).test(pathname))return method==='POST'?!query:method==='GET'&&[...params].every(([k,v])=>params.getAll(k).length===1&&(k==='page'?/^\d+$/.test(v):k==='event'&&new RegExp(`^${id}$`).test(v)));
 if(method==='GET'){
  if(new RegExp(`^/admin-api/v1/crypto-sources/[A-Za-z0-9_-]+/events/${id}$`).test(pathname))return !query;
  if(pathname==='/admin-api/v1/crypto-scopes'||pathname==='/admin-api/v1/crypto-sources')return !query;
  if(/^\/admin-api\/v1\/crypto-sources\/[A-Za-z0-9_-]+\/events$/.test(pathname))return [...params].every(([k,v])=>k==='page'&&params.getAll(k).length===1&&/^\d+$/.test(v));
  const base=new RegExp(`^/(client|admin)-api/v1/customers/${id}/crypto$`);
  if(base.test(pathname))return [...params].every(([k])=>['page','kind','status','limit','cardId','from','to','direction'].includes(k)&&params.getAll(k).length===1);
  return new RegExp(`^/(client|admin)-api/v1/customers/${id}/crypto/orders/${id}$`).test(pathname)&&!query;
 }
 if(method!=='POST')return false;
 return new RegExp(`^/client-api/v1/customers/${id}/crypto/(addresses|otc/(quotes|orders)|withdrawals/(quotes|orders)|cards/(quotes|orders)|cancel)$`).test(pathname)||new RegExp(`^/admin-api/v1/customers/${id}/crypto/(settings|approve|reject|recover)$`).test(pathname)||/^\/admin-api\/v1\/crypto-sources\/[A-Za-z0-9_-]+\/sync$/.test(pathname);
}

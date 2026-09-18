// Keep in parity with shared manualFundsContract.ts.
const id='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function manualFundsRoute(method,path){
 if(path.includes('#')||path.split('?').length>2)return false;
 const [p,q='']=path.split('?'),params=new URLSearchParams(q);
 const query=(keys)=>[...params].every(([k,v])=>keys.includes(k)&&params.getAll(k).length===1&&(k!=='page'||/^(0|[1-9][0-9]{0,4})$/.test(v)&&Number(v)<=10000));
 if(method==='GET'){
  if(p==='/admin-api/v1/balances')return query(['page','q','currency','status']);
  if(new RegExp(`^/admin-api/v1/balances/${id}$`).test(p))return query(['currency','page']);
  if(new RegExp(`^/(client|admin)-api/v1/customers/${id}/manual-funds$`).test(p))return query(['page']);
  return new RegExp(`^/(client|admin)-api/v1/customers/${id}/manual-funds/orders/${id}$`).test(p)&&!q;
 }
 return method==='POST'&&!q&&new RegExp(`^/admin-api/v1/customers/${id}/manual-funds/orders(?:/${id}/(?:approve|reject|cancel|confirm_payment|payment_failed|reconcile))?$`).test(p);
}

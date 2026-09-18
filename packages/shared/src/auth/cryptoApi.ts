import {getFirebaseAuth} from '../firebase';
import {isAdminSite} from './site';
import {SessionError} from './liveApi';
import {cryptoRoute} from './cryptoContract';
export async function cryptoRequest<T>(path:string,body?:unknown,key?:string):Promise<T>{
 const method=body===undefined?'GET':'POST';
 if(!cryptoRoute(method,path)||(isAdminSite?path.startsWith('/client-api/'):path.startsWith('/admin-api/')))throw new SessionError('invalid_path');
 const user=getFirebaseAuth().currentUser;if(!user)throw new SessionError('unauthenticated',401);const token=await user.getIdToken();if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 const res=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key||''})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error'});
 let value;try{value=await res.json();}catch{throw new SessionError('invalid_api_response',res.status)}
 if(!res.ok)throw new SessionError(value?.error?.code||'crypto_unavailable',res.status);if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 if(value?.data==null||typeof value.data!=='object')throw new SessionError('invalid_api_response');return value.data as T;
}
export function cryptoError(e:unknown):string{
 const code=e instanceof SessionError?e.code:'';
 return ({crypto_disabled:'资金服务尚未启用。',crypto_unavailable:'资金服务暂不可用，请重试。',quote_expired_or_changed:'报价已过期或价格已更新，请重新获取报价。',configuration_changed:'配置已被更新，请刷新后重试。',order_changed:'订单已变化，请刷新后重试。',insufficient_balance:'钱包可用余额不足。',otc_disabled:'OTC 尚未配置或已暂停。',withdrawal_disabled:'提现尚未配置或已暂停。',invalid_network_address:'请输入与所选网络匹配的地址。',card_fee_not_configured:'卡片充提费用尚未配置。',card_funds_not_ready:'卡片资金或授权占用尚未核实，请稍后重试。',network_not_enabled:'该网络尚未启用。',quote_destination_changed:'网络或地址已变化，请重新获取报价。',invalid_tron_address:'请输入有效的 TRON 地址。',idempotency_conflict:'请求内容发生变化，请查询原订单后重新操作。',not_found:'无权访问此客户或记录。',mfa_required:'请完成运营 MFA 验证。',user_not_enabled:'业务账户尚未启用。',evidence_required:'该订单需要核验证据，不能直接重试。'} as Record<string,string>)[code]|| (e instanceof SessionError?'操作未完成；请查询状态或重试同一请求。':e instanceof Error?e.message:'操作未完成。');
}

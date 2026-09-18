import {getFirebaseAuth} from '../firebase';
import {isAdminSite} from './site';
import {SessionError} from './liveApi';
import {manualFundsRoute} from './manualFundsContract';
export async function manualRequest<T>(path:string,body?:unknown,key?:string):Promise<T>{
 const method=body===undefined?'GET':'POST';
 if(!manualFundsRoute(method,path)||(isAdminSite?path.startsWith('/client-api/'):path.startsWith('/admin-api/')))throw new SessionError('invalid_path');
 const user=getFirebaseAuth().currentUser;if(!user)throw new SessionError('unauthenticated',401);const token=await user.getIdToken();if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 const res=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key||''})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error'});
 let value;try{value=await res.json()}catch{throw new SessionError('invalid_api_response',res.status)}
 if(!res.ok)throw new SessionError(value?.error?.code||'manual_funds_unavailable',res.status);
 if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 if(value?.data==null||typeof value.data!=='object')throw new SessionError('invalid_api_response');return value.data as T;
}
export function manualError(e:unknown):string{
 const code=e instanceof SessionError?e.code:'';
 return ({balance_read_required:'尚未获得余额查询权限。',manual_funds_disabled:'人工出入金服务尚未启用。',manual_funds_unavailable:'资金服务暂不可用，请重试。',identity_directory_unavailable:'用户身份服务暂不可用，请重试。',not_found:'用户或订单不存在，或无访问权限。',mfa_required:'请完成运营 MFA 验证。',user_not_enabled:'账户尚未开通或已暂停。',self_review_forbidden:'申请人不能审核自己的订单。',order_changed:'订单状态已变化，请刷新。',insufficient_balance:'可用余额不足。',evidence_already_recorded:'该凭证已登记，请查询原单。',recovery_exceeds_original:'回收或冲正金额超过原单剩余金额。',idempotency_conflict:'请求内容与原请求不一致，请核对原单。',payment_evidence_required:'请填写已核实的付款结果凭证。',external_payment_requires_separate_evidence:'涉及外部付款，请通过独立收付款凭证处理。'} as Record<string,string>)[code]||(e instanceof SessionError?'操作未完成，请核对原单或重试。':e instanceof Error?e.message:'操作未完成。');
}

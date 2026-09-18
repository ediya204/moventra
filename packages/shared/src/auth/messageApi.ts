import {getFirebaseAuth} from '../firebase';
import {isAdminSite} from './site';
import {SessionError} from './liveApi';
import {messageRoute} from './messageContract';
export async function messageRequest<T>(path:string,body?:unknown,key?:string):Promise<T>{
 const method=body===undefined?'GET':'POST';
 if(!messageRoute(method,path)||(isAdminSite?path.startsWith('/client-api/'):path.startsWith('/admin-api/')))throw new SessionError('invalid_path');
 const user=getFirebaseAuth().currentUser;if(!user)throw new SessionError('unauthenticated',401);const token=await user.getIdToken();if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 const res=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key||''})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error'});
 let value;try{value=await res.json();}catch{throw new SessionError('invalid_api_response',res.status)}
 if(!res.ok)throw new SessionError(value?.error?.code||'messages_unavailable',res.status);if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 if(value?.data==null||typeof value.data!=='object')throw new SessionError('invalid_api_response');return value.data as T;
}
export function messageError(error:unknown):string {
 const code=error instanceof SessionError?error.code:'';
 return ({messages_disabled:'消息服务尚未开放。',messages_send_disabled:'发送功能尚未启用。',messages_unavailable:'消息服务暂不可用，请稍后重试。',invalid_snapshot:'列表已过期，请刷新后重试。',campaign_changed:'内容或接收人已变化，请刷新并重新预览。',idempotency_conflict:'请求内容已变化，请先查询原记录。',not_found:'记录不存在或无权访问。',mfa_required:'请先完成运营双重验证。',invalid_draft:'请检查标题、正文和接收人。',invalid_recipients:'请选择有效且不重复的接收人。'} as Record<string,string>)[code] || (error instanceof SessionError && error.status===401?'登录已过期，请重新登录。':'操作未完成，请重试或查询原记录。');
}

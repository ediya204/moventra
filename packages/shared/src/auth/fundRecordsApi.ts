import {getFirebaseAuth} from '../firebase';
import {isAdminSite} from './site';
import {SessionError} from './liveApi';
import {fundRecordsRoute,type FundRecordsResult} from './fundRecordsContract';
export async function fundRecordsGet(path:string,signal?:AbortSignal):Promise<FundRecordsResult>{
 if(!fundRecordsRoute('GET',path)||(isAdminSite?path.startsWith('/client-api/'):path.startsWith('/admin-api/')))throw new SessionError('invalid_path');
 const user=getFirebaseAuth().currentUser;if(!user)throw new SessionError('unauthenticated',401);
 const token=await user.getIdToken();if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 const res=await fetch(path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store',credentials:'omit',redirect:'error',signal});
 let body;try{body=await res.json()}catch{throw new SessionError('invalid_api_response',res.status)}
 if(!res.ok)throw new SessionError(body?.error?.code||'fund_records_unavailable',res.status);
 if(getFirebaseAuth().currentUser!==user)throw new SessionError('unauthenticated',401);
 if(!body?.data||!Array.isArray(body.data.records)||!Number.isSafeInteger(body.data.total))throw new SessionError('invalid_api_response');
 return body.data;
}

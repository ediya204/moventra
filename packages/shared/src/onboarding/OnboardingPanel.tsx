import {useEffect,useState,useRef} from 'react';
import {Alert,Box,Button,Paper,Stack,TextField,Typography} from '@mui/material';
import {authMessage,liveGet,updateOnboarding} from '../auth/liveApi';
import {onboardingMessage,type OnboardingState} from '../auth/onboarding';
export default function OnboardingPanel({customerId,admin=false,onState}:{customerId:string;admin?:boolean;onState?:(value:OnboardingState|null)=>void}){
 const [state,setState]=useState<OnboardingState|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const requestVersion=useRef(0),writing=useRef(false);
 const path=`/${admin?'admin':'client'}-api/v1/customers/${customerId}/onboarding`;
 useEffect(()=>{
  let active=true;setState(null);onState?.(null);requestVersion.current++;
  const read=()=>{if(writing.current)return Promise.resolve();const version=++requestVersion.current;return liveGet<OnboardingState>(path).then(data=>{if(active&&version===requestVersion.current){setState(data);onState?.(data);}}).catch(e=>{if(active&&version===requestVersion.current){setState(null);onState?.(null);setError(authMessage(e));}});};
  void read();const timer=setInterval(()=>{if(document.visibilityState==='visible')void read();},15000);
  return()=>{active=false;clearInterval(timer);};
 },[path,revision,onState]);
 const current=state?.customerId===customerId?state:null;
 async function update(action:string){
  if(!current||writing.current)return;writing.current=true;requestVersion.current++;setBusy(true);setError('');onState?.(null);
  try{await updateOnboarding(path,{action,revision:current.revision,reason});setReason('');}
  catch(e){setError(authMessage(e));}
  finally{writing.current=false;setBusy(false);setRevision(n=>n+1);}
 }
 const actions=admin?current?.onboardingStatus==='submitted'?[['approve_activate','审批并开通全部功能'],['reject','驳回']]:current?.onboardingStatus==='approved'?current.serviceStatus==='active'?[['suspend','暂停服务']]:current.serviceStatus==='suspended'?[['resume','恢复全部功能']]:[['activate','开通全部功能']]:[]:current&&['draft','rejected'].includes(current.onboardingStatus)&&current.serviceStatus==='inactive'?[['submit','提交开户申请']]:[];
 return <Paper variant="outlined" sx={{p:3}}><Stack spacing={2}>
  <Typography variant="h6">{admin?'开户审批与服务开通':'开户与功能权限'}</Typography>
  <Typography>{onboardingMessage(current)}</Typography>
  <Typography variant="body2" color="text.secondary">开通后默认获得资金、卡片、交易、消息、工单及设置权限。各项办理仍按实际接口能力、余额及风控校验执行。</Typography>
  {error&&<Alert severity="error">{error}</Alert>}
  {admin&&actions.length>0&&<TextField label="审批 / 状态变更说明" value={reason} onChange={e=>setReason(e.target.value)} inputProps={{maxLength:500}} disabled={busy}/>}
  <Box><Stack direction="row" flexWrap="wrap" gap={1}>
   {actions.map(([action,label])=><Button key={action} variant="contained" disabled={busy||(admin&&!reason.trim())} onClick={()=>void update(action)}>{label}</Button>)}
   <Button disabled={busy} onClick={()=>{setError('');setRevision(n=>n+1);}}>刷新开户状态</Button>
  </Stack></Box>
 </Stack></Paper>;
}

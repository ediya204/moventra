import {useEffect,useState} from 'react';
import {Link,Navigate,useSearchParams} from 'react-router-dom';
import {Alert,Button,MenuItem,Paper,Stack,TextField,Typography} from '@mui/material';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {authMessage,liveGetPage} from '../../../../packages/shared/src/auth/liveApi';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
import type {RegisteredUser} from './RegisteredUsersPage';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default function UserDetailsPage(){
 const {ready,authenticated,user,session}=useAuth();
 const [params]=useSearchParams();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} replace/>;
 // Changing identity or query unmounts old data, including any pending account reads.
 return <Details key={`${user?.uid}:${params.toString()}`}/>;
}
function Field({label,value}:{label:string;value:string}){
 return <Stack spacing={0.5} sx={{minWidth:220,flex:'1 1 220px'}}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography sx={{overflowWrap:'anywhere'}}>{value}</Typography></Stack>;
}
function Details(){
 const [params]=useSearchParams();
 const userId=params.get('userId')||'',email=(params.get('email')||'').trim();
 const valid=(!params.has('email')&&uuid.test(userId))||(!params.has('userId')&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
 const back=new URLSearchParams();
 if(params.get('returnEmail'))back.set('email',params.get('returnEmail')!);
 else if(/^\d{1,4}$/.test(params.get('returnPage')||''))back.set('page',params.get('returnPage')!);
 const backTo=`/user-groups/users${back.size?`?${back}`:''}`;
 const [record,setRecord]=useState<RegisteredUser|null>(null),[busy,setBusy]=useState(valid),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(!valid)return;let active=true;setRecord(null);setBusy(true);setError('');
  const q=new URLSearchParams({limit:'1',offset:'0',...(userId?{userId}:{email})});
  liveGetPage<RegisteredUser>(`/admin-api/v1/users?${q}`).then(r=>{if(active)setRecord(r.data.find(u=>!userId||u.id.toLowerCase()===userId.toLowerCase())||null)}).catch(e=>{if(active)setError(authMessage(e))}).finally(()=>{if(active)setBusy(false)});
  return()=>{active=false};
 },[userId,email,valid,refresh]);
 return <DashboardLayout production><Stack spacing={3}>
  <Button component={Link} to={backTo} sx={{alignSelf:'start'}}>返回注册用户</Button>
  <Stack direction="row" justifyContent="space-between"><Typography variant="h4">用户账户详情</Typography><Button disabled={busy||!valid} onClick={()=>setRefresh(n=>n+1)}>刷新</Button></Stack>
  {!valid?<Alert severity="error">用户链接无效，请返回注册用户列表重新选择。</Alert>:busy?<PageSkeleton/>:error?<Alert severity="error" action={<Button onClick={()=>setRefresh(n=>n+1)}>重试</Button>}>{error}</Alert>:!record?<Alert severity="info">未找到该用户，资料可能已变更。请返回列表重新查询。</Alert>:<>
   <Paper variant="outlined" sx={{p:3}}><Stack spacing={3}>
    <Typography variant="h6">登录与注册资料</Typography>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={3}>
     <Field label="登录邮箱" value={record.email||'身份记录无邮箱'}/><Field label="姓名" value={record.name||'未填写'}/>
     <Field label="邮箱验证" value={record.emailVerified===null?'未知':record.emailVerified?'已验证':'未验证'}/>
     <Field label="登录身份" value={record.authStatus==='enabled'?'正常':record.authStatus==='disabled'?'已停用':'身份不存在'}/>
     <Field label="注册状态" value={record.registrationStatus==='registered'?'已完成注册':'身份已创建 · 待注册'}/>
     <Field label="用户状态" value={record.userStatus==='active'?'启用':record.userStatus==='disabled'?'停用':'尚未注册'}/>
     <Field label="注册时间（UTC）" value={record.registeredAt?new Date(record.registeredAt).toISOString().replace('T',' ').replace('Z',' UTC'):'尚未注册'}/>
     {record.registrationStatus==='registered'&&<Field label="用户 ID" value={record.id}/>}
    </Stack>
   </Stack></Paper>
   <Paper variant="outlined" sx={{p:3}}><Stack spacing={2}>
    <Typography variant="h6">客户与账户</Typography>
    {record.customerLinkState==='unlinked'?<Alert severity="info">尚未关联客户主体。登录和注册资料仍可在上方查看。</Alert>:record.customers.length===0?<Alert severity="info">已关联客户主体，当前管理员没有该客户的业务查看权限。</Alert>:<CustomerAccounts key={`${record.id}:${refresh}`} customers={record.customers}/>}
   </Stack></Paper>
  </>}
 </Stack></DashboardLayout>;
}
type Customer=RegisteredUser['customers'][number];
type Account={id:string;customerId:string;name:string;status:string;parentId:string|null};
function CustomerAccounts({customers}:{customers:Customer[]}){
 const [customerId,setCustomerId]=useState(customers[0].id);
 const customer=customers.find(c=>c.id===customerId)!;
 return <Stack spacing={2}>
  {customers.length>1?<TextField select size="small" label="关联客户" value={customerId} onChange={e=>setCustomerId(e.target.value)}>{customers.map(c=><MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>:<Typography>{customer.name}</Typography>}
  <Field label="客户 ID" value={customer.id}/>
  {customer.canReadAccounts?<Accounts key={customer.id} customerId={customer.id}/>:<Alert severity="info">当前管理员没有该客户的账户读取权限。</Alert>}
  {customer.canReviewOnboarding&&<Button component={Link} to={`/onboarding/${encodeURIComponent(customer.id)}`} sx={{alignSelf:'start'}}>查看开户申请与审批</Button>}
 </Stack>;
}
function Accounts({customerId}:{customerId:string}){
 const [page,setPage]=useState(0),[rows,setRows]=useState<Account[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setRows([]);setBusy(true);setError('');setMore(false);
  liveGetPage<Account>(`/admin-api/v1/customers/${customerId}/accounts?limit=20&offset=${page*20}`).then(r=>{if(active){setRows(r.data);setMore(r.meta.hasMore)}}).catch(e=>{if(active)setError(authMessage(e))}).finally(()=>{if(active)setBusy(false)});
  return()=>{active=false};
 },[customerId,page,retry]);
 return <Stack spacing={2}>
  <Typography variant="subtitle1">账户资料</Typography>
  {busy?<PageSkeleton/>:error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试账户查询</Button>}>{error}</Alert>:!rows.length?<Alert severity="info">{page?'本页没有账户记录。':'该客户暂无账户记录。'}</Alert>:rows.map(a=><Paper key={a.id} variant="outlined" sx={{p:2}}><Stack direction="row" useFlexGap flexWrap="wrap" gap={2}>
   <Field label="账户名称" value={a.name}/><Field label="账户状态" value={a.status==='active'?'启用':a.status==='closed'?'已关闭':a.status}/><Field label="账户 ID" value={a.id}/><Field label="上级账户 ID" value={a.parentId||'无'}/>
  </Stack></Paper>)}
  <Stack direction="row" justifyContent="flex-end" spacing={2}><Button disabled={busy||page===0} onClick={()=>setPage(n=>n-1)}>上一页账户</Button><Typography sx={{alignSelf:'center'}}>第 {page+1} 页</Typography><Button disabled={busy||!!error||!more||page>=500} onClick={()=>setPage(n=>n+1)}>下一页账户</Button></Stack>
 </Stack>;
}

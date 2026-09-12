import {useEffect,useState} from 'react';
import {Link,Navigate,useSearchParams} from 'react-router-dom';
import {Alert,Button,Paper,Stack,TextField,Typography} from '@mui/material';
import {DataGrid,type GridColDef} from '@mui/x-data-grid';
import {zhCN} from '@mui/x-data-grid/locales';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {authMessage,liveGetPage} from '../../../../packages/shared/src/auth/liveApi';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
type RegisteredUser={id:string;name:string;email:string|null;emailVerified:boolean|null;authStatus:'enabled'|'disabled'|'missing';registrationStatus:'registered'|'identity_only';userStatus:'active'|'disabled'|null;registeredAt:string|null;customerLinkState:'linked'|'linked_restricted'|'unlinked';customers:{id:string;name:string;canReadAccounts:boolean;canReviewOnboarding:boolean}[]};
export default function RegisteredUsersPage(){
 const {ready,authenticated,user,session}=useAuth();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} replace/>;
 return <Directory key={user?.uid}/>;
}
function Directory(){
 const [params,setParams]=useSearchParams();
 const email=(params.get('email')||params.get('keyword')||'').trim();
 const rawPage=Number(params.get('page')||0),page=Number.isInteger(rawPage)&&rawPage>=0&&rawPage<=5000&&!email?rawPage:0;
 const [input,setInput]=useState(email),[rows,setRows]=useState<RegisteredUser[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[more,setMore]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>setInput(email),[email]);
 useEffect(()=>{let active=true;setRows([]);setMore(false);setError('');setBusy(true);
  const query=new URLSearchParams({limit:'20',offset:String(page*20)});if(email)query.set('email',email);
  liveGetPage<RegisteredUser>(`/admin-api/v1/users?${query}`).then(r=>{if(active){setRows(r.data);setMore(r.meta.hasMore)}}).catch(e=>{if(active)setError(authMessage(e))}).finally(()=>{if(active)setBusy(false)});
  return()=>{active=false};
 },[email,page,refresh]);
 const columns:GridColDef<RegisteredUser>[]=[
  {field:'email',headerName:'登录邮箱',minWidth:260,flex:1,valueFormatter:(v:string|null)=>v||'身份记录无邮箱'},
  {field:'name',headerName:'姓名',minWidth:160,flex:1},
  {field:'registrationStatus',headerName:'注册状态',width:170,valueFormatter:(v:string)=>v==='registered'?'已完成注册':'身份已创建 · 待注册'},
  {field:'userStatus',headerName:'用户状态',width:120,valueFormatter:(v:string|null)=>v==='active'?'启用':v==='disabled'?'停用':'尚未注册'},
  {field:'authStatus',headerName:'登录身份',width:120,valueFormatter:(v:string)=>v==='enabled'?'正常':v==='disabled'?'已停用':'身份不存在'},
  {field:'emailVerified',headerName:'邮箱验证',width:120,valueFormatter:(v:boolean|null)=>v===null?'未知':v?'已验证':'未验证'},
  {field:'customerLinkState',headerName:'客户关联',minWidth:230,valueFormatter:(v:string)=>v==='linked'?'已关联客户':v==='linked_restricted'?'已关联 · 无业务查看权限':'尚未关联客户'},
  {field:'actions',headerName:'已授权业务',minWidth:240,sortable:false,renderCell:({row})=><Stack direction="row" gap={1}>{row.customers.map(c=><Stack key={c.id} direction="row">{c.canReadAccounts&&<Button component={Link} to={`/customers?customer=${encodeURIComponent(c.id)}`} title={c.name}>账户</Button>}{c.canReviewOnboarding&&<Button component={Link} to={`/onboarding/${encodeURIComponent(c.id)}`} title={c.name}>开户审批</Button>}</Stack>)}</Stack>},
 ];
 return <DashboardLayout production><Stack spacing={2.5}>
  <Stack direction="row" justifyContent="space-between"><Typography variant="h4">注册用户</Typography><Button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>刷新</Button></Stack>
  <Typography color="text.secondary">查看正式注册用户及客户关联状态。输入完整登录邮箱可核对身份，包括已创建登录身份但尚未完成注册的用户。</Typography>
  <Stack component="form" direction="row" spacing={1} onSubmit={e=>{e.preventDefault();const value=input.trim();setParams(value?{email:value}:{});setRefresh(n=>n+1)}}>
   <TextField size="small" label="完整登录邮箱" value={input} onChange={e=>setInput(e.target.value)} placeholder="name@example.com" sx={{maxWidth:420,flex:1}}/>
   <Button type="submit" variant="contained" disabled={busy}>查询</Button><Button disabled={busy} onClick={()=>{setInput('');setParams({})}}>全部用户</Button>
  </Stack>
  {error&&<Alert severity="error" action={<Button onClick={()=>setRefresh(n=>n+1)}>重试</Button>}>{error}</Alert>}
  {!busy&&!error&&!rows.length&&<Alert severity="info">{email?'未找到该登录邮箱对应的客户用户。请核对邮箱拼写。':'暂无已完成注册的客户用户。'}</Alert>}
  <Paper variant="outlined" sx={{p:2}}><DataGrid autoHeight rows={rows} columns={columns} loading={busy} hideFooter disableColumnSorting disableColumnFilter disableRowSelectionOnClick localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}/>
   <Stack direction="row" justifyContent="flex-end" spacing={2} mt={2}><Button disabled={busy||page===0} onClick={()=>setParams({page:String(page-1)})}>上一页</Button><Typography sx={{alignSelf:'center'}}>第 {page+1} 页</Typography><Button disabled={busy||!more} onClick={()=>setParams({page:String(page+1)})}>下一页</Button></Stack>
  </Paper>
  <Typography variant="body2" color="text.secondary">注册成功不代表已开户。查看注册资料不会自动开通账户、分配客户权限或启用资金操作。</Typography>
 </Stack></DashboardLayout>;
}

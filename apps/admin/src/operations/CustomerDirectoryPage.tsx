import {useEffect,useState} from 'react';
import {Link,Navigate,useSearchParams} from 'react-router-dom';
import {Alert,Button,MenuItem,Paper,Stack,TextField,Typography} from '@mui/material';
import {DataGrid,type GridColDef} from '@mui/x-data-grid';
import {zhCN} from '@mui/x-data-grid/locales';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {authMessage,liveGetPage} from '../../../../packages/shared/src/auth/liveApi';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
type Account={id:string;customerId:string;name:string;status:string;parentId:string|null};
export default function CustomerDirectoryPage(){
 const {ready,authenticated,user,session}=useAuth();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} replace/>;
 const scopes=[...new Map(session.staffScopes.filter(s=>s.permission==='accounts:read').map(s=>[s.customerId,s])).values()];
 return <Directory key={user?.uid} scopes={scopes}/>;
}
function Directory({scopes}:{scopes:{customerId:string;name:string}[]}){
 const [params,setParams]=useSearchParams();
 const customer=params.get('customer')||scopes[0]?.customerId||'',page=Math.max(0,Number(params.get('page'))||0);
 const [rows,setRows]=useState<Account[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[more,setMore]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;setRows([]);setMore(false);setError('');setBusy(false);if(!customer)return;if(!scopes.some(s=>s.customerId===customer)){setError('当前客户不在账户读取授权范围内。');return}setBusy(true);
 liveGetPage<Account>(`/admin-api/v1/customers/${customer}/accounts?limit=20&offset=${page*20}`).then(result=>{if(active){setRows(result.data);setMore(result.meta.hasMore)}}).catch(e=>{if(active)setError(authMessage(e))}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[customer,page,refresh,JSON.stringify(scopes)]);
 const update=(values:Record<string,string>)=>setParams({...Object.fromEntries(params),...values});
 const columns:GridColDef<Account>[]=[{field:'name',headerName:'账户名称',minWidth:220,flex:1},{field:'status',headerName:'状态',width:150},{field:'id',headerName:'账户 ID',minWidth:300,flex:1},{field:'parentId',headerName:'上级账户',minWidth:220,valueFormatter:(v:string|null)=>v||'无'}];
 return <DashboardLayout production><Stack spacing={2.5}>
  <Stack direction="row" justifyContent="space-between"><Typography variant="h4">账户目录</Typography><Button onClick={()=>setRefresh(n=>n+1)} disabled={busy}>刷新</Button></Stack>
  <Typography color="text.secondary">正式客户的已授权账户。此目录不包含旧本地客户记录，也不将渠道卡片自动绑定给客户。</Typography>
  {!scopes.length&&<Alert severity="info">当前没有账户读取授权。</Alert>}
  {scopes.length>0&&<TextField select size="small" label="客户" value={customer} onChange={e=>update({customer:e.target.value,page:'0'})}>{scopes.map(s=><MenuItem key={s.customerId} value={s.customerId}>{s.name}</MenuItem>)}</TextField>}
  {error&&<Alert severity="error" action={<Button onClick={()=>setRefresh(n=>n+1)}>重试</Button>}>{error}</Alert>}
  <Paper variant="outlined" sx={{p:2}}><DataGrid autoHeight rows={rows} columns={columns} loading={busy} hideFooter disableColumnSorting disableColumnFilter disableRowSelectionOnClick localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}/><Stack direction="row" justifyContent="flex-end" spacing={2} mt={2}><Button disabled={busy||page===0} onClick={()=>update({page:String(page-1)})}>上一页</Button><Typography sx={{alignSelf:'center'}}>第 {page+1} 页</Typography><Button disabled={busy||!more} onClick={()=>update({page:String(page+1)})}>下一页</Button></Stack></Paper>
  <Button component={Link} to="/onboarding">查看开户审批</Button>
 </Stack></DashboardLayout>;
}

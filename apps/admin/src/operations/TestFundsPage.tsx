import {useEffect,useState} from 'react';
import {Alert,Button,Container,Stack,Typography} from '@mui/material';
import {Link,Navigate,useParams} from 'react-router-dom';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {liveGet,authMessage} from '../../../../packages/shared/src/auth/liveApi';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
import OnlineFunds from '../../../../packages/shared/src/finance/OnlineFunds';
export default function TestFundsPage(){
 const {ready,authenticated,user,session}=useAuth();const {customerId}=useParams();
 const [scopes,setScopes]=useState<{id:string;name:string}[]|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setScopes(null);setError('');if(session?.operator&&session.mfaVerified)liveGet<{id:string;name:string}[]>('/admin-api/v1/test-funds-scopes').then(s=>{if(active)setScopes(s);}).catch(e=>{if(active)setError(authMessage(e));});return()=>{active=false;};},[session,reload]);
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} replace/>;
 return <DashboardLayout production><Container maxWidth="lg"><Stack spacing={3}>
 <Typography variant="h4">测试资金中心</Typography><Button component={Link} to="/finance/test-funds" sx={{alignSelf:'start'}}>客户审核范围</Button>
 {error&&<Alert severity="error" action={<Button onClick={()=>setReload(v=>v+1)}>重试</Button>}>{error}</Alert>}
 {!scopes&&!error&&<PageSkeleton/>}
 {scopes&&(customerId?(scopes.some(s=>s.id===customerId)?<OnlineFunds key={customerId} customerId={customerId} admin/>:<Alert severity="warning">没有该客户的测试资金审核权限。</Alert>):scopes.length?scopes.map(s=><Button key={s.id} component={Link} to={`/finance/test-funds/${s.id}`}>{s.name}</Button>):<Alert severity="info">暂无获授权的测试资金账户。</Alert>)}
 </Stack></Container></DashboardLayout>;
}

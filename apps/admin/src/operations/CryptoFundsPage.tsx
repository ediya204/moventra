import {useEffect,useState} from 'react';
import {Alert,Button,MenuItem,Stack,TextField,Typography} from '@mui/material';
import {Link,Navigate,useLocation,useParams,useSearchParams} from 'react-router-dom';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {cryptoRequest,cryptoError} from '../../../../packages/shared/src/auth/cryptoApi';
import CryptoFunds from '../../../../packages/shared/src/finance/CryptoFunds';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
type Scope={id:string;name:string;permissions:string[]};
export default function CryptoFundsPage(){
 const {ready,authenticated,user,session}=useAuth();const {pathname}=useLocation();const {orderId}=useParams();const [params,setParams]=useSearchParams();
 const [scopes,setScopes]=useState<Scope[]|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setError('');if(session?.operator&&session.mfaVerified)cryptoRequest<Scope[]>('/admin-api/v1/crypto-scopes').then(v=>{if(active)setScopes(v)}).catch(e=>{if(active)setError(cryptoError(e))});return()=>{active=false}},[session,reload]);
 if(!ready)return <PageSkeleton/>;if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} replace/>;
 const customer=params.get('customer')||(!orderId?scopes?.[0]?.id:'')||'',selected=scopes?.find(s=>s.id===customer);
 const kind=pathname.startsWith('/finance/otc')?'otc':pathname.startsWith('/finance/withdrawals')?'withdrawal':'',basePath=kind==='otc'?'/finance/otc':kind==='withdrawal'?'/finance/withdrawals':'/finance/crypto-flows';
 return <DashboardLayout production><Stack spacing={3}><Typography variant="h4">{kind==='otc'?'OTC 兑换管理':kind==='withdrawal'?'数字货币出金审批':'数字货币流水'}</Typography><Stack direction="row"><Button component={Link} to="/system/cregis">渠道观察与同步</Button><Button component={Link} to="/finance/test-funds">原测试资金中心</Button></Stack>
 {error&&<Alert severity="warning" action={<Button onClick={()=>setReload(v=>v+1)}>重试</Button>}>{error}</Alert>}
 {scopes&&scopes.length>0&&!orderId&&<TextField select label="客户授权范围" value={customer} onChange={e=>{const q=new URLSearchParams(params);q.set('customer',e.target.value);q.delete('page');setParams(q)}}>{scopes.map(s=><MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}</TextField>}
 {selected?<CryptoFunds key={`${customer}:${basePath}:${orderId||''}`} customerId={customer} admin basePath={basePath} orderId={orderId} kind={kind} permissions={selected.permissions}/>:scopes&&<Alert severity="info">没有对应客户的隔离资金授权。授权独立于原测试资金和卡片查询权限。</Alert>}
 </Stack></DashboardLayout>;
}

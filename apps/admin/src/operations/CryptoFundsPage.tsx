import FinanceWorkspace from './FinanceWorkspace';
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
 return <DashboardLayout production><FinanceWorkspace><Stack spacing={2.5}>
 <div className="finance-header"><div><span className="finance-kicker">资金与财务</span><Typography variant="h4">{kind==='otc'?'OTC 兑换管理':kind==='withdrawal'?'数字货币出金审批':'数字货币流水'}</Typography><p>{orderId?'核对订单、资金状态与处理记录':kind==='otc'?'按客户查看兑换订单，管理双向成交价':kind==='withdrawal'?'核对出金申请，跟踪审核与执行结果':'按客户查询充值、提现及兑换记录'}</p></div><Button variant="outlined" component={Link} to="/system/cregis">渠道观察与同步 ↗</Button></div>
 {error&&<Alert severity="warning" action={<Button onClick={()=>setReload(v=>v+1)}>重试</Button>}>{error}</Alert>}
 {scopes&&scopes.length>0&&!orderId&&<div className="finance-context"><TextField size="small" select label="客户授权范围" value={customer} onChange={e=>{const q=new URLSearchParams(params);q.set('customer',e.target.value);q.delete('page');setParams(q)}}>{scopes.map(s=><MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}</TextField><Typography variant="caption" color="text.secondary">仅展示所选客户的授权资金数据</Typography></div>}
 {!scopes&&!error&&<PageSkeleton/>}
 {orderId&&selected&&<Typography variant="body2" color="text.secondary">客户 · {selected.name}</Typography>}
 {selected?<CryptoFunds key={`${customer}:${basePath}:${orderId||''}`} customerId={customer} admin basePath={basePath} orderId={orderId} kind={kind} permissions={selected.permissions}/>:scopes&&<Alert severity="info">没有对应客户的资金查询权限。</Alert>}
 </Stack></FinanceWorkspace></DashboardLayout>;
}

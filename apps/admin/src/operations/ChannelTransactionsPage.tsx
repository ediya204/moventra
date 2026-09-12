import {DashboardLayout} from '../components/DashboardLayout';
import {useEffect,useRef,useState} from 'react';
import {Link,Navigate,useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {Alert,Box,Button,MenuItem,Paper,Stack,TextField,Typography} from '@mui/material';
import {DataGrid,type GridColDef} from '@mui/x-data-grid';
import {zhCN} from '@mui/x-data-grid/locales';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {liveGet} from '../../../../packages/shared/src/auth/liveApi';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
import {MerchantCell,LogoAttribution} from '../../../../packages/shared/src/components/MerchantLogo';
import {TransactionStatusChip} from '../components/TransactionStatusChip';
import {minorText,originalText,utcTime,slashTransactionFilters} from '../components/cardTransactionFields';
import {transactionRowClass} from '../components/cardTransactionFields';
import {transactionRowStyles} from '../components/transactionRowStyles';
import TransactionDrawer,{type DrawerTransaction,type DrawerCard} from '../slash/TransactionDrawer';
type Connection={id:string;label:string;revision:string;sourceAt:string};
type Card=DrawerCard&{last4?:string;cardLast4?:string;cardStatus?:string;createdAtUTC?:string;accountId?:string};
type Tx=DrawerTransaction&{postedAt?:string};
type Page<T>={rows:T[];total:number;revision:string;sourceAt:string;importedAt:string;coverageReason:string};
function errorText(e:unknown){const code=(e as {code?:string})?.code;return code==='channel_scope_required'||code==='not_found'?'暂无此渠道的读取权限，或记录不在授权范围内。':code==='projection_updated'?'数据已更新，请刷新后重新查询。':code==='mfa_required'?'请重新登录并完成双重验证。':'数据读取失败，请重试。'}
export default function ChannelTransactionsPage(){
 const {ready,authenticated,user,session}=useAuth();
 if(!ready)return <PageSkeleton/>;
 if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to={user?'/session?security=1':'/admin/login'} replace/>;
 return <ChannelContent key={user?.uid}/>;
}
function ChannelContent(){
 const navigate=useNavigate();const {id}=useParams();const [params,setParams]=useSearchParams();
 const [connections,setConnections]=useState<Connection[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true),[data,setData]=useState<Page<Tx|Card>>(),[refresh,setRefresh]=useState(0);
 const [search,setSearch]=useState(params.get('keyword')||''),[selected,setSelected]=useState<Tx>(),[card,setCard]=useState<DrawerCard>(),[detailBusy,setDetailBusy]=useState(false),[detailError,setDetailError]=useState('');const request=useRef(0);
 const connection=params.get('connection')||connections[0]?.id||'';
 const page=Math.max(0,Number(params.get('page'))||0);
 const filters=JSON.stringify({keyword:params.get('keyword')||'',detailedStatus:params.get('status')||'',from:params.get('from')||'',to:params.get('to')||'',cardId:params.get('cardId')||'',page});
 useEffect(()=>{let active=true;setBusy(true);liveGet<Connection[]>('/admin-api/v1/channel-projections').then(x=>{if(active){setConnections(x);if(!x.length)setBusy(false)}}).catch(e=>{if(active){setError(errorText(e));setBusy(false)}});return()=>{active=false}},[refresh]);
 useEffect(()=>{if(!connection)return;let active=true;setBusy(true);setError('');setData(undefined);const q=new URLSearchParams();if(!id)q.set('revision',connections.find(c=>c.id===connection)?.revision||'');if(!id)Object.entries(JSON.parse(filters)).forEach(([k,v])=>{if(v!==''&&v!==undefined)q.set(k,String(v))});
 liveGet<Page<Tx|Card>>(`/admin-api/v1/channel-projections/${encodeURIComponent(connection)}/${id?'cards/'+encodeURIComponent(id):'transactions?'+q}`).then(x=>{if(active)setData(x)}).catch(e=>{if(active)setError(errorText(e))}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[connection,filters,id,refresh,connections]);
 const update=(values:Record<string,string>)=>{const q=new URLSearchParams(params);q.set('page','0');Object.entries(values).forEach(([k,v])=>v?q.set(k,v):q.delete(k));setParams(q)};
 const show=async(row:Tx)=>{const token=++request.current;setSelected(row);setCard(undefined);setDetailError('');setDetailBusy(true);try{const detail=await liveGet<Page<Tx>>(`/admin-api/v1/channel-projections/${connection}/transactions/${row.id}`);if(token!==request.current)return;setSelected(detail.rows[0]);if(row.cardId){const linked=await liveGet<Page<Card>>(`/admin-api/v1/channel-projections/${connection}/cards/${row.cardId}`);if(token!==request.current)return;const c=linked.rows[0];setCard({...c,maskedCardNumber:c.last4?'•••• '+c.last4:undefined})}}catch(e){if(token===request.current)setDetailError(errorText(e))}finally{if(token===request.current)setDetailBusy(false)}};
 const columns:GridColDef<Tx>[]=[
 {field:'merchant',headerName:'商户 / 交易',minWidth:250,flex:1,renderCell:p=><MerchantCell name={p.row.merchant}/>},
 {field:'cardLast4',headerName:'所属卡片',width:210,renderCell:p=><Button component={Link} to={`/cards/${encodeURIComponent(p.row.cardId||'')}?connection=${encodeURIComponent(connection)}`} sx={{textTransform:'none'}}>{p.row.cardName||'名称未采集'} · {p.row.cardLast4?'•••• '+p.row.cardLast4:'尾号未采集'}</Button>},
 {field:'originalCurrency',headerName:'原币金额',width:150,align:'right',headerAlign:'right',valueFormatter:originalText},
 {field:'amountCents',headerName:'账户金额 · USD',width:155,align:'right',headerAlign:'right',valueFormatter:(v:string)=>minorText(v)},
 {field:'detailedStatus',headerName:'状态',width:125,renderCell:p=><TransactionStatusChip status={p.row.status} detailedStatus={p.row.detailedStatus}/>},
 {field:'authorizedAt',headerName:'授权时间 · UTC',width:180,valueFormatter:utcTime},
 {field:'postedAt',headerName:'入账时间 · UTC',width:180,valueFormatter:utcTime},
 {field:'actions',headerName:'操作',width:95,sortable:false,renderCell:p=><Button onClick={()=>void show(p.row)}>查看详情</Button>}];
 const current=data?.rows[0] as Card|undefined;
 return <DashboardLayout production><Stack gap={2.5}><Stack direction="row" justifyContent="space-between"><Box><Typography variant="h4">{id?'卡片详情':params.get('cardId')?'此卡交易流水':'卡交易流水'}</Typography><Typography color="text.secondary" sx={{mt:1}}>Slash · 真实只读记录</Typography></Box><Button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>刷新已导入数据</Button></Stack>
 <Alert severity="info">{data?.coverageReason||'手动导入上游已采集记录，不代表实时或完整资金池。所属用户须由内部系统绑定。'}{data&&<> 最近采集：{utcTime(data.sourceAt)} UTC · 导入：{utcTime(data.importedAt)} UTC</>}</Alert>
 {!id&&params.get('cardId')&&<Button component={Link} to={`/cards/${encodeURIComponent(params.get('cardId')!)}?connection=${encodeURIComponent(connection)}`}>返回卡片详情</Button>}
 {error&&<Alert severity="error" action={<Button onClick={()=>setRefresh(n=>n+1)}>重试</Button>}>{error}</Alert>}
 {!busy&&!error&&!connections.length&&<Alert severity="info">当前没有可读取的渠道连接，请联系管理员核对渠道授权。</Alert>}
 {connections.length>0&&<TextField select size="small" label="渠道连接" value={connection} onChange={e=>update({connection:e.target.value})} sx={{maxWidth:360}}>{connections.map(c=><MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}</TextField>}
 {id?busy?<PageSkeleton/>:current&&<Paper variant="outlined" sx={{p:3}}><Stack gap={2}><Typography variant="h5">{current.cardName||'卡名未采集'} · {current.last4?'•••• '+current.last4:'尾号未采集'}</Typography><Typography>所属用户：未绑定</Typography><Typography>渠道状态：{current.cardStatus||'未知'}</Typography><Typography>创建时间：{utcTime(current.createdAtUTC)}</Typography><Typography color="text.secondary">该卡当前仅提供渠道资料查询，资金余额及后台管理操作尚未接入。</Typography><Button component={Link} to={`/transactions?${new URLSearchParams({connection,cardId:id})}`}>查看此卡交易</Button><Button component={Link} to={`/cards?${new URLSearchParams({connection,page:params.get('cardsPage')||'0',keyword:params.get('cardsKeyword')||'',status:params.get('cardsStatus')||''})}`}>返回全部卡片</Button></Stack></Paper>:
 <Paper variant="outlined" sx={{p:2}}><Stack direction="row" flexWrap="wrap" gap={2} mb={2}><TextField label="商户、尾号或交易ID" size="small" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&update({keyword:search})}/><TextField select size="small" label="状态" value={params.get('status')||''} onChange={e=>update({status:e.target.value})} sx={{minWidth:160}}><MenuItem value="">全部</MenuItem>{slashTransactionFilters.map(s=><MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}</TextField><TextField size="small" type="date" label="开始日期 · UTC" InputLabelProps={{shrink:true}} value={(params.get('from')||'').slice(0,10)} onChange={e=>update({from:e.target.value?e.target.value+'T00:00:00Z':''})}/><TextField size="small" type="date" label="截止日期 · UTC（不含）" InputLabelProps={{shrink:true}} value={(params.get('to')||'').slice(0,10)} onChange={e=>update({to:e.target.value?e.target.value+'T00:00:00Z':''})}/><Button variant="contained" onClick={()=>update({keyword:search})}>查询</Button></Stack>
 <DataGrid autoHeight rows={id?[]:(data?.rows as Tx[]||[])} columns={columns} loading={busy} disableRowSelectionOnClick disableColumnSorting disableColumnFilter paginationMode="server" rowCount={data?.total||0} paginationModel={{page,pageSize:20}} onPaginationModelChange={m=>{const q=new URLSearchParams(params);q.set('page',String(m.page));setParams(q)}} pageSizeOptions={[20]} localeText={zhCN.components.MuiDataGrid.defaultProps.localeText} getRowClassName={p=>transactionRowClass(p.row.status,p.row.detailedStatus)} sx={{...transactionRowStyles,'& .MuiDataGrid-cell':{fontVariantNumeric:'tabular-nums'}}}/></Paper>}
 <LogoAttribution/>
 </Stack><TransactionDrawer open={Boolean(selected)} transaction={selected} card={card} loading={detailBusy} error={detailError} onClose={()=>{request.current++;setSelected(undefined)}} onRetry={()=>selected&&void show(selected)} onCard={cardId=>{request.current++;setSelected(undefined);navigate(`/cards/${encodeURIComponent(cardId)}?connection=${encodeURIComponent(connection)}`)}}/>
 </DashboardLayout>;
}

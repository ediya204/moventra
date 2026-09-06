import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Alert,Box,Button,Chip,Dialog,DialogContent,DialogTitle,Grid,LinearProgress,MenuItem,Paper,Stack,Tab,Tabs,TextField,Typography} from '@mui/material';
import {DataGrid,type GridColDef} from '@mui/x-data-grid';
import {zhCN} from '@mui/x-data-grid/locales';
import {get,post} from '../management/api';
import {ManagementAccess} from '../management/ManagementPage';
import {PageHeader} from '../components/PageHeader';
type Row={id:string;name?:string;cardName?:string;maskedCardNumber?:string;cardStatus?:string;createdAtUTC?:string;groups?:string[];observedAt:string;fetchError?:string;merchant?:string;amountCents?:string|null;status?:string;detailedStatus?:string;cardId?:string;date?:string;issues?:string[];[key:string]:unknown};
type Status={configured:boolean;state:string;revision:number;lastSuccessAt?:string;lastObservedAt?:string;lastCompletedAt?:string;nextAt?:string;selectedCards:number;intervalSeconds:number;running:boolean;workerRunning:boolean;stale:boolean;processError?:string;coverage?:{cursorExhausted:boolean;pages:number};errors?:{kind?:string;id?:string;message:string}[];account?:{name:string;type:string};balances?:{type:string;availableCents:string;postedCents:string;timestamp:string}[];balanceState?:string;selectionAt?:string};
type Page={rows:Row[];total:number;page:number;pageSize:number;revision:number;summary?:{incomingMinor:string;outgoingMinor:string;netMinor:string;statusReview:number}};
const date=(v?:string)=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'尚未成功同步';
export const liveMoney=(v?:string|null)=>{if(v==null)return '未知';const n=BigInt(v),a=n<0n?-n:n;return `${n<0n?'−':''}${(a/100n).toLocaleString()}.${String(a%100n).padStart(2,'0')}`;};
const groups:Record<string,string>={latestCreated:'本次最新创建 20 张',recentConsumption:'本次近期消费 20 张'};
function useStatus(){const [state,setState]=useState<Status>(),[error,setError]=useState('');const reload=useCallback(()=>get<Status>('live/status').then(d=>{setState(d);setError('');}).catch(e=>setError(e.message)),[]);useEffect(()=>{void reload();const t=setInterval(()=>void reload(),15000);return()=>clearInterval(t);},[reload]);return {state,error,reload};}
export function LiveSyncStatus(){const {state,error,reload}=useStatus();const [busy,setBusy]=useState(false),[syncError,setSyncError]=useState('');return <Paper variant="outlined" sx={{p:2}}><Stack gap={1.5}>
 <Stack direction="row" justifyContent="space-between" gap={2} flexWrap="wrap"><Typography variant="h6">Slash 真实数据同步</Typography><Stack direction="row" gap={1}><Button component={Link} to="/cards?source=slash">查看卡片</Button><Button component={Link} to="/transactions?source=slash">查看交易</Button><Button variant="outlined" disabled={!state?.configured||state.running||busy} onClick={async()=>{setBusy(true);try{setSyncError('');await post('live/sync',{});await reload();}catch(e){setSyncError((e as Error).message);}finally{setBusy(false);}}}>立即同步</Button></Stack></Stack>
 {(error||syncError)&&<Alert severity="error">{error||syncError}</Alert>}
 {state?.configured?<><Stack direction="row" gap={1} flexWrap="wrap"><Chip size="small" color={state.state==='error'||state.errors?.length?'error':state.running?'info':state.stale?'warning':'success'} label={state.running?'同步中':state.state==='error'?'同步失败':state.errors?.length?'部分更新失败':state.stale?'数据待更新':'已更新'}/><Chip size="small" variant="outlined" label={`固定 ${state.selectedCards} 张真实卡 · 每 ${state.intervalSeconds/60} 分钟更新`}/></Stack><Typography variant="body2">{state.account?.name} · 最近成功：{date(state.lastSuccessAt)} · 下次：{state.running?'本轮完成后安排':state.nextAt?date(state.nextAt):'等待后台服务'}</Typography>
 {!state.workerRunning&&<Alert severity="warning">后台同步服务未运行；当前显示上次保存的数据。</Alert>}
 {state.processError&&<Alert severity="error">{state.processError}，保留上次数据。</Alert>}
 {!!state.errors?.length&&<Alert severity="warning">{state.errors.length} 项读取失败，相关旧数据已保留：{state.errors.slice(0,2).map(e=>e.message).join('；')}</Alert>}
 {!!state.balances?.length&&<Typography variant="body2" color="text.secondary">账户余额来源值（币种未核实，单位 amountCents）：{state.balances.map(b=>`${b.type} · available ${b.availableCents??'未知'} / posted ${b.postedCents??'未知'}`).join('；')}。{state.balanceState==='stale_error'?'读取失败，保留旧值。':''}</Typography>}
 <Typography variant="caption" color="text.secondary">固定更新本次选出的两组卡，不自动替换为新的排名。电脑休眠或本地后台停服时暂停，恢复后继续。交易覆盖仍可能不完整。</Typography></>:!error&&<Alert severity="info">尚未配置真实 Slash 导入。</Alert>}
 </Stack></Paper>;}
export default function LiveSlashPage({kind,fallback}:{kind:'cards'|'transactions';fallback:ReactNode}){
 const [params,setParams]=useSearchParams();const real=params.get('source')!=='demo';
 return <Stack gap={2}><Tabs value={real?'slash':'demo'} onChange={(_,v)=>setParams({source:v})}><Tab value="slash" label="Slash 真实数据"/><Tab value="demo" label="现有演示数据"/></Tabs>{real?<ManagementAccess title={kind==='cards'?'全部卡片':'卡交易流水'}><LiveDirectory kind={kind}/></ManagementAccess>:fallback}</Stack>;
}
function LiveDirectory({kind}:{kind:'cards'|'transactions'}){
 const [params,setParams]=useSearchParams(),navigate=useNavigate();const {state,error:statusError}=useStatus();
 const [data,setData]=useState<Page>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[detail,setDetail]=useState<Row>(),[keyword,setKeyword]=useState(params.get('keyword')||'');
 const revisionSeen=useRef<number>();
 const page=Math.max(0,Number(params.get('page'))||0),pageSize=20;
 const query=JSON.stringify({page,pageSize,keyword:params.get('keyword')||'',status:params.get('status')||'',group:kind==='cards'?params.get('group')||'':undefined,cardId:kind==='transactions'?params.get('cardId')||'':undefined});
 useEffect(()=>{if(state?.revision&&revisionSeen.current&&state.revision!==revisionSeen.current&&page>0){revisionSeen.current=state.revision;const p=new URLSearchParams(params);p.set('page','0');setParams(p);return;}revisionSeen.current=state?.revision;let active=true;setLoading(true);get<Page>(`live/${kind}`,{...JSON.parse(query),revision:state?.revision}).then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active){setError(e.message);if(e.message.includes('数据已更新')){const p=new URLSearchParams(params);p.set('page','0');setParams(p);}}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[kind,query,state?.revision]);
 const change=(values:Record<string,string>)=>{const p=new URLSearchParams(params);p.set('source','slash');p.set('page','0');Object.entries(values).forEach(([k,v])=>v?p.set(k,v):p.delete(k));setParams(p);};
 const show=async(id:string)=>{try{const d=await get<{row:Row}>(`live/${kind}/${encodeURIComponent(id)}`);setDetail(d.row);}catch(e){setError((e as Error).message);}};
 const columns:GridColDef<Row>[]=kind==='cards'?[
  {field:'cardName',headerName:'卡片名称',minWidth:180,flex:1},
  {field:'maskedCardNumber',headerName:'卡号',width:125},
  {field:'cardStatus',headerName:'渠道状态',width:120},
  {field:'groups',headerName:'导入组',width:180,renderCell:p=>(p.row.groups||[]).map(g=>groups[g]||g).join('、')},
  {field:'createdAtUTC',headerName:'创建时间',width:185,valueFormatter:(v:string)=>date(v)},
  {field:'observedAt',headerName:'最近读取',width:185,valueFormatter:(v:string)=>date(v)},
  {field:'fetchError',headerName:'更新状态',width:140,renderCell:p=><Chip size="small" label={p.value?'读取失败 · 旧数据':'已保存来源数据'} color={p.value?'warning':'default'}/>},
  {field:'actions',headerName:'操作',width:150,sortable:false,renderCell:p=><Button onClick={e=>{e.stopPropagation();navigate(`/transactions?source=slash&cardId=${encodeURIComponent(p.row.id)}`);}}>查看交易</Button>},
 ]:[
  {field:'merchant',headerName:'商户',minWidth:190,flex:1,valueFormatter:(v:string)=>v||'未提供'},
  {field:'amountCents',headerName:'USD 记账金额',width:160,valueFormatter:(v:string|null)=>liveMoney(v)},
  {field:'status',headerName:'来源状态',width:105},
  {field:'detailedStatus',headerName:'详细状态',width:115},
  {field:'date',headerName:'来源时间',width:185,valueFormatter:(v:string)=>date(v)},
  {field:'cardId',headerName:'卡片 ID 尾段',width:135,valueFormatter:(v:string)=>v?.slice(-8)||'未提供'},
  {field:'observedAt',headerName:'最近读取',width:185,valueFormatter:(v:string)=>date(v)},
 ];
 return <Stack gap={2}>
  <PageHeader title={kind==='cards'?'全部卡片':'卡交易流水'} description="真实 Slash 只读投影，保持来源状态与金额。未建立内部客户归属，不参与 Demo 钱包、额度或资金操作。"/>
  <LiveSyncStatus/>
  {(error||statusError)&&<Alert severity="error">{error||statusError}</Alert>}
  {kind==='transactions'&&<Alert severity="info">显示最近 30 天内已导入的账户交易，来源分页及历史更新覆盖可能不完整。金额按来源 status=posted 汇总，不等于账户余额或已确认结算。{data?.summary?.statusReview?` 当前筛选中 ${data.summary.statusReview} 条状态组合待核实。`:''}</Alert>}
  {kind==='transactions'&&data?.summary&&<Grid container spacing={2}>{[['来源 posted 流入',data.summary.incomingMinor],['来源 posted 流出',data.summary.outgoingMinor],['来源 posted 净流量',data.summary.netMinor]].map(([label,value])=><Grid item xs={12} md={4} key={label}><Paper variant="outlined" sx={{p:2}}><Typography color="text.secondary">{label} · USD</Typography><Typography variant="h5">{liveMoney(value)}</Typography></Paper></Grid>)}</Grid>}
  <Paper variant="outlined" sx={{p:2}}><Stack direction="row" flexWrap="wrap" gap={2} mb={2}>
   <TextField size="small" label="搜索" value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&change({keyword})}/>
   <TextField select size="small" label="来源状态" sx={{minWidth:145}} value={params.get('status')||''} onChange={e=>change({status:e.target.value})}><MenuItem value="">全部</MenuItem>{(kind==='cards'?['active','paused','inactive','closed']:['posted','pending','failed']).map(x=><MenuItem key={x} value={x}>{x}</MenuItem>)}</TextField>
   {kind==='cards'&&<TextField select size="small" label="导入组" sx={{minWidth:200}} value={params.get('group')||''} onChange={e=>change({group:e.target.value})}><MenuItem value="">两组全部</MenuItem>{Object.entries(groups).map(([k,v])=><MenuItem key={k} value={k}>{v}</MenuItem>)}</TextField>}
   <Button variant="contained" onClick={()=>change({keyword})}>查询</Button>{params.get('cardId')&&<Button onClick={()=>change({cardId:''})}>清除单卡筛选</Button>}
  </Stack>{loading&&<LinearProgress/>}<DataGrid autoHeight rows={data?.rows||[]} columns={columns} rowCount={data?.total||0} paginationMode="server" paginationModel={{page,pageSize}} pageSizeOptions={[20]} onPaginationModelChange={p=>{const q=new URLSearchParams(params);q.set('page',String(p.page));setParams(q);}} disableRowSelectionOnClick disableColumnSorting onRowClick={p=>void show(p.row.id)} localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}/></Paper>
  <Dialog open={!!detail} onClose={()=>setDetail(undefined)} fullWidth maxWidth="md"><DialogTitle>{kind==='cards'?'真实卡片详情':'真实交易详情'}</DialogTitle><DialogContent><Alert severity="info">来源字段与本地观察信息；金额为最小单位。真实卡不开放冻结、扣款或转账操作。</Alert>{detail?.fetchError&&<Alert severity="warning">{detail.fetchError}</Alert>}<Box component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12}}>{JSON.stringify(detail,null,2)}</Box></DialogContent></Dialog>
 </Stack>;
}

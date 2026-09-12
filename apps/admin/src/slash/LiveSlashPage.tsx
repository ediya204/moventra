import {MerchantCell,LogoAttribution} from '../../../../packages/shared/src/components/MerchantLogo';
import {slashTransactionFilters,transactionRowClass} from '../components/cardTransactionFields';
import {transactionRowStyles} from '../components/transactionRowStyles';
import {TransactionStatusChip} from '../components/TransactionStatusChip';
import TransactionDrawer,{type DrawerTransaction,type DrawerCard} from './TransactionDrawer';
import {transactionDateRange} from './transactionDateRange';
import {fieldLabels as F,postingLabels,detailLabels,cardLabels,sourceLabel,utcTime,minorText,originalText} from '../components/cardTransactionFields';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Alert,Box,Button,Chip,Grid,LinearProgress,MenuItem,Paper,Stack,Tab,Tabs,TextField,Typography} from '@mui/material';
import {DataGrid,GridToolbarColumnsButton,type GridColDef} from '@mui/x-data-grid';
import {zhCN} from '@mui/x-data-grid/locales';
import {get,post} from '../../../../packages/shared/src/management/api';
import {ManagementAccess} from '../management/ManagementPage';
import {PageHeader} from '../../../../packages/shared/src/components/PageHeader';
type Row=DrawerTransaction & {cardLast4?:string|null;internal?:{platform?:string;customerId?:string|null;customerName?:string|null};id:string;name?:string;cardName?:string;maskedCardNumber?:string;cardStatus?:string;createdAtUTC?:string;groups?:string[];observedAt:string;fetchError?:string;merchant?:string;amountCents?:string|null;status?:string;detailedStatus?:string;cardId?:string;date?:string;authorizedAt?:string;postedAt?:string|null;originalCurrency?:{code?:string|null;amountCents?:string|null}|null;issues?:string[];[key:string]:unknown};
type Status={configured:boolean;state:string;revision:number;lastSuccessAt?:string;lastObservedAt?:string;lastCompletedAt?:string;syncMode?:'manual';webhookConnected?:boolean;nextAt?:string|null;selectedCards:number;intervalSeconds:number|null;running:boolean;workerRunning:boolean;stale:boolean;processError?:string;coverage?:{cursorExhausted:boolean;pages:number};errors?:{kind?:string;id?:string;message:string}[];account?:{name:string;type:string};balances?:{type:string;availableCents:string;postedCents:string;timestamp:string}[];balanceState?:string;selectionAt?:string};
type Page={rows:Row[];total:number;page:number;pageSize:number;revision:number;summary?:{incomingMinor:string;outgoingMinor:string;netMinor:string;statusReview:number}};
const date=utcTime;
export const liveMoney=minorText;
function ColumnsToolbar(){return <Stack direction="row" alignItems="center" gap={2} sx={{p:1}}><GridToolbarColumnsButton/><Typography variant="caption" color="text.secondary">时间统一 UTC · 缺失值显示 — · 点击行查看详情</Typography></Stack>;}
const groups:Record<string,string>={latestCreated:'本次最新创建 20 张',recentConsumption:'本次近期消费 20 张'};
function useStatus(){const [state,setState]=useState<Status>(),[error,setError]=useState('');const reload=useCallback(()=>get<Status>('live/status').then(d=>{setState(d);setError('');}).catch(e=>setError(e.message)),[]);useEffect(()=>{void reload();const t=setInterval(()=>void reload(),15000);return()=>clearInterval(t);},[reload]);return {state,error,reload};}
export function LiveSyncStatus(){const {state,error,reload}=useStatus();const [busy,setBusy]=useState(false),[syncError,setSyncError]=useState('');return <Paper variant="outlined" sx={{p:2}}><Stack gap={1.5}>
 <Stack direction="row" justifyContent="space-between" gap={2} flexWrap="wrap"><Typography variant="h6">Slash 真实数据同步</Typography><Stack direction="row" gap={1}><Button component={Link} to="/cards?source=slash">查看卡片</Button><Button component={Link} to="/transactions?source=slash">查看交易</Button><Button variant="outlined" disabled={!state?.configured||state.running||busy} onClick={async()=>{setBusy(true);try{setSyncError('');await post('live/sync',{});await reload();}catch(e){setSyncError((e as Error).message);}finally{setBusy(false);}}}>{state?.running||busy?'同步中…':'手动同步'}</Button></Stack></Stack>
 {(error||syncError)&&<Alert severity="error">{error||syncError}</Alert>}
 {state?.configured?<><Stack direction="row" gap={1} flexWrap="wrap"><Chip size="small" color={state.state==='error'||state.errors?.length?'error':state.running?'info':state.stale?'warning':'success'} label={state.running?'同步中':state.state==='error'?'同步失败':state.errors?.length?'部分更新失败':state.stale?'数据待更新':'已更新'}/><Chip size="small" variant="outlined" label={`固定 ${state.selectedCards} 张真实卡 · 手动同步`}/></Stack><Typography variant="body2">{state.account?.name} · 最近成功：{date(state.lastSuccessAt)}</Typography>
 <Alert severity="info">当前仅手动同步，显示上次保存的数据。Webhook 同步待后续接入。</Alert>
 {state.processError&&<Alert severity="error">{state.processError}，保留上次数据。</Alert>}
 {!!state.errors?.length&&<Alert severity="warning">{state.errors.length} 项读取失败，相关旧数据已保留：{state.errors.slice(0,2).map(e=>e.message).join('；')}</Alert>}
 {!!state.balances?.length&&<Typography variant="body2" color="text.secondary">账户余额来源值（币种未核实，单位 amountCents）：{state.balances.map(b=>`${b.type} · available ${b.availableCents??'未知'} / posted ${b.postedCents??'未知'}`).join('；')}。{state.balanceState==='stale_error'?'读取失败，保留旧值。':''}</Typography>}
 <Typography variant="caption" color="text.secondary">每次手动同步更新本次选出的两组卡，不自动替换为新的排名。打开页面或重启服务不会触发同步。交易覆盖仍可能不完整。</Typography></>:!error&&<Alert severity="info">尚未配置真实 Slash 导入。</Alert>}
 </Stack></Paper>;}
export default function LiveSlashPage({kind,fallback}:{kind:'cards'|'transactions';fallback:ReactNode}){
 const [params,setParams]=useSearchParams();const real=params.get('source')!=='demo';
 return <Stack gap={2}><Tabs aria-label="数据来源" value={real?'slash':'demo'} onChange={(_,v)=>setParams({source:v})}><Tab value="slash" label="Slash 数据"/><Tab value="demo" label="Demo 数据"/></Tabs>{real?<ManagementAccess title={kind==='cards'?'全部卡片':'卡交易流水'}><LiveDirectory key={kind} kind={kind}/></ManagementAccess>:fallback}</Stack>;
}
function LiveDirectory({kind}:{kind:'cards'|'transactions'}){
 const [params,setParams]=useSearchParams(),navigate=useNavigate();const {state,error:statusError}=useStatus();
 const [data,setData]=useState<Page>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[detail,setDetail]=useState<Row>(),[keyword,setKeyword]=useState(params.get('keyword')||'');
 const [detailId,setDetailId]=useState(''),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState(''),[detailCard,setDetailCard]=useState<DrawerCard>(),[cardWarning,setCardWarning]=useState('');
 const detailRequest=useRef(0);
 const revisionSeen=useRef<number>();
 const rowCountSeen=useRef(0);if(data)rowCountSeen.current=data.total;
 const page=Math.max(0,Number(params.get('page'))||0),pageSize=20;
 const timeRange=transactionDateRange(params),rangeError=kind==='transactions'?timeRange.error:'';
 const query=JSON.stringify({page,pageSize,keyword:params.get('keyword')||'',status:params.get('status')||'',detailedStatus:kind==='transactions'?params.get('detailedStatus')||'':undefined,cardOnly:kind==='transactions'?'true':undefined,group:kind==='cards'?params.get('group')||'':undefined,cardId:kind==='transactions'?params.get('cardId')||'':undefined,from:kind==='transactions'?timeRange.from:undefined,to:kind==='transactions'?timeRange.to:undefined});
 useEffect(()=>{if(rangeError){setData(undefined);setError('');setLoading(false);return;}if(state?.revision&&revisionSeen.current&&state.revision!==revisionSeen.current&&page>0){revisionSeen.current=state.revision;const p=new URLSearchParams(params);p.set('page','0');setParams(p);return;}revisionSeen.current=state?.revision;let active=true;setLoading(true);setData(undefined);get<Page>(`live/${kind}`,{...JSON.parse(query),revision:state?.revision}).then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active){setError(e.message);if(e.message.includes('数据已更新')){const p=new URLSearchParams(params);p.set('page','0');setParams(p);}}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[kind,query,rangeError,state?.revision]);
 const change=(values:Record<string,string>)=>{const p=new URLSearchParams(params);p.set('source','slash');p.set('page','0');Object.entries(values).forEach(([k,v])=>v?p.set(k,v):p.delete(k));setParams(p);};
 const show=useCallback(async(id:string)=>{
  if(kind==='cards'){navigate(`/cards/${encodeURIComponent(id)}?source=slash`);return;}
  const request=++detailRequest.current;setDetailId(id);setDetail(undefined);setDetailCard(undefined);setCardWarning('');setDetailError('');setDetailLoading(true);
  try {
   const d=await get<{row:Row}>(`live/${kind}/${encodeURIComponent(id)}`);
   if(request!==detailRequest.current)return;
   setDetail(d.row);setDetailLoading(false);
   if(kind==='transactions'&&d.row.cardId){
    try{const c=await get<{row:DrawerCard}>(`live/cards/${encodeURIComponent(d.row.cardId)}`);if(request===detailRequest.current)setDetailCard(c.row);}
    catch{if(request===detailRequest.current)setCardWarning('关联卡片详情暂不可用，请重试或手动同步卡片资料。');}
   }
  }catch(e){if(request===detailRequest.current){setDetailError((e as Error).message);setDetailLoading(false);}}
 },[kind,navigate]);
 const closeDetail=()=>{detailRequest.current++;setDetailId('');setDetail(undefined);if(params.has('detail')){const p=new URLSearchParams(params);p.delete('detail');setParams(p,{replace:true});}};
 const linkedDetail=params.get('detail');
 useEffect(()=>{if(kind==='cards'&&linkedDetail)void show(linkedDetail);return()=>{detailRequest.current++;};},[kind,linkedDetail,show]);

 const columns:GridColDef<Row>[]=kind==='cards'?[
  {field:'cardName',headerName:F.cardName,minWidth:180,flex:1,valueFormatter:(v:string)=>v||'—'},
  {field:'maskedCardNumber',headerName:F.last4,width:130,valueFormatter:(v:string)=>v ? `•••• ${v.slice(-4)}` : '—'},
  {field:'cardStatus',headerName:'状态',description:'采用渠道返回的卡片状态',width:185,valueFormatter:v=>sourceLabel(v,cardLabels)},
  {field:'availableBalance',headerName:'可用余额',description:'尚未关联内部卡资金分户，当前无法查询逐卡可用余额；消费限额及共享账户余额不作为逐卡余额',width:150,align:'right',headerAlign:'right',sortable:false,valueGetter:()=>'未接入',renderCell:()=> <Typography component="span" variant="body2" color="text.secondary" title="尚未关联内部卡资金分户，当前无法查询逐卡可用余额">未接入</Typography>},
  {field:'groups',headerName:'导入分组',width:180,renderCell:p=>(p.row.groups||[]).map(g=>groups[g]||g).join('、')||'—'},
  {field:'createdAtUTC',headerName:F.createdAt,width:195,valueFormatter:(v:string)=>date(v)},
  {field:'observedAt',headerName:F.observedAt,width:195,valueFormatter:(v:string)=>date(v)},
  {field:'customer',headerName:'所属用户',description:'内部所属用户；未建立绑定时显示未绑定，不使用卡名或持卡人姓名代替',minWidth:160,flex:1,valueGetter:(_,row)=>row.internal?.customerName||row.internal?.customerId||'未绑定'},
  {field:'channel',headerName:'渠道',width:110,description:'发卡渠道；当前只读接口来自 Slash',valueGetter:(_,row)=>{const provider=row.internal?.platform||'slash';return ({slash:'Slash',wasabi:'Wasabi'} as Record<string,string>)[provider.toLowerCase()]||provider;}},
  {field:'fetchError',headerName:F.sync,width:165,renderCell:p=><Chip size="small" label={p.value?'读取失败 · 保留旧值':'已采集'} color={p.value?'warning':'default'}/>},
  {field:'id',headerName:'平台卡片 ID',width:270},
  {field:'actions',headerName:F.action,width:170,sortable:false,hideable:false,renderCell:p=><><Button onClick={e=>{e.stopPropagation();void show(p.row.id);}}>详情</Button><Button onClick={e=>{e.stopPropagation();navigate(`/transactions?source=slash&cardId=${encodeURIComponent(p.row.id)}`);}}>交易</Button></>},
 ]:[
  {field:'merchant',headerName:F.merchant,minWidth:240,flex:1,valueFormatter:(v:string)=>v||'—',renderCell:p=><MerchantCell name={p.row.merchant}/>},
  {field:'cardId',headerName:F.cardId,width:150,description:'关联卡片的卡号后四位；未采集时显示 —',valueGetter:(_,row)=>typeof row.cardLast4==='string'&&/^[0-9]{4}$/.test(row.cardLast4)?`•••• ${row.cardLast4}`:'—'},
  {field:'customer',headerName:'所属用户',minWidth:160,description:'读取卡片在内部数据库绑定的用户',valueGetter:(_,row)=>row.internal?.customerName||row.internal?.customerId||'未绑定'},
  {field:'originalCurrency',headerName:F.original,width:190,align:'right',headerAlign:'right',valueFormatter:originalText},
  {field:'amountCents',headerName:F.amount,width:175,align:'right',headerAlign:'right',description:'Slash 当前账户金额（USD）；待入账时不是最终清算金额',valueFormatter:(v:string|null)=>v==null?'—':`USD ${liveMoney(v)}`},
  {field:'status',headerName:'状态',width:150,renderCell:p=><TransactionStatusChip status={p.row.status} detailedStatus={p.row.detailedStatus}/>},
  {field:'authorizedAt',headerName:F.authorizedAt,width:195,valueFormatter:(v:string)=>date(v)},
  {field:'postedAt',headerName:F.postedAt,width:195,description:'仅 status=posted 时依据来源 date 展示',valueGetter:(_,row)=>row.status==='posted'?row.date:null,valueFormatter:(v:string)=>date(v)},
  {field:'date',headerName:F.sourceDate,width:195,description:'已入账时为入账日期；pending/failed 时为创建日期',valueFormatter:(v:string)=>date(v)},
  {field:'observedAt',headerName:F.observedAt,width:195,valueFormatter:(v:string)=>date(v)},
  {field:'id',headerName:'平台交易 ID',width:270},
  {field:'actions',headerName:F.action,width:105,sortable:false,hideable:false,renderCell:p=><Button onClick={e=>{e.stopPropagation();void show(p.row.id);}}>查看详情</Button>},
 ];
 return <Stack gap={2}>
  <PageHeader title={kind==='cards'?'全部卡片':'卡交易流水'} description="真实 Slash 只读投影，保持来源状态与金额。所属用户来自内部数据库绑定；不参与 Demo 钱包、额度或资金操作。"/>
  <LiveSyncStatus/>
  {(error||statusError)&&<Alert severity="error">{error||statusError}</Alert>}
  {kind==='transactions'&&<Alert severity="info">查询范围：{timeRange.label}。按渠道记录时间筛选。仅显示已导入且关联卡片的交易；历史覆盖可能不完整，当前日截至读取时刻。金额按来源 status=posted 汇总，不等于账户余额或已确认结算。{data?.summary?.statusReview?` 当前筛选中 ${data.summary.statusReview} 条状态组合待核实。`:''}</Alert>}
  {kind==='transactions'&&data?.summary&&<Grid container spacing={2}>{[['来源 posted 流入',data.summary.incomingMinor],['来源 posted 流出',data.summary.outgoingMinor],['来源 posted 净流量',data.summary.netMinor]].map(([label,value])=><Grid item xs={12} md={4} key={label}><Paper variant="outlined" sx={{p:2}}><Typography color="text.secondary">{label} · USD</Typography><Typography variant="h5">{liveMoney(value)}</Typography></Paper></Grid>)}</Grid>}
  <Paper variant="outlined" sx={{p:2}}><Stack direction="row" flexWrap="wrap" gap={2} mb={2}>
   <TextField size="small" label="搜索" value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&change({keyword})}/>
   {kind==='cards'?<TextField select size="small" label="状态" sx={{minWidth:145}} value={params.get('status')||''} onChange={e=>change({status:e.target.value})}><MenuItem value="">全部</MenuItem>{['active','paused','inactive','closed'].map(x=><MenuItem key={x} value={x}>{sourceLabel(x,cardLabels)}</MenuItem>)}</TextField>:<>
    <TextField select size="small" label="状态" sx={{minWidth:230}} value={params.get('detailedStatus')||''} onChange={e=>change({detailedStatus:e.target.value,status:''})} SelectProps={{MenuProps:{PaperProps:{sx:{maxHeight:480}}}}}>
     <MenuItem value="">全部状态</MenuItem>
     {slashTransactionFilters.map(x=><MenuItem key={x.value} value={x.value}><Stack direction="row" alignItems="center" gap={1}><Chip size="small" variant="outlined" label={x.label} color={x.color}/><Typography variant="body2" color="text.secondary">{x.value}</Typography></Stack></MenuItem>)}
     {params.get('detailedStatus')&&!slashTransactionFilters.some(x=>x.value===params.get('detailedStatus'))&&<MenuItem value={params.get('detailedStatus')!}>{sourceLabel(params.get('detailedStatus'),detailLabels)}</MenuItem>}
    </TextField>
    <TextField select size="small" label="时间范围（UTC）" sx={{minWidth:180}} value={timeRange.mode} onChange={e=>change(e.target.value==='custom'?{range:'custom',fromDate:timeRange.fromDate,toDate:timeRange.toDate}:{range:e.target.value,fromDate:'',toDate:''})}>
     {[7,14,30].map(n=><MenuItem key={n} value={String(n)}>最近 {n} 天</MenuItem>)}<MenuItem value="custom">自定义日期</MenuItem>
    </TextField>
    {timeRange.mode==='custom'&&<Stack direction={{xs:'column',sm:'row'}} gap={2} sx={{width:{xs:'100%',sm:'auto'}}}><TextField type="date" size="small" label="开始日期（UTC）" sx={{minWidth:190,flex:1}} value={timeRange.fromDate} onChange={e=>change({fromDate:e.target.value})} InputLabelProps={{shrink:true}} inputProps={{max:new Date().toISOString().slice(0,10)}} error={!!rangeError}/><TextField type="date" size="small" label="结束日期（UTC，含当日）" sx={{minWidth:230,flex:1}} value={timeRange.toDate} onChange={e=>change({toDate:e.target.value})} InputLabelProps={{shrink:true}} inputProps={{max:new Date().toISOString().slice(0,10)}} error={!!rangeError}/></Stack>}
    {params.get('status')&&<Chip sx={{alignSelf:'center'}} label={`入账状态：${sourceLabel(params.get('status'),postingLabels)}`} onDelete={()=>change({status:''})}/>}
   </>}
   {kind==='cards'&&<TextField select size="small" label="导入分组" sx={{minWidth:200}} value={params.get('group')||''} onChange={e=>change({group:e.target.value})}><MenuItem value="">两组全部</MenuItem>{Object.entries(groups).map(([k,v])=><MenuItem key={k} value={k}>{v}</MenuItem>)}</TextField>}
   <Button variant="contained" disabled={!!rangeError} onClick={()=>change({keyword})}>查询</Button>{params.get('cardId')&&<Button onClick={()=>change({cardId:''})}>清除单卡筛选</Button>}
  </Stack>{rangeError&&<Alert severity="error" sx={{mb:2}}>{rangeError}</Alert>}{loading&&<LinearProgress/>}<DataGrid getRowClassName={p=>kind==='transactions'?transactionRowClass(p.row.status,p.row.detailedStatus):''} key={kind} slots={{toolbar:ColumnsToolbar}} initialState={{columns:{columnVisibilityModel:{customer:kind==='cards',id:false,groups:false,observedAt:false,date:false,fetchError:false}}}} sx={{...transactionRowStyles,"& .MuiDataGrid-cell":{fontVariantNumeric:"tabular-nums"},"& .MuiDataGrid-row":{cursor:"pointer"}}} autoHeight rows={data?.rows||[]} columns={columns} rowCount={data?.total??(loading?rowCountSeen.current:0)} loading={loading} paginationMode="server" paginationModel={{page,pageSize}} pageSizeOptions={[20]} onPaginationModelChange={p=>{const q=new URLSearchParams(params);q.set('page',String(p.page));setParams(q);}} disableRowSelectionOnClick disableColumnSorting onRowClick={p=>void show(p.row.id)} localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}/></Paper>
  {kind==='transactions'&&<LogoAttribution/>}
  {kind==='transactions'?<TransactionDrawer key={detailId} open={!!detailId} transaction={detail} card={detailCard} cardWarning={cardWarning} loading={detailLoading} error={detailError} onClose={closeDetail} onRetry={()=>void show(detailId)} onCard={id=>{closeDetail();navigate(`/cards/${encodeURIComponent(id)}?source=slash`);}}/>:null}

 </Stack>;
}

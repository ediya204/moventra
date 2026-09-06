import {ignoresRowAction} from "../../../../packages/shared/src/portal/rowInteraction";
import {useEffect,useState} from 'react';
import {Icon} from '@iconify/react';
import {Link,useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {Alert,Box,Button,Chip,CircularProgress,Dialog,DialogActions,DialogContent,DialogTitle,Divider,IconButton,MenuItem,Paper,Stack,TextField,Typography} from '@mui/material';
import {DataGrid,GridToolbarColumnsButton,GridToolbarContainer,type GridColDef} from '@mui/x-data-grid';
import {zhCN} from '@mui/x-data-grid/locales';
import {asset,type Entry,type State,type FinanceAction} from './model';
import {readPortal,type TransactionPage} from './unifiedApi';
import {safeClientReturn} from '../../../../packages/shared/src/slash/portalRouting';
import {detailLabels,money} from '../../../../packages/shared/src/slash/api';
function Columns(){return <GridToolbarContainer><GridToolbarColumnsButton/><Typography variant="caption">后端筛选、排序与分页 · 金额保留收支符号</Typography></GridToolbarContainer>;}
export function UnifiedTransactions({state,cardId,group,compact=false}:{state:State;cardId?:string;group?:string;compact?:boolean}){
 const [params,setParams]=useSearchParams();
 const [selectedId,setSelectedId]=useState('');
 const [refresh,setRefresh]=useState(0);
 const [data,setData]=useState<TransactionPage>();const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const [keyword,setKeyword]=useState(params.get('txQuery')||params.get('keyword')||'');
 const query={keyword:params.get('txQuery')||params.get('keyword')||'',status:params.get('txStatus')||'',detailedStatus:params.get('txDetail')||'',currency:params.get('txCurrency')||'',platform:params.get('txPlatform')||'',kind:params.get('txKind')||'',from:params.get('txFrom')||'',to:params.get('txTo')||'',scenario:params.get('scenario')||'',accountId:params.get('accountId')||'',cardId:cardId||params.get('cardId')||'',group,page:compact?0:Math.max(0,Number(params.get('txPage'))||0),pageSize:compact?5:Number(params.get('txSize'))||10,sort:params.get('txSort')||'time',direction:params.get('txDirection')||'desc'};
 const key=JSON.stringify(query);
 useEffect(()=>{let active=true;setLoading(true);setError('');readPortal<TransactionPage>('transactions',JSON.parse(key)).then(d=>{if(active)setData(d);}).catch(e=>{if(active){setError(e.message);setData(undefined);}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[key,state.revision,refresh]);
 const change=(values:Record<string,string>)=>{const p=new URLSearchParams(params);p.delete('txPage');Object.entries(values).forEach(([k,v])=>v?p.set(k,v):p.delete(k));setParams(p);};
 const select=(label:string,name:string,options:Record<string,string>)=><TextField size="small" select label={label} value={params.get(name)||''} onChange={e=>change({[name]:e.target.value})} sx={{minWidth:135}}><MenuItem value="">全部</MenuItem>{Object.entries(options).map(([v,l])=><MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>;
 const columns:GridColDef<Entry>[]=[
  {field:'name',headerName:'商户 / 订单',minWidth:210,flex:1,sortable:false},
  {field:'card',headerName:'所属卡片',width:165,sortable:false,renderCell:p=>{const card=p.row.cardSummary;return card?<Button component={Link} size="small" to={`/portal/cards/${encodeURIComponent(card.id)}`} title={card.name}>•••• {card.last4||card.id.slice(-4)}</Button>:'—';}},
  {field:'kind',headerName:'业务类型',width:110,sortable:false},
  {field:'amount',headerName:'金额',width:160,renderCell:p=>p.row.nonFinancial?'不涉及资金':asset(p.row.amount,p.row.currency)},
  {field:'statusText',headerName:'状态',width:235,sortable:false,renderCell:p=><Chip size="small" variant="outlined" label={p.row.statusText||p.row.status} color={p.row.status==='失败'?'error':p.row.status==='处理中'?'warning':'default'}/>},
  {field:'time',headerName:'来源日期 / 订单时间',width:210},
  {field:'id',headerName:'交易记录 ID',width:290,sortable:false},
  {field:'rawStatus',headerName:'Slash status',width:130,sortable:false,valueGetter:(_,r)=>r.slash?.source.status||'—'},
  {field:'detailedStatus',headerName:'Slash detailedStatus',width:170,sortable:false,valueGetter:(_,r)=>r.slash?.source.detailedStatus||'—'},
  {field:'merchantOrderId',headerName:'商户订单号',width:240,sortable:false,valueGetter:(_,r)=>r.slash?.source.orderId||'—'},
  {field:'orderId',headerName:'内部资金订单号',width:280,sortable:false,valueGetter:v=>v||'—'},
  {field:'authorizedAt',headerName:'授权时间 UTC',width:210,sortable:false,valueGetter:(_,r)=>r.slash?.source.authorizedAt||'—'},
  {field:'originalCurrency',headerName:'原币金额',width:170,sortable:false,valueGetter:(_,r)=>r.slash?.source.originalCurrency?`${r.slash.source.originalCurrency.amountCents} ${r.slash.source.originalCurrency.code} 最小单位`:'—'},
  {field:'detail',headerName:'操作',width:100,sortable:false,renderCell:p=><Button onClick={()=>setSelectedId(p.row.id)} size="small">查看详情</Button>},
 ];
 return <Stack gap={2}>
  {!compact&&<><Stack component="form" direction={{xs:'column',sm:'row'}} gap={1} onSubmit={e=>{e.preventDefault();change({txQuery:keyword});}}><TextField size="small" fullWidth label="搜索商户、卡片 ID、订单号或场景编号" value={keyword} onChange={e=>setKeyword(e.target.value)}/><Button type="submit" variant="contained">查询</Button><Button onClick={()=>{const p=new URLSearchParams(params);for(const k of [...p.keys()])if(k.startsWith('tx')||['keyword','scenario','cardId','accountId'].includes(k))p.delete(k);setKeyword('');setParams(p);}}>重置</Button></Stack>
   <Stack direction="row" gap={1} flexWrap="wrap">{select('交易状态','txStatus',{'已完成':'已入账 / 已完成','处理中':'处理中','失败':'未入账 / 失败','未知状态':'未知状态'})}{select('Slash 详细状态','txDetail',detailLabels)}{select('业务类型','txKind',Object.fromEntries(['消费','退款','授权','授权拒绝','授权撤销','授权取消','费用','充值','提现','卡片充值','兑换','卡片转回','内部划拨'].map(v=>[v,v])))}{select('币种','txCurrency',{USD:'USD',USDT:'USDT'})}{select('来源','txPlatform',{Slash:'Slash',Moventra:'Moventra 内部'})}{['From','To'].map((k,n)=><TextField key={k} size="small" type="date" label={n?'结束日期':'开始日期'} InputLabelProps={{shrink:true}} value={params.get('tx'+k)||''} onChange={e=>change({['tx'+k]:e.target.value})}/>)}<Button component="a" href={`/local-slash-demo/portal/transactions.csv?${new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])))}`}>导出查询结果</Button></Stack>
   <Typography variant="caption" color="text.secondary">授权处理中、拒绝和撤销不计入已入账消费；Slash date 随来源状态解释。点击详情查看交易摘要，或前往所属卡片。</Typography></>}
  {error&&<Alert severity="error">{error}</Alert>}
  <Paper variant="outlined"><DataGrid sx={{'& .MuiDataGrid-row':{cursor:'pointer'}}} onRowClick={(row,event)=>{if(!ignoresRowAction(event))setSelectedId(row.id as string);}} onCellKeyDown={(cell,event)=>{if(event.key==='Enter'&&!event.repeat&&!ignoresRowAction(event)){event.preventDefault();setSelectedId(cell.id as string);}}} autoHeight rows={data?.rows||[]} columns={columns} loading={loading} localeText={zhCN.components.MuiDataGrid.defaultProps.localeText} disableRowSelectionOnClick disableColumnFilter paginationMode="server" sortingMode="server" rowCount={data?.total||0} paginationModel={{page:query.page,pageSize:query.pageSize}} onPaginationModelChange={m=>change({txPage:String(m.page),txSize:String(m.pageSize)})} sortModel={[{field:query.sort,sort:query.direction==='asc'?'asc':'desc'}]} onSortModelChange={m=>change({txSort:m[0]?.field||'time',txDirection:m[0]?.sort||'desc'})} pageSizeOptions={compact?[5]:[10,25,50]} initialState={{columns:{columnVisibilityModel:{id:false,rawStatus:false,detailedStatus:false,merchantOrderId:false,orderId:false,authorizedAt:false,originalCurrency:false}}}} slots={compact?{}:{toolbar:Columns}} hideFooter={compact}/></Paper>
  {selectedId&&<TransactionDialog id={selectedId} state={state} cardId={cardId} onClose={()=>{setSelectedId('');setRefresh(value=>value+1);}}/>}
 </Stack>;
}
function TransactionDialog({id,state,cardId,onClose}:{id:string;state:State;cardId?:string;onClose:()=>void}){
 const [entry,setEntry]=useState<Entry>();const [error,setError]=useState('');
 useEffect(()=>{let active=true;setEntry(undefined);setError('');readPortal<Entry>(`transactions/${encodeURIComponent(id)}`).then(d=>{if(active)setEntry(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,state.revision]);
 const current=entry?.id===id?entry:undefined;
 const mismatch=Boolean(current&&cardId&&current.card!==cardId);
 const card=current?.cardSummary;
 const order=current?.financeSummary;
 const source=current?.slash?.source;
 const field=(label:string,value:React.ReactNode)=><Box sx={{minWidth:0}}><Typography component="dt" variant="caption" color="text.secondary">{label}</Typography><Typography component="dd" variant="body2" sx={{m:0,mt:0.5,overflowWrap:'anywhere'}}>{value==null||value===''?'—':value}</Typography></Box>;
 return <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="client-transaction-title">
  <DialogTitle id="client-transaction-title" sx={{pr:7}}>交易详情<IconButton aria-label="关闭交易详情" onClick={onClose} sx={{position:'absolute',right:12,top:12}}><Icon icon="solar:close-circle-linear" width={24}/></IconButton></DialogTitle>
  <DialogContent dividers>
   {error?<Alert severity="error">{error}</Alert>:mismatch?<Alert severity="warning">该交易不属于当前卡片。</Alert>:!current?<Stack direction="row" alignItems="center" gap={1} py={3}><CircularProgress size={20}/><Typography>正在加载交易详情…</Typography></Stack>:<Stack gap={2.5}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap"><Box><Typography variant="body2" color="text.secondary">{current.kind}</Typography><Typography variant="h4" sx={{mt:0.5}}>{current.nonFinancial?'不涉及资金':asset(current.amount,current.currency)}</Typography></Box><Chip size="small" variant="outlined" label={current.statusText||current.status} color={current.status==='失败'?'error':current.status==='处理中'||current.status==='未知状态'?'warning':'default'}/></Stack>
    <Divider/>
    <Box component="dl" sx={{m:0,display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:2.5}}>
     {field('商户 / 名称',current.name)}
     {field('所属卡片',card?`${card.name} · •••• ${card.last4||card.id.slice(-4)}`:current.card||'未关联卡片')}
     {field(source?(current.slash?.dateMeaning||'交易时间'):'订单时间',current.time)}
     {source?.authorizedAt&&field('授权时间',source.authorizedAt)}
     {field('交易编号',current.id)}
     {source?.orderId&&field('商户订单号',source.orderId)}
     {source?.originalCurrency&&field('原币金额',money(source.originalCurrency.amountCents,source.originalCurrency.code))}
     {source?.fxFeeInfo?.amountCents!=null&&field('外汇手续费',money(source.fxFeeInfo.amountCents))}
     {order&&field('手续费',asset(order.fee,order.currency))}
     {order&&field(order.status==='已完成'?'到账金额':['已取消','已拒绝','失败'].includes(order.status)?'申请到账金额（未到账）':'预计到账金额',asset(order.receive,order.toCurrency||order.currency))}
     {source?.declineReason&&field('拒绝原因',source.declineReason)}
    </Box>
    {current.status==='处理中'&&<Typography variant="body2" color="text.secondary">交易仍在处理中，最终结果以完成状态为准。</Typography>}
    {['unmatched','pending_confirmation'].includes(current.slash?.internal.matchingStatus||'')&&<Alert severity="info">这笔交易的关联信息仍待确认。</Alert>}
   </Stack>}
  </DialogContent>
  <DialogActions sx={{px:3,py:2}}><Button onClick={onClose}>关闭</Button>{card&&!mismatch&&!error&&<Button variant="contained" component={Link} to={`/portal/cards/${encodeURIComponent(card.id)}`} onClick={onClose} startIcon={<Icon icon="solar:card-linear" width={20}/>}>查看卡片</Button>}</DialogActions>
 </Dialog>;
}
// Keep existing bookmarked detail URLs usable with the same concise client dialog.
export function UnifiedTransactionDetail({id,state,cardId}:{id:string;state:State;onFinance:(a:FinanceAction)=>string|Promise<string>;cardId?:string}){
 const location=useLocation();const navigate=useNavigate();const params=new URLSearchParams(location.search);
 const fallback=cardId?`/portal/cards/${encodeURIComponent(cardId)}?tab=transactions`:'/portal/transactions';
 const back=safeClientReturn(params.get('returnTo'),fallback);
 return <TransactionDialog id={id} state={state} cardId={cardId} onClose={()=>navigate(back,{replace:true})}/>;
}

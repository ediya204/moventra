import TransactionFilters from './TransactionFilters';
import {transactionFilterError,transactionQuery,collectTransactions,transactionsCsv} from './transactionQuery';
import {transactionChipSx,transactionTableSx,transactionTableRowSx} from '../../../../packages/shared/src/components/transactionVisuals';
import CardDetailWorkspace from './CardDetailWorkspace';
import ChannelCardStatus from '../../../../packages/shared/src/components/ChannelCardStatus';
import CardControls from '../../../../packages/shared/src/components/CardControls';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Chip, Drawer, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { authMessage, liveGet, liveCardSync } from '../../../../packages/shared/src/auth/liveApi';
import { MerchantCell, MerchantLogo, LogoAttribution } from '../../../../packages/shared/src/components/MerchantLogo';
import { snapshotAmount, cardMetricDisplay, type CardSyncInfo } from '../../../../packages/shared/src/auth/cardSnapshotContract';

type Connection={id:string;label:string;revision:string;sourceAt:string;importedAt:string};
type Row=CardSyncInfo & {id:string;name?:string;cardName?:string;last4?:string;cardLast4?:string;cardStatus?:string;cardId?:string;merchant?:string;status?:string;detailedStatus?:string;amountCents?:string;originalCurrency?:{code?:string;amountCents?:string};date?:string;authorizedAt?:string;createdAtUTC?:string;fundingCardId?:string|null;cvvAvailable?:boolean;detailsAvailable?:boolean;network?:string;expiryMonth?:string;expiryYear?:string};
type Result={rows:Row[];total:number;page:number;revision:string;sourceAt:string;importedAt:string;coverageReason:string};
const detailLabels:Record<string,string>={pending:'待处理',pending_approval:'待批准',in_review:'审核中',canceled:'已取消',failed:'失败',settled:'已结算',declined:'已拒绝',refund:'退款',reversed:'已撤销',returned:'退回',dispute:'争议'};
const cardStatusLabels:Record<string,string>={active:'正常',paused:'已暂停',inactive:'未启用',closed:'已注销'};
const cardName=(row:Row)=>row.cardName||row.name||'未命名卡片';
function CardMetric({row,kind}:{row:CardSyncInfo;kind:'available'|'spending'}) {
 const metric=cardMetricDisplay(row.metrics,kind);
 return <Typography component="span" variant="body2" title={metric.help}>{metric.value}</Typography>;
}
const time=(value?:string)=>value?value.replace('T',' ').replace('Z',' UTC'):'未知';
const cardCreatedDate=(value?:string)=>{const date=value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T| |$)/);return date?`${date[1]}/${date[2]}/${date[3]}`:'未知';};
export default function CardSnapshots({customerId}:{customerId:string}) {
 const navigate=useNavigate(); const {pathname}=useLocation(); const [params,setParams]=useSearchParams();
 const [reload,setReload]=useState(0),[failure,setFailure]=useState('');
 const [connections,setConnections]=useState<Connection[]|null>(null);
 const [result,setResult]=useState<Result|null>(null),[cardTransactions,setCardTransactions]=useState<Result|null>(null);
 const isCard=pathname.startsWith('/portal/cards');
 const match=pathname.match(/^\/portal\/(cards|card-transactions)\/([A-Za-z0-9_-]+)$/);
 const id=match?.[2]||'';
 const transaction=params.get('transaction')||'';
 const chosen=params.get('connection')||'';
 const connection=chosen||connections?.[0]?.id||'';
 const rawPage=params.get('page')||'0';const page=/^\d+$/.test(rawPage)?Number(rawPage):-1;
 const keyword=params.get('keyword')||'';
 const cardStatus=params.get('cardStatus')||'';
 const status=params.get('status')||'',from=params.get('from')||'',to=params.get('to')||'';
 const txFilters={keyword,status,from,to};
 const filterError=isCard?'':transactionFilterError(txFilters);
 const [exporting,setExporting]=useState(false),[exportMessage,setExportMessage]=useState('');
 const exportGeneration=useRef(0);
 useEffect(()=>{exportGeneration.current++;setExporting(false);setExportMessage('');return()=>{exportGeneration.current++}},[customerId,connection,keyword,status,from,to,pathname]);
 const sort=params.get('cardSort')||'default';
 const [search,setSearch]=useState(keyword);
 const [filtersOpen,setFiltersOpen]=useState(false);
 useEffect(()=>setSearch(keyword),[keyword]);
 const base=`/client-api/v1/customers/${customerId}/card-projections`;
 useEffect(()=>{let active=true;setConnections(null);setFailure('');liveGet<Connection[]>(base).then(value=>{if(active)setConnections(value)}).catch(error=>{if(active)setFailure(authMessage(error))});return()=>{active=false}},[base,reload]);
 useEffect(()=>{
  let active=true;setResult(null);setCardTransactions(null);
  if(!connections)return;
  if(!connections.length)return;
  if(!connections.some(c=>c.id===connection)){setFailure('该数据来源不存在或尚未授权。');return}
  if(page<0||page>2500){setFailure('页码无效，请返回列表。');return}
  if(filterError){setFailure(filterError);return;}
  setFailure('');
  const selected=connections.find(c=>c.id===connection)!;
  const query=isCard?new URLSearchParams({page:String(page),revision:selected.revision}):transactionQuery(txFilters,page,selected.revision);if(isCard&&keyword)query.set('keyword',keyword);if(isCard&&cardStatus)query.set('cardStatus',cardStatus);
  const path=`${base}/${connection}/${isCard?'cards':'transactions'}${id?'/'+id:'?'+query}`;
  liveGet<Result>(path).then(data=>{if(active)setResult(data)}).catch(error=>{if(active)setFailure(authMessage(error))});
  return()=>{active=false};
 },[base,connections,connection,isCard,id,page,keyword,cardStatus,status,from,to,filterError]);
 const [pollError,setPollError]=useState(false);
 useEffect(()=>{
  if(filterError||!connection||!connections?.some(c=>c.id===connection)||page<0||page>2500)return;let active=true;
  const timer=setInterval(()=>{if(document.visibilityState!=='visible')return;
   const revision=connections.find(c=>c.id===connection)?.revision||'';const q=isCard?new URLSearchParams({page:String(page),revision}):transactionQuery(txFilters,page,revision);if(isCard&&keyword)q.set('keyword',keyword);if(isCard&&cardStatus)q.set('cardStatus',cardStatus);
   liveGet<Result>(`${base}/${connection}/${isCard?'cards':'transactions'}${id?'/'+id:'?'+q}`).then(value=>{if(active){setResult(value);setPollError(false)}}).catch(()=>{if(active)setPollError(true)});
  },15000);return()=>{active=false;clearInterval(timer)};
 },[base,connection,connections,isCard,id,page,keyword,cardStatus,status,from,to,filterError]);
 const syncCard=async(cardId:string)=>{try{await liveCardSync(`${base}/${connection}/cards/${cardId}/sync`);setReload(n=>n+1)}catch(e){setFailure(authMessage(e))}};
 const listContext=new URLSearchParams(params);listContext.delete('back');listContext.delete('transaction');
 const currentContext=pathname+'?'+listContext;
 const link=(route:string,extra:Record<string,string>={})=>`${route}?${new URLSearchParams({connection,back:currentContext,...extra})}`;
 const requestedBack=params.get('back')||'';
 const back=requestedBack==='/portal'?'/portal':/^\/portal\/(cards|transactions|card-transactions)(?:\/[A-Za-z0-9_-]+)?(?:\?[^#]*)?$/.test(requestedBack)&&requestedBack.length<1000?requestedBack:link(isCard?'/portal/cards':'/portal/transactions');
 const change=(values:Record<string,string>)=>setParams({...Object.fromEntries(params),...values});
 const exportTransactions=async()=>{
  if(exporting||!result||!connection||filterError)return;
  const generation=++exportGeneration.current;
  const canceled=()=>generation!==exportGeneration.current;
  setExporting(true);setExportMessage('正在准备导出…');
  try{
   const revision=result.revision;
   const rows=await collectTransactions<Row>(index=>liveGet<Result>(`${base}/${connection}/transactions?${transactionQuery(txFilters,index,revision)}`),revision,(count,total)=>{if(!canceled())setExportMessage(`正在导出 ${count} / ${total} 条`)},canceled);
   if(canceled())return;
   if(!rows.length){setExportMessage('当前筛选没有可导出的交易。');return;}
   const url=URL.createObjectURL(new Blob([transactionsCsv(rows)],{type:'text/csv;charset=utf-8;'}));
   const anchor=document.createElement('a');anchor.href=url;anchor.download=`moventra-transactions-${from||'all'}-${to||new Date().toISOString().slice(0,10)}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setExportMessage(`已导出 ${rows.length} 条交易。`);
  }catch(error){if(!canceled())setExportMessage((error as {code?:string})?.code==='projection_updated'?'交易数据已更新，请刷新后重新导出。':error instanceof Error?error.message:'导出失败，请重试。');}
  finally{if(!canceled())setExporting(false);}
 };
 const paging=(data:Result)=><Stack direction="row" gap={1} flexWrap="wrap" justifyContent="space-between" alignItems="center" sx={{mt:2}}><Button disabled={page===0} onClick={()=>change({page:String(page-1)})}>上一页</Button><Typography variant="body2">第 {page+1} 页 · 共 {data.total} 条</Typography><Button disabled={(page+1)*20>=data.total} onClick={()=>change({page:String(page+1)})}>下一页</Button></Stack>;
 const closeTransaction=()=>{const next=new URLSearchParams(params);next.delete('transaction');setParams(next,{replace:true});};
 const transactionLink=(value:string)=>{const next=new URLSearchParams(params);next.set('connection',connection);next.set('transaction',value);return pathname+'?'+next;};
 const txTable=(data:Result)=><><Typography variant="caption" color="text.secondary" sx={{display:{xs:'block',md:'none'},mb:1}}>左右滑动查看金额、状态与详情</Typography><TableContainer tabIndex={0} aria-label="卡片交易，可横向滚动"><Table size="small" sx={{...transactionTableSx,minWidth:880}}><TableHead><TableRow>{['商户','所属卡片','账户金额','原币金额','交易状态','来源时间','操作'].map(x=><TableCell key={x}>{x}</TableCell>)}</TableRow></TableHead><TableBody>{data.rows.map(row=><TableRow key={row.id} hover tabIndex={0} aria-label={`查看 ${row.merchant||'交易'} 的详情`} onClick={event=>{if(!(event.target as HTMLElement).closest('a,button,input,select,textarea,[role="button"]'))navigate(transactionLink(row.id));}} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();navigate(transactionLink(row.id));}}} sx={{...transactionTableRowSx(transactionAppearance(row).color),cursor:'pointer','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main',outlineOffset:-2}}}><TableCell><MerchantCell name={row.merchant||'未知商户'} subtitle="卡片交易"/></TableCell><TableCell><Button component={Link} to={link(`/portal/cards/${row.cardId}`)}>{row.cardName||'查看卡片'} · {row.cardLast4?`•••• ${row.cardLast4}`:'尾号未知'}</Button></TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{snapshotAmount(row.amountCents)}</TableCell><TableCell>{snapshotAmount(row.originalCurrency?.amountCents,row.originalCurrency?.code||'币种未知')}</TableCell><TableCell><SnapshotStatus row={row}/></TableCell><TableCell>{time(row.date)}</TableCell><TableCell><Button component={Link} to={transactionLink(row.id)}>详情</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>{!data.rows.length&&<Stack alignItems="center" spacing={1} sx={{py:6}}><Typography variant="subtitle1">{keyword||status||from||to?'没有符合条件的交易':'暂无卡片交易'}</Typography><Typography variant="body2" color="text.secondary">{keyword||status||from||to?'试试其他描述、日期或状态。':'卡片产生消费或退款后，可在这里查询。'}</Typography>{Boolean(keyword||status||from||to)&&<Button onClick={()=>change({keyword:'',status:'',from:'',to:'',page:'0'})}>清空筛选</Button>}</Stack>}{paging(data)}</>;
 const resetFilters=()=>{setSearch('');change({keyword:'',cardStatus:'',page:'0',cardSort:''});};
 const cardRows=[...(result?.rows||[])];
 if(sort==='name')cardRows.sort((a,b)=>cardName(a).localeCompare(cardName(b),'zh-CN')||a.id.localeCompare(b.id));
 if(sort==='newest')cardRows.sort((a,b)=>(Date.parse(b.createdAtUTC||'')||0)-(Date.parse(a.createdAtUTC||'')||0)||a.id.localeCompare(b.id));
 const cardList=<>
  <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={1}>
   <Typography variant="body2" role="status">找到 {result?.total} 张卡片 · 本页 {cardRows.length} 张</Typography>
  </Stack>
  <TableContainer sx={{display:{xs:'none',md:'block'}}}>
   <Table aria-label="我的卡片列表" sx={{tableLayout:'fixed'}}>
    <colgroup>{[23,9,12,13,16,17,10].map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup>
    <TableHead><TableRow>{['卡片','后四位','状态','可消费额度','近 30 天消费','创建时间','操作'].map(x=><TableCell key={x}>{x}</TableCell>)}</TableRow></TableHead>
    <TableBody>{cardRows.map(row=><TableRow key={row.id} hover>
     <TableCell><Typography component={Link} to={link(`/portal/cards/${row.id}`)} fontWeight={600} color="text.primary" sx={{overflowWrap:'anywhere'}}>{cardName(row)}</Typography></TableCell>
     <TableCell>{row.cardLast4||row.last4?<Typography component={Link} to={link(`/portal/cards/${row.id}`)} variant="body2" color="primary.main" aria-label={`查看尾号 ${row.cardLast4||row.last4} 的卡片详情`} sx={{display:'inline-block',py:0.5,textDecoration:'underline',textUnderlineOffset:'3px',fontVariantNumeric:'tabular-nums'}}>{row.cardLast4||row.last4}</Typography>:<Typography variant="body2" color="text.secondary">尾号未知</Typography>}</TableCell>
     <TableCell><ChannelCardStatus status={row.cardStatus}/></TableCell>
     <TableCell><CardMetric row={row} kind="available"/></TableCell>
     <TableCell><CardMetric row={row} kind="spending"/></TableCell>
     <TableCell sx={{overflowWrap:'anywhere'}}>{cardCreatedDate(row.createdAtUTC)}</TableCell>
     <TableCell><Button component={Link} to={link(`/portal/cards/${row.id}`)} aria-label={`查看 ${cardName(row)} 的详情`}>详情</Button></TableCell>
    </TableRow>)}</TableBody>
   </Table>
  </TableContainer>
  <Stack spacing={1.5} sx={{display:{xs:'flex',md:'none'}}}>
   {cardRows.map(row=><Paper variant="outlined" key={row.id} sx={{p:2}}>
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}><Box sx={{minWidth:0}}><Typography fontWeight={600} sx={{overflowWrap:'anywhere'}}>{cardName(row)}</Typography>{row.cardLast4||row.last4?<Typography component={Link} to={link(`/portal/cards/${row.id}`)} variant="body2" color="primary.main" aria-label={`查看尾号 ${row.cardLast4||row.last4} 的卡片详情`} sx={{display:'inline-block',py:0.5,textDecoration:'underline',textUnderlineOffset:'3px',fontVariantNumeric:'tabular-nums'}}>{row.cardLast4||row.last4}</Typography>:<Typography variant="body2" color="text.secondary">尾号未知</Typography>}</Box><ChannelCardStatus status={row.cardStatus}/></Stack>
    <Box sx={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:2,py:2}}>
     <Box><Typography variant="caption" color="text.secondary" display="block">可消费额度</Typography><CardMetric row={row} kind="available"/></Box>
     <Box><Typography variant="caption" color="text.secondary" display="block">近 30 天消费</Typography><CardMetric row={row} kind="spending"/></Box>
    </Box>
    <Typography variant="caption" display="block" color="text.secondary">创建：{cardCreatedDate(row.createdAtUTC)}</Typography>
    <Button component={Link} to={link(`/portal/cards/${row.id}`)} fullWidth variant="outlined" sx={{mt:2,minHeight:44}}>详情</Button>
   </Paper>)}
  </Stack>
  {!cardRows.length&&<Stack alignItems="center" spacing={1} sx={{py:5,textAlign:'center'}}><Typography variant="h6">{keyword||cardStatus?'没有符合条件的卡片':'当前页暂无卡片'}</Typography><Typography color="text.secondary" variant="body2">{keyword||cardStatus?'试试其他名称、后四位，或清空筛选条件。':'可以返回第一页，或刷新查看最新分配结果。'}</Typography><Button onClick={resetFilters}>{keyword||cardStatus?'清空筛选':'返回第一页'}</Button></Stack>}
  {!!cardRows.length&&<Typography variant="caption" color="text.secondary">近 30 天消费按已入账消费统计；可消费额度不代表可提现余额。</Typography>}
  {result&&paging(result)}
 </>;
 const content=<Stack spacing={3}>
  {isCard&&!id&&<Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} gap={2}>
   <Typography variant="body2" color="text.secondary">查找卡片、查看状态与交易记录。</Typography>
   <Stack direction="row" gap={1} flexWrap="wrap"><Button component={Link} to="/portal/card-orders" variant="outlined">开卡订单</Button><Button component={Link} to="/portal/cards/new" variant="contained">申请新卡</Button></Stack>
  </Stack>}
  <Paper variant="outlined" sx={{p:{xs:2,md:3},minWidth:0}}><Stack spacing={2.5}>
  <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{xs:'stretch',sm:'center'}} gap={1.5}><Box>{isCard&&id?<Button component={Link} to={back}>{back==='/portal'?'返回工作台':'返回卡片列表'}</Button>:<><Typography variant="h6">{isCard?(id?'卡片详情':'我的卡片'):(id?'卡片交易详情':'卡片交易')}</Typography><Typography variant="caption" color="text.secondary">{isCard?'仅展示归属于本账户的卡片，状态以最近一次渠道核验为准。':'查询消费、退款及处理进度。'}</Typography></>}</Box><Stack direction="row" gap={1} flexWrap="wrap" justifyContent={{xs:'flex-start',sm:'flex-end'}}><Button sx={{flexShrink:0}} disabled={exporting} onClick={()=>setReload(x=>x+1)}>刷新状态</Button>{!isCard&&!id&&<Button variant="outlined" disabled={exporting||!result||!result.total||Boolean(filterError)||Boolean(failure)} onClick={()=>void exportTransactions()} startIcon={<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>}>{exporting?'导出中…':'导出 CSV'}</Button>}</Stack></Stack>
  {!isCard&&!id&&<><TransactionFilters value={txFilters} onChange={value=>change({...value,page:'0'})}/><Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap"><Typography variant="caption" color="text.secondary">{result?`共 ${result.total} 笔交易 · `:''}日期按 UTC · 导出当前筛选，最多 5,000 条</Typography><Button component={Link} to="/portal/fund-records" size="small">查看资金记录 →</Button></Stack>{exportMessage&&<Stack direction="row" alignItems="center" gap={1}><Typography variant="body2" role="status">{exportMessage}</Typography>{exporting&&<Button onClick={()=>{exportGeneration.current++;setExporting(false);setExportMessage('已取消导出。');}}>取消导出</Button>}</Stack>}</>}
  {id&&!isCard&&<Button sx={{alignSelf:'flex-start'}} component={Link} to={back}>{back==='/portal'?'返回工作台':`返回${isCard?'卡片':'交易'}列表`}</Button>}
  {pollError&&<Alert severity="warning">连接暂时中断，当前显示最后已确认状态。请刷新重试。</Alert>}
  {failure?<Alert severity="error" action={<Button onClick={()=>setReload(x=>x+1)}>重试</Button>}>{failure}</Alert>:connections===null?<CircularProgress size={24}/>:!connections.length?<Alert severity="info">尚未为本账户分配卡片。</Alert>:<>
   {isCard&&!id&&<Stack direction={{xs:'column',md:'row'}} gap={1.5} alignItems={{md:'flex-start'}}>
    {isCard&&!id&&<Box component="form" onSubmit={event=>{event.preventDefault();change({keyword:search.trim(),page:'0'});}} sx={{display:'flex',gap:1,flex:1,minWidth:0}}><TextField fullWidth size="small" label={isCard?'搜索卡名、尾号或卡片 ID':'搜索商户、尾号或交易 ID'} value={search} onChange={e=>setSearch(e.target.value)}/><Button type="submit" variant="outlined" sx={{flexShrink:0}}>搜索</Button></Box>}
    {isCard&&!id&&<Button sx={{display:{md:'none'},alignSelf:'flex-start'}} aria-expanded={filtersOpen} aria-controls="card-list-options" onClick={()=>setFiltersOpen(value=>!value)}>{filtersOpen?'收起筛选与排序':'筛选与排序'}</Button>}
    <Box id="card-list-options" sx={{display:{xs:isCard&&!id&&!filtersOpen?'none':'flex',md:'flex'},flexDirection:{xs:'column',md:'row'},gap:1.5}}>
    {isCard&&!id&&<TextField select size="small" label="卡片状态" value={cardStatus} onChange={e=>change({cardStatus:e.target.value,page:'0'})} sx={{minWidth:{md:140}}}><MenuItem value="">全部状态</MenuItem>{Object.entries(cardStatusLabels).map(([value,label])=><MenuItem value={value} key={value}>{label}</MenuItem>)}{cardStatus&&!cardStatusLabels[cardStatus]&&<MenuItem value={cardStatus}>{cardStatus}</MenuItem>}</TextField>}
    {isCard&&!id&&<TextField select size="small" label="当前页排序" value={['name','newest'].includes(sort)?sort:'default'} onChange={e=>change({cardSort:e.target.value})} sx={{minWidth:{md:160}}}><MenuItem value="default">默认顺序</MenuItem><MenuItem value="name">名称 A–Z</MenuItem><MenuItem value="newest">创建时间从新到旧</MenuItem></TextField>}
    </Box>
   </Stack>}
   {isCard&&!id&&(keyword||cardStatus)&&<Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">{keyword&&<Chip size="small" label={`搜索：${keyword}`} onDelete={()=>{setSearch('');change({keyword:'',page:'0'});}}/>}{isCard&&cardStatus&&<Chip size="small" label={`状态：${cardStatusLabels[cardStatus]||cardStatus}`} onDelete={()=>change({cardStatus:'',page:'0'})}/>}<Button size="small" onClick={resetFilters}>清空筛选</Button></Stack>}
   {!result?<CircularProgress size={24}/>:<>
    {isCard?<>{id?<Box>{result.rows.map(row=><CardDetailWorkspace key={`${customerId}:${connection}:${row.id}`} customerId={customerId} connection={connection} card={row} reload={reload} onRefresh={()=>setReload(n=>n+1)}/>)}</Box>:cardList}</>:id?<Typography variant="body2">关闭详情后返回交易列表。</Typography>:txTable(result)}
   </>}
  </>}
  {result&&isCard&&<Box component="details" sx={{borderTop:1,borderColor:'divider',pt:2,color:'text.secondary'}}><Typography component="summary" variant="caption" sx={{cursor:'pointer'}}>数据范围与更新时间</Typography><Typography variant="caption">来源：{time(result.sourceAt)} · 导入：{time(result.importedAt)}<br/>{result.coverageReason}</Typography></Box>}
  {result&&(!isCard||Boolean(id&&cardTransactions))&&<LogoAttribution/>}
 </Stack></Paper></Stack>;
 if(!isCard&&id)return <SnapshotTransactionDrawer row={result?.rows[0]} loading={!result&&!failure} error={failure} onRetry={()=>setReload(x=>x+1)} onClose={()=>navigate(back,{replace:true})} cardLink={row=>link(`/portal/cards/${row.cardId}`)}/>;
 return <>{content}{transaction&&<TransactionSelection key={`${customerId}:${connection}:${transaction}`} base={base} connection={connection} id={transaction} onClose={closeTransaction} cardLink={row=>link(`/portal/cards/${row.cardId}`)}/>}</>;
}

function TransactionSelection({base,connection,id,onClose,cardLink}:{base:string;connection:string;id:string;onClose:()=>void;cardLink:(row:Row)=>string}){
 const [data,setData]=useState<Result|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError('');
  if(!connection){setError('该数据来源不存在或尚未授权。');return;}
  liveGet<Result>(`${base}/${encodeURIComponent(connection)}/transactions/${encodeURIComponent(id)}`).then(value=>{if(active)setData(value)}).catch(reason=>{if(active)setError(authMessage(reason))});
  return()=>{active=false};
 },[base,connection,id,retry]);
 return <SnapshotTransactionDrawer row={data?.rows[0]} loading={!data&&!error} error={error} onRetry={()=>setRetry(x=>x+1)} onClose={onClose} cardLink={cardLink}/>;
}

function SnapshotTransactionDrawer({row,loading,error,onRetry,onClose,cardLink}:{row?:Row;loading:boolean;error:string;onRetry:()=>void;onClose:()=>void;cardLink:(row:Row)=>string}){
 const amount=snapshotAmount(row?.amountCents);
 const field=(label:string,value:React.ReactNode)=><Box sx={{display:'grid',gridTemplateColumns:'minmax(100px, .8fr) minmax(0, 1.4fr)',gap:2,py:2,borderBottom:1,borderColor:'divider'}}><Typography component="dt" variant="body2" color="text.secondary">{label}</Typography><Box component="dd" sx={{m:0,textAlign:'right',overflowWrap:'anywhere',fontSize:14}}>{value}</Box></Box>;
 return <Drawer anchor="right" open onClose={onClose} PaperProps={{role:'dialog','aria-modal':true,'aria-labelledby':'snapshot-transaction-title',sx:{width:{xs:'100%',sm:470},maxWidth:'100vw'}}}>
  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{px:2.5,py:2,borderBottom:1,borderColor:'divider',flexShrink:0}}><Typography id="snapshot-transaction-title" variant="subtitle1" fontWeight={700}>卡交易详情</Typography><IconButton aria-label="关闭交易详情" onClick={onClose}><span aria-hidden="true">×</span></IconButton></Stack>
  <Box sx={{overflowY:'auto',flex:1}}>
   {loading?<Stack alignItems="center" gap={2} sx={{p:4}} role="status"><CircularProgress size={24}/><Typography>正在读取交易详情…</Typography></Stack>:error?<Alert severity="error" sx={{m:2}} action={<Button onClick={onRetry}>重试</Button>}>{error}</Alert>:!row?<Alert severity="info" sx={{m:2}}>该交易不存在或当前不可读取。</Alert>:<>
    <Stack alignItems="center" spacing={1.5} sx={{p:2.5,bgcolor:'grey.50'}}><MerchantLogo name={row.merchant} size={56}/><Typography variant="h5" textAlign="center" color={transactionAppearance(row).color==='error'?'error.main':'text.primary'} fontWeight={700} sx={{overflowWrap:'anywhere',maxWidth:'100%'}}>{row.merchant||'未知商户'}</Typography><Typography variant="h3" color={transactionAppearance(row).color==='error'?'error.main':'text.primary'} aria-label={amount} fontWeight={700} sx={{fontVariantNumeric:'tabular-nums',overflowWrap:'anywhere',maxWidth:'100%'}}>{amount.startsWith('USD ')?amount.slice(4):amount}</Typography><Typography variant="body2" color="text.secondary">USD · 卡片交易</Typography><Paper variant="outlined" sx={{p:1.5,width:'100%',mt:1}}><Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Typography variant="body2">{time(row.date)}</Typography><SnapshotStatus row={row} showSource={false}/></Stack><Typography variant="caption" color="text.secondary">来源日期 · UTC</Typography></Paper></Stack>
    <Box sx={{px:2.5}}><Typography sx={{py:2,borderBottom:2,borderColor:'primary.main',color:'primary.main'}}>详情</Typography><Box component="dl" sx={{m:0}}>
     {field('交易 ID',row.id)}
     {field('所属卡片',row.cardId?<Button component={Link} to={cardLink(row)}>{row.cardName||'查看卡片'} · {row.cardLast4?`•••• ${row.cardLast4}`:'尾号未知'} →</Button>:'未提供')}
     {field('授权时间',time(row.authorizedAt))}
     {field('来源时间',time(row.date))}
     {field('详细状态',<SnapshotStatus row={row} showSource={false}/>)}
     {field('原币金额',snapshotAmount(row.originalCurrency?.amountCents,row.originalCurrency?.code||'币种未知'))}
    </Box><Box sx={{py:2}}><LogoAttribution/></Box></Box>
   </>}
  </Box>
 </Drawer>;
}


type StatusColor = 'success' | 'warning' | 'error' | 'info' | 'default';
type StatusIcon = 'check' | 'close' | 'clock' | 'review' | 'refund' | 'reverse' | 'return' | 'cancel' | 'dispute' | 'unknown';
// Presentation only; source posting/detail states remain unchanged in the response.
export function transactionAppearance(row: Pick<Row,'status'|'detailedStatus'>):{label:string;color:StatusColor;icon:StatusIcon}{
 const {status,detailedStatus:detail}=row;
 const posting:Record<string,string>={pending:'待入账',posted:'已入账',failed:'入账失败'};
 if((status&&!posting[status])||(detail&&!detailLabels[detail]))return {label:'未知状态',color:'default',icon:'unknown'};
 if(detail==='settled')return status==='posted'?{label:'已结算',color:'success',icon:'check'}:{label:'待核实',color:'warning',icon:'unknown'};
 if(detail==='refund')return status==='posted'?{label:'已退款',color:'info',icon:'refund'}:status==='pending'?{label:'退款处理中',color:'warning',icon:'clock'}:{label:'待核实',color:'warning',icon:'unknown'};
 const states:Record<string,{label:string;color:StatusColor;icon:StatusIcon}>={
  pending:{label:'待入账',color:'warning',icon:'clock'},pending_approval:{label:'待批准',color:'warning',icon:'clock'},
  in_review:{label:'审核中',color:'warning',icon:'review'},canceled:{label:'已取消',color:'default',icon:'cancel'},
  failed:{label:'失败',color:'error',icon:'close'},declined:{label:'已拒绝',color:'error',icon:'close'},
  reversed:{label:'已撤销',color:'info',icon:'reverse'},returned:{label:'已退回',color:'info',icon:'return'},
  dispute:{label:'争议中',color:'error',icon:'dispute'},
 };
 if(detail)return states[detail];
 if(status==='posted')return {label:'已入账',color:'success',icon:'check'};
 if(status==='failed')return {label:'入账失败',color:'error',icon:'close'};
 if(status==='pending')return states.pending;
 return {label:'未知状态',color:'default',icon:'unknown'};
}
function SnapshotStatus({row,showSource=true}:{row:Row;showSource?:boolean}){
 const display=transactionAppearance(row);
 const paths:Record<StatusIcon,string>={
  check:'M8 12l3 3 5-6',close:'M9 9l6 6m0-6l-6 6',clock:'M12 7v5l3 2',
  review:'M8 9h8M8 12h8M8 15h5',refund:'M8 10h6a3 3 0 0 1 0 6h-2M8 10l3-3m-3 3l3 3',
  reverse:'M7 10a6 6 0 1 1 0 5M7 6v4h4',return:'M16 8v6H8m0 0l3-3m-3 3l3 3',
  cancel:'M8 12h8',dispute:'M12 7v6m0 3h.01',unknown:'M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2m0 3h.01',
 };
 return <Chip size="small" title={showSource?`入账状态：${row.status||'未知'} · 详细状态：${row.detailedStatus||'未知'}`:display.label} label={display.label}
  icon={<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d={paths[display.icon]}/></svg>}
  sx={theme=>transactionChipSx(theme,display.color)}/>;
}

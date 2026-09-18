import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Chip, Drawer, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { authMessage, liveGet, liveCardSync } from '../../../../packages/shared/src/auth/liveApi';
import { MerchantCell, MerchantLogo, LogoAttribution } from '../../../../packages/shared/src/components/MerchantLogo';
import { snapshotAmount, cardSyncLabel, type CardSyncInfo } from '../../../../packages/shared/src/auth/cardSnapshotContract';

type Connection={id:string;label:string;revision:string;sourceAt:string;importedAt:string};
type Row=CardSyncInfo & {id:string;name?:string;cardName?:string;last4?:string;cardLast4?:string;cardStatus?:string;cardId?:string;merchant?:string;status?:string;detailedStatus?:string;amountCents?:string;originalCurrency?:{code?:string;amountCents?:string};date?:string;authorizedAt?:string;createdAtUTC?:string};
type Result={rows:Row[];total:number;page:number;revision:string;sourceAt:string;importedAt:string;coverageReason:string};
const detailLabels:Record<string,string>={pending:'待处理',pending_approval:'待批准',in_review:'审核中',canceled:'已取消',failed:'失败',settled:'已结算',declined:'已拒绝',refund:'退款',reversed:'已撤销',returned:'退回',dispute:'争议'};
const time=(value?:string)=>value?value.replace('T',' ').replace('Z',' UTC'):'未知';
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
 const base=`/client-api/v1/customers/${customerId}/card-projections`;
 useEffect(()=>{let active=true;setConnections(null);setFailure('');liveGet<Connection[]>(base).then(value=>{if(active)setConnections(value)}).catch(error=>{if(active)setFailure(authMessage(error))});return()=>{active=false}},[base,reload]);
 useEffect(()=>{
  let active=true;setResult(null);setCardTransactions(null);
  if(!connections)return;
  if(!connections.length)return;
  if(!connections.some(c=>c.id===connection)){setFailure('该数据来源不存在或尚未授权。');return}
  if(page<0||page>2500){setFailure('页码无效，请返回列表。');return}
  setFailure('');
  const selected=connections.find(c=>c.id===connection)!;
  const query=new URLSearchParams({page:String(page),revision:selected.revision});if(keyword)query.set('keyword',keyword);
  const path=`${base}/${connection}/${isCard?'cards':'transactions'}${id?'/'+id:'?'+query}`;
  Promise.all([liveGet<Result>(path),isCard&&id?liveGet<Result>(`${base}/${connection}/transactions?${new URLSearchParams({cardId:id,page:String(page),revision:selected.revision})}`):Promise.resolve(null)])
   .then(([data,txs])=>{if(active){setResult(data);setCardTransactions(txs)}}).catch(error=>{if(active)setFailure(authMessage(error))});
  return()=>{active=false};
 },[base,connections,connection,isCard,id,page,keyword]);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')setReload(n=>n+1)},15000);return()=>clearInterval(timer)},[]);
 const syncCard=async(cardId:string)=>{try{await liveCardSync(`${base}/${connection}/cards/${cardId}/sync`);setReload(n=>n+1)}catch(e){setFailure(authMessage(e))}};
 const listContext=new URLSearchParams(params);listContext.delete('back');listContext.delete('transaction');
 const currentContext=pathname+'?'+listContext;
 const link=(route:string,extra:Record<string,string>={})=>`${route}?${new URLSearchParams({connection,back:currentContext,...extra})}`;
 const requestedBack=params.get('back')||'';
 const back=/^\/portal\/(cards|transactions|card-transactions)(?:\/[A-Za-z0-9_-]+)?(?:\?[^#]*)?$/.test(requestedBack)&&requestedBack.length<1000?requestedBack:link(isCard?'/portal/cards':'/portal/transactions');
 const change=(values:Record<string,string>)=>setParams({...Object.fromEntries(params),...values});
 const paging=(data:Result)=><Stack direction="row" spacing={2} alignItems="center" sx={{mt:2}}><Button disabled={page===0} onClick={()=>change({page:String(page-1)})}>上一页</Button><Typography variant="body2">第 {page+1} 页 · 共 {data.total} 条</Typography><Button disabled={(page+1)*20>=data.total} onClick={()=>change({page:String(page+1)})}>下一页</Button></Stack>;
 const closeTransaction=()=>{const next=new URLSearchParams(params);next.delete('transaction');setParams(next,{replace:true});};
 const transactionLink=(value:string)=>{const next=new URLSearchParams(params);next.set('connection',connection);next.set('transaction',value);return pathname+'?'+next;};
 const txTable=(data:Result)=><><TableContainer><Table size="small"><TableHead><TableRow>{['商户','所属卡片','账户金额','原币金额','交易状态','来源时间','操作'].map(x=><TableCell key={x}>{x}</TableCell>)}</TableRow></TableHead><TableBody>{data.rows.map(row=><TableRow key={row.id} hover sx={transactionAppearance(row).color==='error'?{'& .MuiTableCell-root, & .MuiButton-root, & .MuiTypography-root':{color:'error.main'}}:undefined}><TableCell><MerchantCell name={row.merchant||'未知商户'}/></TableCell><TableCell><Button component={Link} to={link(`/portal/cards/${row.cardId}`)}>{row.cardName||'查看卡片'} · {row.cardLast4?`•••• ${row.cardLast4}`:'尾号未知'}</Button></TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{snapshotAmount(row.amountCents)}</TableCell><TableCell>{snapshotAmount(row.originalCurrency?.amountCents,row.originalCurrency?.code||'币种未知')}</TableCell><TableCell><SnapshotStatus row={row}/></TableCell><TableCell>{time(row.date)}</TableCell><TableCell><Button component={Link} to={transactionLink(row.id)}>详情</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>{!data.rows.length&&<Alert severity="info">当前范围没有关联交易。</Alert>}{paging(data)}</>;
 const content=<Paper variant="outlined" sx={{p:{xs:2,md:3}}}><Stack spacing={2}>
  <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h6">{isCard?(id?'卡片详情':'我的卡片'):(id?'卡片交易详情':'卡片交易')}</Typography><Button onClick={()=>setReload(x=>x+1)}>刷新状态</Button></Stack>
  <Alert severity="info">仅展示归属于本账户的卡片。卡片状态以最近一次渠道核验为准；交易和资金信息分别核对。</Alert>
  {id&&<Button sx={{alignSelf:'flex-start'}} component={Link} to={back}>返回{isCard?'卡片':'交易'}列表</Button>}
  {failure?<Alert severity="error" action={<Button onClick={()=>setReload(x=>x+1)}>重试</Button>}>{failure}</Alert>:connections===null?<CircularProgress size={24}/>:!connections.length?<Alert severity="info">尚未为本账户分配卡片。</Alert>:<>
   <TextField select size="small" label="数据来源" value={connection} onChange={e=>change({connection:e.target.value,page:'0'})}>{connections.map(c=><MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}</TextField>
   {!id&&<TextField size="small" label={isCard?'搜索卡名、尾号或卡片 ID':'搜索商户、尾号或交易 ID'} value={keyword} onChange={e=>change({keyword:e.target.value,page:'0'})}/>}
   {!result?<CircularProgress size={24}/>:<>
    <Typography variant="caption" color="text.secondary">来源：{time(result.sourceAt)} · 导入：{time(result.importedAt)}<br/>{result.coverageReason}</Typography>
    {isCard?<>{id?<Box>{result.rows.map(row=><Stack key={row.id} spacing={1}><Typography variant="h5">{row.cardName||row.name||'未命名卡片'} · {row.cardLast4||row.last4||'尾号未知'}</Typography><Typography>渠道状态：{row.cardStatus||'未知'}</Typography><Typography color={row.syncState==='error'||row.syncState==='stale'?'warning.main':'text.secondary'}>{cardSyncLabel(row)}</Typography>{row.syncState&&<Button disabled={row.syncState==='pending'} onClick={()=>syncCard(row.id)}>向渠道核对状态</Button>}<Typography>创建时间：{time(row.createdAtUTC)}</Typography><Typography variant="caption">卡片 ID：{row.id}</Typography><Typography variant="h6" sx={{pt:2}}>关联交易</Typography>{cardTransactions&&txTable(cardTransactions)}</Stack>)}</Box>:<><TableContainer><Table size="small"><TableHead><TableRow>{['卡片','后四位','渠道状态','创建时间','操作'].map(x=><TableCell key={x}>{x}</TableCell>)}</TableRow></TableHead><TableBody>{result.rows.map(row=><TableRow key={row.id}><TableCell>{row.cardName||row.name||'未命名卡片'}</TableCell><TableCell>{row.cardLast4||row.last4||'未知'}</TableCell><TableCell>{row.cardStatus||'未知'}<Typography variant="caption" display="block" color="text.secondary">{cardSyncLabel(row)}</Typography></TableCell><TableCell>{time(row.createdAtUTC)}</TableCell><TableCell><Button component={Link} to={link(`/portal/cards/${row.id}`)}>详情与交易</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>{!result.rows.length&&<Alert severity="info">当前筛选没有卡片。</Alert>}{paging(result)}</>}</>:id?<Typography variant="body2">关闭详情后返回交易列表。</Typography>:txTable(result)}
   </>}
  </>}
  {result&&(!isCard||Boolean(id&&cardTransactions))&&<LogoAttribution/>}
 </Stack></Paper>;
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
    <Stack alignItems="center" spacing={1.5} sx={{p:2.5,bgcolor:'grey.50'}}><MerchantLogo name={row.merchant} size={56}/><Typography variant="h5" textAlign="center" color={transactionAppearance(row).color==='error'?'error.main':'text.primary'} fontWeight={700} sx={{overflowWrap:'anywhere',maxWidth:'100%'}}>{row.merchant||'未知商户'}</Typography><Typography variant="h3" color={transactionAppearance(row).color==='error'?'error.main':'text.primary'} aria-label={amount} fontWeight={700} sx={{fontVariantNumeric:'tabular-nums',overflowWrap:'anywhere',maxWidth:'100%'}}>{amount.startsWith('USD ')?amount.slice(4):amount}</Typography><Typography variant="body2" color="text.secondary">USD · 卡片交易</Typography><Paper variant="outlined" sx={{p:1.5,width:'100%',mt:1}}><Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Typography variant="body2">{time(row.date)}</Typography><SnapshotStatus row={row}/></Stack><Typography variant="caption" color="text.secondary">来源日期 · UTC</Typography></Paper></Stack>
    <Box sx={{px:2.5}}><Typography sx={{py:2,borderBottom:2,borderColor:'primary.main',color:'primary.main'}}>详情</Typography><Box component="dl" sx={{m:0}}>
     {field('交易 ID',row.id)}
     {field('所属卡片',row.cardId?<Button component={Link} to={cardLink(row)}>{row.cardName||'查看卡片'} · {row.cardLast4?`•••• ${row.cardLast4}`:'尾号未知'} →</Button>:'未提供')}
     {field('授权时间',time(row.authorizedAt))}
     {field('来源时间',time(row.date))}
     {field('入账状态',row.status||'未知')}
     {field('详细状态',`${detailLabels[row.detailedStatus||'']||row.detailedStatus||'未知'}${detailLabels[row.detailedStatus||'']?' · '+row.detailedStatus:''}`)}
     {field('原币金额',snapshotAmount(row.originalCurrency?.amountCents,row.originalCurrency?.code||'币种未知'))}
    </Box><Box sx={{py:2}}><LogoAttribution/></Box></Box>
   </>}
  </Box>
 </Drawer>;
}


type StatusColor = 'success' | 'warning' | 'error' | 'info' | 'default';
type StatusIcon = 'check' | 'close' | 'clock' | 'review' | 'refund' | 'reverse' | 'return' | 'cancel' | 'dispute' | 'unknown';
// Presentation only; preserve the original posting/detail states in the drawer.
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
function SnapshotStatus({row}:{row:Row}){
 const display=transactionAppearance(row);
 const paths:Record<StatusIcon,string>={
  check:'M8 12l3 3 5-6',close:'M9 9l6 6m0-6l-6 6',clock:'M12 7v5l3 2',
  review:'M8 9h8M8 12h8M8 15h5',refund:'M8 10h6a3 3 0 0 1 0 6h-2M8 10l3-3m-3 3l3 3',
  reverse:'M7 10a6 6 0 1 1 0 5M7 6v4h4',return:'M16 8v6H8m0 0l3-3m-3 3l3 3',
  cancel:'M8 12h8',dispute:'M12 7v6m0 3h.01',unknown:'M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2m0 3h.01',
 };
 return <Chip size="small" title={`入账状态：${row.status||'未知'} · 详细状态：${row.detailedStatus||'未知'}`} label={display.label}
  icon={<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d={paths[display.icon]}/></svg>}
  sx={theme=>({height:25,borderRadius:0.75,fontWeight:600,color:display.color==='default'?theme.palette.text.secondary:theme.palette[display.color].dark,bgcolor:display.color==='default'?theme.palette.action.hover:theme.palette[display.color].main+'18','& .MuiChip-icon':{color:'inherit',ml:0.75},'& .MuiChip-label':{px:0.75}})}/>;
}

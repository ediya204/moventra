import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { authMessage, liveGet } from '../../../../packages/shared/src/auth/liveApi';
import { MerchantCell, MerchantLogo, LogoAttribution } from '../../../../packages/shared/src/components/MerchantLogo';
import { snapshotAmount } from '../../../../packages/shared/src/auth/cardSnapshotContract';

type Connection={id:string;label:string;revision:string;sourceAt:string;importedAt:string};
type Row={id:string;name?:string;cardName?:string;last4?:string;cardLast4?:string;cardStatus?:string;cardId?:string;merchant?:string;status?:string;detailedStatus?:string;amountCents?:string;originalCurrency?:{code?:string;amountCents?:string};date?:string;authorizedAt?:string;createdAtUTC?:string};
type Result={rows:Row[];total:number;page:number;revision:string;sourceAt:string;importedAt:string;coverageReason:string};
const detailLabels:Record<string,string>={pending:'待处理',pending_approval:'待批准',in_review:'审核中',canceled:'已取消',failed:'失败',settled:'已结算',declined:'已拒绝',refund:'退款',reversed:'已撤销',returned:'退回',dispute:'争议'};
const time=(value?:string)=>value?value.replace('T',' ').replace('Z',' UTC'):'未知';
export default function CardSnapshots({customerId}:{customerId:string}) {
 const {pathname}=useLocation(); const [params,setParams]=useSearchParams();
 const [reload,setReload]=useState(0),[failure,setFailure]=useState('');
 const [connections,setConnections]=useState<Connection[]|null>(null);
 const [result,setResult]=useState<Result|null>(null),[cardTransactions,setCardTransactions]=useState<Result|null>(null);
 const isCard=pathname.startsWith('/portal/cards');
 const match=pathname.match(/^\/portal\/(cards|card-transactions)\/([A-Za-z0-9_-]+)$/);
 const id=match?.[2]||'';
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
 const listContext=new URLSearchParams(params);listContext.delete('back');
 const currentContext=pathname+'?'+listContext;
 const link=(route:string,extra:Record<string,string>={})=>`${route}?${new URLSearchParams({connection,back:currentContext,...extra})}`;
 const requestedBack=params.get('back')||'';
 const back=/^\/portal\/(cards|transactions|card-transactions)(?:\/[A-Za-z0-9_-]+)?(?:\?[^#]*)?$/.test(requestedBack)&&requestedBack.length<1000?requestedBack:link(isCard?'/portal/cards':'/portal/transactions');
 const change=(values:Record<string,string>)=>setParams({...Object.fromEntries(params),...values});
 const paging=(data:Result)=><Stack direction="row" spacing={2} alignItems="center" sx={{mt:2}}><Button disabled={page===0} onClick={()=>change({page:String(page-1)})}>上一页</Button><Typography variant="body2">第 {page+1} 页 · 共 {data.total} 条</Typography><Button disabled={(page+1)*20>=data.total} onClick={()=>change({page:String(page+1)})}>下一页</Button></Stack>;
 const txTable=(data:Result)=><><TableContainer><Table size="small"><TableHead><TableRow>{['商户','所属卡片','账户金额','原币金额','入账 / 详细状态','来源时间','操作'].map(x=><TableCell key={x}>{x}</TableCell>)}</TableRow></TableHead><TableBody>{data.rows.map(row=><TableRow key={row.id}><TableCell><MerchantCell name={row.merchant||'未知商户'}/></TableCell><TableCell><Button component={Link} to={link(`/portal/cards/${row.cardId}`)}>{row.cardName||'查看卡片'} · {row.cardLast4||'尾号未知'}</Button></TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{snapshotAmount(row.amountCents)}</TableCell><TableCell>{snapshotAmount(row.originalCurrency?.amountCents,row.originalCurrency?.code||'币种未知')}</TableCell><TableCell>{row.status||'未知'} / {detailLabels[row.detailedStatus||'']||row.detailedStatus||'未知'}</TableCell><TableCell>{time(row.date)}</TableCell><TableCell><Button component={Link} to={link(`/portal/card-transactions/${row.id}`)}>详情</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>{!data.rows.length&&<Alert severity="info">当前范围没有关联交易。</Alert>}{paging(data)}</>;
 return <Paper variant="outlined" sx={{p:{xs:2,md:3}}}><Stack spacing={2}>
  <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h6">{isCard?(id?'卡片详情':'我的卡片'):(id?'卡片交易详情':'卡片交易')}</Typography><Button onClick={()=>setReload(x=>x+1)}>刷新快照</Button></Stack>
  <Alert severity="info">已分配给本账户的测试快照，仅供查询。余额与资金操作尚未接入。</Alert>
  {id&&<Button sx={{alignSelf:'flex-start'}} component={Link} to={back}>返回{isCard?'卡片':'交易'}列表</Button>}
  {failure?<Alert severity="error" action={<Button onClick={()=>setReload(x=>x+1)}>重试</Button>}>{failure}</Alert>:connections===null?<CircularProgress size={24}/>:!connections.length?<Alert severity="info">尚未为本账户分配卡片测试数据。</Alert>:<>
   <TextField select size="small" label="数据来源" value={connection} onChange={e=>change({connection:e.target.value,page:'0'})}>{connections.map(c=><MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}</TextField>
   {!id&&<TextField size="small" label={isCard?'搜索卡名、尾号或卡片 ID':'搜索商户、尾号或交易 ID'} value={keyword} onChange={e=>change({keyword:e.target.value,page:'0'})}/>}
   {!result?<CircularProgress size={24}/>:<>
    <Typography variant="caption" color="text.secondary">来源：{time(result.sourceAt)} · 导入：{time(result.importedAt)}<br/>{result.coverageReason}</Typography>
    {isCard?<>{id?<Box>{result.rows.map(row=><Stack key={row.id} spacing={1}><Typography variant="h5">{row.cardName||row.name||'未命名卡片'} · {row.cardLast4||row.last4||'尾号未知'}</Typography><Typography>渠道状态：{row.cardStatus||'未知'}</Typography><Typography>创建时间：{time(row.createdAtUTC)}</Typography><Typography variant="caption">卡片 ID：{row.id}</Typography><Typography variant="h6" sx={{pt:2}}>关联交易</Typography>{cardTransactions&&txTable(cardTransactions)}</Stack>)}</Box>:<><TableContainer><Table size="small"><TableHead><TableRow>{['卡片','后四位','渠道状态','创建时间','操作'].map(x=><TableCell key={x}>{x}</TableCell>)}</TableRow></TableHead><TableBody>{result.rows.map(row=><TableRow key={row.id}><TableCell>{row.cardName||row.name||'未命名卡片'}</TableCell><TableCell>{row.cardLast4||row.last4||'未知'}</TableCell><TableCell>{row.cardStatus||'未知'}</TableCell><TableCell>{time(row.createdAtUTC)}</TableCell><TableCell><Button component={Link} to={link(`/portal/cards/${row.id}`)}>详情与交易</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>{!result.rows.length&&<Alert severity="info">当前筛选没有卡片。</Alert>}{paging(result)}</>}</>:id?<>{result.rows.map(row=><Stack key={row.id} spacing={1}><Stack direction="row" alignItems="center" spacing={1.5}><MerchantLogo name={row.merchant} size={56}/><Typography variant="h5" sx={{minWidth:0,overflowWrap:'anywhere'}}>{row.merchant||'未知商户'}</Typography></Stack><Typography>{snapshotAmount(row.amountCents)}</Typography><Typography>原币：{snapshotAmount(row.originalCurrency?.amountCents,row.originalCurrency?.code||'币种未知')}</Typography><Typography>入账状态：{row.status||'未知'} · 详细状态：{detailLabels[row.detailedStatus||'']||row.detailedStatus||'未知'}</Typography><Typography>授权时间：{time(row.authorizedAt)}</Typography><Typography>来源时间：{time(row.date)}</Typography><Typography variant="caption">交易 ID：{row.id}</Typography><Button component={Link} to={link(`/portal/cards/${row.cardId}`)}>所属卡片 · {row.cardName||row.cardLast4||row.cardId}</Button></Stack>)}</>:txTable(result)}
   </>}
  </>}
  {result&&(!isCard||Boolean(id&&cardTransactions))&&<LogoAttribution/>}
 </Stack></Paper>;
}

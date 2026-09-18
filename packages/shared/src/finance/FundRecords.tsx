import {useEffect,useState} from 'react';
import {Alert,Box,Button,Chip,LinearProgress,MenuItem,Paper,Stack,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,TextField,Typography} from '@mui/material';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {fundRecordsGet} from '../auth/fundRecordsApi';
import {fundRecordKinds,fundRecordStatuses,recordIdPattern,type FundRecord,type FundRecordsResult} from '../auth/fundRecordsContract';
import {cryptoMoney} from '../auth/cryptoContract';
import {SessionError} from '../auth/liveApi';

const directions:Record<string,string>={in:'转入',out:'转出',internal:'内部划转',exchange:'兑换'};
const postings:Record<string,string>={posted:'已入账',pending:'待入账',not_posted:'未入账',unknown:'待核实'};
const accounts:Record<string,string>={wallet:'钱包',card:'卡分户',escrow:'预占',transit:'在途',fee:'费用',clearing:'清算'};
const sourceNames:Record<string,string>={crypto:'钱包与卡片资金',manual:'人工出入金',issuing:'开卡订单',issuing_deposit:'开卡钱包入金'};
const date=(v:string)=>Number.isNaN(Date.parse(v))?'未提供':new Date(v).toISOString().replace('T',' ').slice(0,19);
const money=(v:string|null|undefined,c:string)=>v==null||!/^\d+$/.test(v)?'金额待核实':cryptoMoney(v,c);
function Status({value}:{value:string}){return <Chip size="small" variant="outlined" label={fundRecordStatuses[value]||'待确认'} color={value==='completed'?'success':['failed','rejected'].includes(value)?'error':['processing','unknown','pending_review'].includes(value)?'warning':'default'}/>}
function Amount({row}:{row:FundRecord}){return <Stack spacing={0.25} sx={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}><Typography variant="body2" fontWeight={600}>{row.kind==='otc'?'支付 ':''}{money(row.amountMinor,row.currency)}</Typography>{row.kind==='otc'&&<Typography variant="caption" color="text.secondary">收到 {money(row.receiveMinor,row.toCurrency||'')}</Typography>}</Stack>}
function errorText(e:unknown){const code=e instanceof SessionError?e.code:'';return ({invalid_query:'筛选条件无效，请检查日期或关联 ID。',not_found:'记录不存在或无权查看。',mfa_required:'请先完成运营安全验证。',unauthenticated:'登录已失效，请重新登录。',fund_records_unavailable:'资金记录暂不可用，请稍后重试。'} as Record<string,string>)[code]||'读取资金记录失败，请重试。'}
export default function FundRecords({admin=false,recordId}:{admin?:boolean;recordId?:string}){
 const base=admin?'/finance/fund-records':'/portal/fund-records',api=admin?'/admin-api/v1/fund-records':'/client-api/v1/fund-records';
 const navigate=useNavigate();const [params,setParams]=useSearchParams();const search=params.toString();
 const [draft,setDraft]=useState<Record<string,string>>(()=>Object.fromEntries(params)),[data,setData]=useState<FundRecordsResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[reload,setReload]=useState(0);
 useEffect(()=>{setDraft(Object.fromEntries(new URLSearchParams(search)))},[search]);
 useEffect(()=>{const abort=new AbortController();let active=true;setBusy(true);setError('');setData(null);
 if(recordId&&!recordIdPattern.test(recordId)){setBusy(false);setError('记录不存在或无权查看。');return}
 fundRecordsGet(api+(recordId?'/'+recordId:search?'?'+search:''),abort.signal).then(v=>{if(active)setData(v)}).catch(e=>{if(active)setError(errorText(e))}).finally(()=>{if(active)setBusy(false)});
 return()=>{active=false;abort.abort()};},[api,recordId,search,reload]);
 const update=(k:string,v:string)=>setDraft(d=>({...d,[k]:v}));
 const apply=()=>{if(draft.from&&draft.to&&Date.parse(draft.from)>=Date.parse(draft.to)){setError('结束日期必须晚于开始日期。');return}const q=new URLSearchParams();for(const k of ['kind','status','currency','from','to','cardId','q',...(admin?['customerId']:[])])if(draft[k]?.trim())q.set(k,draft[k].trim());setParams(q)};
 const pagination=(page:number)=>{const q=new URLSearchParams(params);if(page)q.set('page',String(page));else q.delete('page');setParams(q)};
 const detail=(r:FundRecord)=>base+'/'+r.id+(search?'?'+search:'');
 const select=(k:string,title:string,values:Record<string,string>)=><TextField select size="small" SelectProps={{displayEmpty:true}} InputLabelProps={{shrink:true}} label={title} value={draft[k]||''} onChange={e=>update(k,e.target.value)}><MenuItem value="">全部</MenuItem>{Object.entries(values).map(([v,l])=><MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>;
 const row=data?.record,page=Number(params.get('page')||0),hasFilters=[...params.keys()].some(k=>k!=='page');
 const field=(label:string,value:React.ReactNode)=><Box sx={{minWidth:0}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography component="div" variant="body2" sx={{mt:.5,overflowWrap:'anywhere'}}>{value||'未提供'}</Typography></Box>;
 return <Stack spacing={2.5} sx={{minWidth:0}}>
 <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}><Typography variant="h5">{recordId?'资金记录详情':'资金记录'}</Typography><Button disabled={busy} onClick={()=>setReload(x=>x+1)}>刷新</Button></Stack>
 {recordId?<Button component={Link} to={base+(search?'?'+search:'')} sx={{alignSelf:'flex-start'}}>返回资金记录</Button>:<Paper variant="outlined" component="form" onSubmit={e=>{e.preventDefault();apply()}} sx={{p:{xs:2,sm:2.5}}}>
 <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,minmax(0,1fr))',lg:'repeat(4,minmax(0,1fr))'},gap:2}}>
 {select('kind','业务类型',fundRecordKinds)}{select('status','处理状态',fundRecordStatuses)}{select('currency','币种',{USD:'USD',USDT:'USDT'})}
 <TextField size="small" label="关键词" placeholder="订单号 / 卡片后四位 / 地址 / 交易哈希" value={draft.q||''} onChange={e=>update('q',e.target.value)} inputProps={{maxLength:180}}/>
 {['from','to'].map(k=><TextField key={k} size="small" type="date" label={k==='from'?'开始日期（UTC，含）':'结束日期（UTC，不含）'} InputLabelProps={{shrink:true}} value={draft[k]?.slice(0,10)||''} onChange={e=>update(k,e.target.value?e.target.value+'T00:00:00Z':'')}/>)}
 <TextField size="small" label="关联卡片 ID" value={draft.cardId||''} onChange={e=>update('cardId',e.target.value)} helperText="卡片后四位可在关键词中搜索"/>
 {admin&&<TextField size="small" label="客户 ID" value={draft.customerId||''} onChange={e=>update('customerId',e.target.value)} helperText="仅查询有权查看的客户"/>}
 </Box><Stack direction="row" spacing={1} sx={{mt:2}}><Button type="submit" variant="contained" disabled={busy}>查询</Button><Button onClick={()=>{setDraft({});setParams({});setError('')}}>重置</Button></Stack></Paper>}
 {busy&&<LinearProgress aria-label="正在读取资金记录"/>}
 {error&&<Alert severity="error" action={<Button onClick={()=>setReload(x=>x+1)}>重试</Button>}>{error}</Alert>}
 {data?.mode==='shadow'&&<Alert severity="info">隔离测试记录，不代表真实资金。</Alert>}
 {!recordId&&data&&!busy&&!error&&<>
 <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={1}><Typography variant="body2" color="text.secondary">共 {data.total} 条 · 时间按 UTC</Typography><Typography variant="caption" color="text.secondary">包含未完成业务；内部划转不计作外部收支</Typography></Stack>
 <Paper variant="outlined" sx={{overflow:'hidden'}}><TableContainer tabIndex={0} aria-label="资金记录，可横向滚动"><Table sx={{minWidth:admin?1040:900}}><TableHead><TableRow>{['时间',...(admin?['客户']:[]),'业务类型','订单 / 卡片','金额','方向','状态',''].map((x,i)=><TableCell key={i}>{x}</TableCell>)}</TableRow></TableHead><TableBody>{data.records.map(r=><TableRow key={r.id} hover onClick={()=>navigate(detail(r))} sx={{cursor:'pointer'}}>
 <TableCell sx={{whiteSpace:'nowrap'}}>{date(r.createdAt)}</TableCell>{admin&&<TableCell>{r.customerName||r.customerId}</TableCell>}<TableCell sx={{whiteSpace:'nowrap'}}>{fundRecordKinds[r.kind]||'其他资金记录'}</TableCell><TableCell sx={{maxWidth:220,overflowWrap:'anywhere'}}><Typography variant="body2">{r.orderId}</Typography>{r.last4&&<Typography variant="caption" color="text.secondary">卡片 ···· {r.last4}</Typography>}</TableCell><TableCell><Amount row={r}/></TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{directions[r.direction]||'待核实'}</TableCell><TableCell><Status value={r.status}/></TableCell><TableCell><Button component={Link} to={detail(r)} onClick={e=>e.stopPropagation()} aria-label={`查看${fundRecordKinds[r.kind]||'资金记录'}详情`}>详情</Button></TableCell>
 </TableRow>)}</TableBody></Table></TableContainer>{!data.records.length&&<Stack alignItems="center" spacing={1} sx={{py:7,px:2}}><Typography role="status">{hasFilters?'没有符合筛选条件的记录':'暂无资金记录'}</Typography><Typography variant="body2" color="text.secondary">{hasFilters?'调整筛选条件后重新查询。':'充值、提现、开卡等业务记录将在这里展示。'}</Typography></Stack>}</Paper>
 <Stack direction="row" justifyContent="space-between" alignItems="center"><Button disabled={page<=0} onClick={()=>pagination(page-1)}>上一页</Button><Typography variant="body2">第 {page+1} 页</Typography><Button disabled={(page+1)*20>=data.total} onClick={()=>pagination(page+1)}>下一页</Button></Stack>
 <Typography variant="caption" color="text.secondary">{data.coverage}</Typography></>}
 {recordId&&row&&!busy&&!error&&<>
 <Paper variant="outlined" sx={{p:{xs:2,sm:3}}}><Stack spacing={2.5}><Stack direction="row" justifyContent="space-between" gap={2}><Box><Typography variant="h6">{fundRecordKinds[row.kind]||'资金记录'}</Typography><Box sx={{mt:1}}><Amount row={row}/></Box></Box><Status value={row.status}/></Stack>
 <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,minmax(0,1fr))'},gap:2.5}}>
 {field('订单号',row.orderId)}{admin&&field('客户',row.customerName||row.customerId)}{field('业务来源',sourceNames[row.source])}{field('资金账户',row.fundingSource==='issuing_wallet'?'开卡专用钱包':'资金钱包')}{field('资金方向',directions[row.direction])}{field('入账状态',postings[row.postingStatus]||'待核实')}{field('创建时间（UTC）',date(row.createdAt))}{field('更新时间（UTC）',date(row.updatedAt))}{row.cardId&&field('关联卡片',row.last4?'···· '+row.last4:row.cardId)}{row.network&&field('网络',row.network)}{row.address&&field('地址',row.address)}{row.txHash&&field('交易哈希',row.txHash)}
 </Box>{row.cardId&&<Button component={Link} to={base+'?'+new URLSearchParams({cardId:row.cardId,...(admin?{customerId:row.customerId}:{})})} sx={{alignSelf:'flex-start'}}>查看此卡资金记录</Button>}{row.originalId&&<Button component={Link} to={base+'/'+row.originalId+(search?'?'+search:'')} sx={{alignSelf:'flex-start'}}>查看原资金记录</Button>}
 <Button component={Link} to={base+'?'+new URLSearchParams({q:row.orderId,...(admin?{customerId:row.customerId}:{})})} sx={{alignSelf:'flex-start'}}>查看同一订单的资金记录</Button>
 <Typography variant="body2" color="text.secondary">处理状态与入账状态分别显示；预占、释放不代表实际收支。</Typography></Stack></Paper>
 <Paper variant="outlined" sx={{p:{xs:2,sm:3}}}><Typography variant="h6" sx={{mb:2}}>资金处理明细</Typography>{data?.evidence?.length?<Stack spacing={2}>{data.evidence.map(e=><Stack key={e.id} direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={.5}><Box><Typography variant="body2">{accounts[e.from]||'资金账户'} → {accounts[e.to]||'资金账户'} · {money(e.amountMinor,e.currency)}</Typography><Typography variant="caption" color="text.secondary">{date(e.createdAt)} UTC</Typography></Box><Typography variant="body2">{e.state==='applied'?'已记账':e.state==='rejected'?'未执行':e.state==='released'?'已释放':'待确认'}</Typography></Stack>)}</Stack>:<Typography variant="body2" color="text.secondary">当前没有可展示的资金处理明细，不能据此推断已入账。</Typography>}</Paper>
 </>}
 </Stack>
}

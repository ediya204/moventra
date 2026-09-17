import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Chip,FormControl,InputLabel,MenuItem,Paper,Select,Stack,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,TextField,Typography} from '@mui/material';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {useAuth} from '../auth/AuthContext';
import {authMessage,fundsCommand,liveGet,SessionError} from '../auth/liveApi';
import {fundsAmount,parseFundsAmount,type FundsCommand} from '../auth/fundsContract';
type Quote={id:string;currency:string;toCurrency:string;amountMinor:string;feeMinor:string;receiveMinor:string;expiresAt:string};
type Order={id:string;kind:string;currency:string;toCurrency:string;amountMinor:string;feeMinor:string;receiveMinor:string;recipientLabel:string;status:string;revision:number;createdAt:string};
type Snapshot={enabled:boolean;canOperate:boolean;balances:{currency:string;postedMinor:string;heldMinor:string;availableMinor:string}[];orders:Order[];total:number};
type Detail={order:Order;events:{action:string;status:string;note:string;revision:number;createdAt:string}[]};
type Pending={id:string;input:FundsCommand};
const labels:Record<string,string>={deposit:'充值',exchange:'兑换',withdraw:'提现',pending:'等待确认',confirming:'确认中',pending_review:'待审核',processing:'处理中',unknown:'结果待核实',completed:'已完成',cancelled:'已取消',rejected:'已拒绝',failed:'失败',detect:'确认收到测试充值',approve:'审核通过',reject:'拒绝',complete:'确认模拟结算',fail:'确认失败并释放预占',cancel:'取消申请'};
const errors:Record<string,string>={insufficient_test_balance:'可用测试余额不足。',quote_expired:'报价已过期，请重新获取。',quote_used:'该报价已经使用，请查看交易记录。',order_changed:'订单已更新，请刷新后重新操作。',funds_not_active:'开户审批和服务启用完成后才可操作。',test_wallet_not_enabled:'此账户尚未启用线上测试资金。',invalid_funds_transition:'当前订单状态不允许此操作，请刷新。',amount_too_small:'金额过小，扣除费用后不足以兑换。',idempotency_conflict:'请求内容发生冲突，请保留订单号并联系管理员。'};
const tabs=[['','总览'],['/deposit','USDT 充值'],['/fiat-deposit','法币充值'],['/exchange','USDT / USD 兑换'],['/withdraw','提现'],['/history','交易记录']];
function actions(o:Order,admin:boolean){
 if(!admin)return o.status==='pending'&&o.kind==='deposit'||o.status==='pending_review'&&o.kind==='withdraw'?['cancel']:[];
 if(o.kind==='deposit')return o.status==='pending'?['detect','reject']:o.status==='confirming'?['complete','fail']:[];
 if(o.kind==='withdraw')return o.status==='pending_review'?['approve','reject']:o.status==='processing'?['unknown','complete','fail']:o.status==='unknown'?['complete','fail']:[];
 return [];
}
export default function OnlineFunds({customerId,admin=false,reload=0}:{customerId:string;admin?:boolean;reload?:number}){
 const {session}=useAuth();const {pathname,search,state:locationState}=useLocation();const navigate=useNavigate();
 const base=admin?`/finance/test-funds/${customerId}`:'/portal/funds';
 const endpoint=`/${admin?'admin':'client'}-api/v1/customers/${customerId}/test-funds`;
 const section=pathname.slice(base.length);const orderId=section.startsWith('/orders/')?section.slice(8):'';
 const storageKey=`moventra:test-funds:${session?.id}:${customerId}:${admin}`;
 const [pending,setPending]=useState<Pending|null>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{return null;}});
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[detail,setDetail]=useState<Detail|null>(null);
 const [error,setError]=useState(''),[success,setSuccess]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(0);
 const [currency,setCurrency]=useState('USDT'),[value,setValue]=useState(''),[recipient,setRecipient]=useState(''),[note,setNote]=useState(''),[quote,setQuote]=useState<Quote|null>(null),[now,setNow]=useState(Date.now());
 const inFlight=useRef(false);const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const params=new URLSearchParams(search);const kind=params.get('kind')||'',status=params.get('status')||'';const page=Math.max(0,Number(params.get('page')||0)||0);
 useEffect(()=>{setQuote(null);setValue('');setError('');setSuccess('');},[section]);
 useEffect(()=>{let active=true;setSnapshot(null);setDetail(null);
 Promise.all([liveGet<Snapshot>(`${endpoint}?kind=${encodeURIComponent(kind)}&status=${encodeURIComponent(status)}&page=${page}`),orderId?liveGet<Detail>(`${endpoint}/orders/${orderId}`):Promise.resolve(null)]).then(([s,d])=>{if(active){setSnapshot(s);setDetail(d);}}).catch(e=>{if(active)setError(authMessage(e));});
 return()=>{active=false;};},[endpoint,kind,status,page,orderId,reload,tick]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 async function run(input:FundsCommand, retry?:Pending){
 if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setSuccess('');
 const request=retry||{id:crypto.randomUUID(),input};
 try{
 // Persist before the request; an uncertain result must be retried with the same key.
 sessionStorage.setItem(storageKey,JSON.stringify(request));setPending(request);
 const result=await fundsCommand<{order?:Order;quote?:Quote}>(`${endpoint}/commands`,request.input,request.id);
 sessionStorage.removeItem(storageKey);if(!mounted.current)return;setPending(null);setTick(v=>v+1);
 if(result.quote){setQuote(result.quote);setSuccess('服务端测试报价已生成。');}
 if(result.order){setQuote(null);setSuccess('操作已保存。');navigate(`${base}/orders/${result.order.id}`);}
 }catch(e){if(!mounted.current)return;
 // 5xx, invalid responses and network errors are ambiguous; preserve the key.
 if(e instanceof SessionError&&e.status>=400&&e.status<500&&e.code!=='invalid_api_response'){
 sessionStorage.removeItem(storageKey);setPending(null);setError(errors[e.code]||authMessage(e));setTick(v=>v+1);
 }else setError('尚未确认请求结果。请点击“核对并重试原请求”，避免重复提交。');
 }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 function submit(action:string){try{void run({action,currency:section==='/fiat-deposit'?'USD':section==='/deposit'?'USDT':currency,amountMinor:parseFundsAmount(value,section==='/fiat-deposit'?'USD':section==='/deposit'?'USDT':currency),...(action==='withdraw'?{recipientLabel:recipient}:{}),note});}catch(e){setError((e as Error).message);}}
 const blocked=busy||!!pending;const form= ['/deposit','/fiat-deposit','/exchange','/withdraw'].includes(section);
 const o=detail?.order;
 function filter(k:string,v:string){const q=new URLSearchParams(search);q.set(k,v);if(k!=='page')q.delete('page');navigate(`${pathname}?${q}`);}
 return <Stack spacing={3}>
 <Alert severity="info">线上测试资金 · 充值、兑换和提现均为模拟记账，不接收真实资金、不发送真实付款。USD 与 USDT 测试资产独立记录。</Alert>
 <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{(admin?[['','审核与记录']]:tabs).map(([path,label])=><Button key={path} component={Link} to={base+path} variant={section===path?'contained':'outlined'}>{label}</Button>)}<Button disabled={busy} onClick={()=>{setError('');setTick(v=>v+1);}}>刷新资金与订单</Button></Stack>
 {error&&<Alert severity="error">{error}</Alert>}{success&&<Alert severity="success">{success}</Alert>}
 {pending&&<Alert severity="warning" action={<Button disabled={busy} onClick={()=>void run(pending.input,pending)}>核对并重试原请求</Button>}>有一笔尚未确认结果的请求。编号：{pending.id}</Alert>}
 {!snapshot&&!error&&<Typography role="status">正在加载资金与订单…</Typography>}
 {snapshot&&!snapshot.enabled&&<Alert severity="warning">账户尚未启用线上测试资金，请联系运营人员。</Alert>}
 {snapshot?.enabled&&<>
 <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'1fr 1fr'},gap:2}}>{snapshot.balances.map(b=><Paper key={b.currency} variant="outlined" sx={{p:3}}><Typography color="text.secondary">{b.currency} 可用测试余额</Typography><Typography variant="h4" sx={{my:1,overflowWrap:'anywhere'}}>{fundsAmount(b.availableMinor,b.currency)}</Typography><Typography variant="body2">预占 {fundsAmount(b.heldMinor,b.currency)}</Typography><Typography variant="body2" color="text.secondary">账面 {fundsAmount(b.postedMinor,b.currency)}</Typography></Paper>)}</Box>
 {!snapshot.canOperate&&!admin&&<Alert severity="warning">当前开户或服务状态不允许新建资金操作。已有订单仍可查询，待处理申请可按状态取消。</Alert>}
 {form&&!admin&&<Paper variant="outlined" sx={{p:3}}><Stack spacing={2} sx={{maxWidth:640}}>
 <Typography variant="h5">{tabs.find(([p])=>p===section)?.[1]}</Typography>
 <Typography color="text.secondary">{section==='/exchange'?'固定测试汇率：1 USDT = 0.99 USD；兑换费 0.5%，源币种向上取整，到账金额向下取整。报价有效期 60 秒。':section==='/withdraw'?'提交后预占金额与费用，运营审核后模拟处理。USDT 测试提现费 2 USDT，USD 测试提现费 0。':'提交测试充值申请，运营确认后计入测试余额。无需转账，也不生成真实收款地址。'}</Typography>
 {(section==='/exchange'||section==='/withdraw')&&<FormControl><InputLabel id="funds-currency">{section==='/exchange'?'转出币种':'提现币种'}</InputLabel><Select labelId="funds-currency" label={section==='/exchange'?'转出币种':'提现币种'} value={currency} disabled={blocked} onChange={e=>{setCurrency(e.target.value);setQuote(null);}}><MenuItem value="USDT">USDT</MenuItem><MenuItem value="USD">USD</MenuItem></Select></FormControl>}
 <TextField label="金额" value={value} inputProps={{inputMode:'decimal'}} disabled={blocked} onChange={e=>{setValue(e.target.value);setQuote(null);}}/>
 {section==='/withdraw'&&<TextField label="模拟收款方名称" helperText="仅填写测试名称，无需真实地址或银行信息。" value={recipient} disabled={blocked} inputProps={{maxLength:120}} onChange={e=>setRecipient(e.target.value)}/>}
 <TextField label="备注（可选）" value={note} disabled={blocked} inputProps={{maxLength:500}} onChange={e=>setNote(e.target.value)}/>
 <Button variant="contained" disabled={blocked||!snapshot.canOperate||!value||section==='/withdraw'&&!recipient.trim()} onClick={()=>submit(section==='/exchange'?'quote':section==='/withdraw'?'withdraw':'deposit')}>{section==='/exchange'?'获取测试报价':section==='/withdraw'?'提交测试提现':'提交测试充值'}</Button>
 {quote&&section==='/exchange'&&<Alert severity={Date.parse(quote.expiresAt)<=now?'warning':'info'}><Stack spacing={1}><Typography>扣除 {fundsAmount(quote.amountMinor,quote.currency)}（含费用 {fundsAmount(quote.feeMinor,quote.currency)}）</Typography><Typography>到账 {fundsAmount(quote.receiveMinor,quote.toCurrency)}</Typography><Typography>剩余 {Math.max(0,Math.ceil((Date.parse(quote.expiresAt)-now)/1000))} 秒</Typography><Button disabled={blocked||Date.parse(quote.expiresAt)<=now||!snapshot.canOperate} onClick={()=>void run({action:'exchange',quoteId:quote.id,note})}>确认测试兑换</Button></Stack></Alert>}
 </Stack></Paper>}
 {o&&<Paper variant="outlined" sx={{p:3}}><Stack spacing={2}>
 <Button component={Link} to={typeof locationState?.fundsReturn==='string'&&locationState.fundsReturn.startsWith(base+'?')?locationState.fundsReturn:typeof locationState?.fundsReturn==='string'&&locationState.fundsReturn.startsWith(base+'/history')?locationState.fundsReturn:`${base}/history`} sx={{alignSelf:'start'}}>返回交易记录</Button>
 <Typography variant="h5">{labels[o.kind]}详情 <Chip label={labels[o.status]||o.status}/></Typography><Typography sx={{overflowWrap:'anywhere'}}>订单：{o.id}</Typography>
 <Typography>申请金额：{fundsAmount(o.amountMinor,o.currency)} · 费用：{fundsAmount(o.feeMinor,o.currency)}</Typography><Typography>模拟到账：{fundsAmount(o.receiveMinor,o.toCurrency)}</Typography>
 {o.kind==='exchange'&&<Typography color="text.secondary">兑换费用已包含在转出金额中。</Typography>}{o.recipientLabel&&<Typography>模拟收款方：{o.recipientLabel}</Typography>}
 {o.status==='unknown'&&<Alert severity="warning">结果待核实，资金继续预占。确认模拟成功或失败后才会结算或释放。</Alert>}
 {admin&&actions(o,admin).length>0&&<TextField label="处理说明（必填）" value={note} inputProps={{maxLength:500}} disabled={blocked} onChange={e=>setNote(e.target.value)}/>}
 <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">{actions(o,admin).map(action=><Button key={action} variant="outlined" disabled={blocked||admin&&!note.trim()} onClick={()=>void run({action,orderId:o.id,revision:o.revision,note})}>{labels[action]||action}</Button>)}</Stack>
 <Typography variant="h6">处理记录</Typography>{detail.events.map(e=><Box key={e.revision} sx={{borderLeft:2,borderColor:'divider',pl:2}}><Typography>{labels[e.status]||e.status} · {new Date(e.createdAt).toLocaleString()}</Typography><Typography color="text.secondary">{e.note||labels[e.action]||e.action}</Typography></Box>)}
 </Stack></Paper>}
 {!orderId&&<Paper variant="outlined" sx={{p:3}}><Stack spacing={2}><Typography variant="h5">{admin?'测试资金审核':'交易记录'}</Typography>
 <Stack direction={{xs:'column',sm:'row'}} spacing={2}><TextField select label="类型" value={kind} onChange={e=>filter('kind',e.target.value)} sx={{minWidth:160}}><MenuItem value="">全部</MenuItem>{['deposit','exchange','withdraw'].map(k=><MenuItem key={k} value={k}>{labels[k]}</MenuItem>)}</TextField><TextField select label="状态" value={status} onChange={e=>filter('status',e.target.value)} sx={{minWidth:160}}><MenuItem value="">全部</MenuItem>{['pending','confirming','pending_review','processing','unknown','completed','cancelled','rejected','failed'].map(k=><MenuItem key={k} value={k}>{labels[k]}</MenuItem>)}</TextField></Stack>
 <TableContainer><Table size="small"><TableHead><TableRow>{['时间','类型','金额','状态','操作'].map(v=><TableCell key={v}>{v}</TableCell>)}</TableRow></TableHead><TableBody>{snapshot.orders.map(row=><TableRow key={row.id}><TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell><TableCell>{labels[row.kind]}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{fundsAmount(row.amountMinor,row.currency)}</TableCell><TableCell>{labels[row.status]}</TableCell><TableCell><Button component={Link} to={`${base}/orders/${row.id}`} state={{fundsReturn:pathname+search}}>详情</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>
 {!snapshot.orders.length&&<Typography color="text.secondary">暂无符合条件的测试订单。</Typography>}
 <Stack direction="row" spacing={2} alignItems="center"><Button disabled={page<=0} onClick={()=>filter('page',String(page-1))}>上一页</Button><Typography>第 {page+1} 页 · 共 {snapshot.total} 笔</Typography><Button disabled={(page+1)*20>=snapshot.total||page>=500} onClick={()=>filter('page',String(page+1))}>下一页</Button></Stack>
 </Stack></Paper>}
 </>}
 </Stack>;
}

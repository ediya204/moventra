import {useEffect,useState,type ReactNode} from 'react';
import {Alert,Box,Button,Paper,Stack,Typography} from '@mui/material';
import {CurrencyLogo} from '../../../../packages/shared/src/finance/CustomerFunds';
import {Link} from 'react-router-dom';
import {cryptoRequest,cryptoError} from '../../../../packages/shared/src/auth/cryptoApi';
import {cryptoMoney,type CryptoSnapshot} from '../../../../packages/shared/src/auth/cryptoContract';

const labels:Record<string,string>={deposit:'充值',withdrawal:'提款',otc:'OTC 兑换',card_transfer:'卡片充提',completed:'已完成',posted:'已入账',pending_review:'待审核',processing:'处理中',reserving:'预占中',releasing:'释放中',failed:'失败',rejected:'已拒绝',unknown:'待核实',cancelled:'已取消'};
function WalletSectionIcon({kind}:{kind:'wallet'|'history'}){
 return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{flexShrink:0,color:'var(--palette-primary-main, #2065d1)'}}>{kind==='wallet'?<><path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7"/><path d="M21 12h-5v5h5M17.5 14.5h.01"/></>:<><path d="M4 8a9 9 0 1 1-1 7M4 3v5h5"/><path d="M12 7v5l3 2"/></>}</svg>;
}
export default function ProductionWallet({customerId,reload=0,showWallet=true,children}:{customerId:string;reload?:number;showWallet?:boolean;children?:ReactNode}){
 const [data,setData]=useState<CryptoSnapshot|null>(null),[error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true,running=false;setData(null);setError('');
  const load=async()=>{if(running)return;running=true;try{
   const value=await cryptoRequest<CryptoSnapshot>(`/client-api/v1/customers/${customerId}/crypto?limit=5`);
   if(value.customerId!==customerId||value.mode!=='live'||value.orders.some(o=>o.customerId!==customerId))throw new Error('正式资金信息暂不可用');
   if(active){setData(value);setError('')}
  }catch(e){if(active){setData(null);setError(cryptoError(e))}}finally{running=false}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load()},15000);
  return()=>{active=false;clearInterval(timer)};
 },[customerId,reload,retry]);
 function balance(currency:'USD'|'USDT'){
  if(!data)return '正在读取…';
  const accounts=data.ledger.accounts.filter(a=>a.kind==='wallet'&&a.currency===currency);
  if(!accounts.length)return '尚未开通';
  if(data.ledger.reconciliation!=='matched')return '余额核对中';
  return cryptoMoney(accounts.reduce((v,a)=>v+BigInt(a.ledgerAvailableMinor),0n).toString(),currency);
 }
 const attention=data?.orders.filter(o=>['unknown','failed','rejected'].includes(o.state))||[];
 const flowIcon=(kind:string)=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={kind==='otc'?'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4':kind==='deposit'?'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5':kind==='withdrawal'?'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5':'M3 6h18v12H3zM3 10h18M7 14h4'}/></svg>;
 return <Stack spacing={3} sx={{minWidth:0}}>
  {showWallet&&<Paper variant="outlined" component="section" aria-label="我的钱包" sx={{p:{xs:2.5,md:3},minWidth:0}}>
   <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{mb:1.5}}><Typography variant="h6" component="h2" sx={{display:'flex',alignItems:'center',gap:1}}><WalletSectionIcon kind="wallet"/>我的钱包</Typography><Button component={Link} to="/portal/funds">管理资金 →</Button></Stack>
   {error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>正式资金暂不可用：{error}</Alert>:<Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:3}}>{(['USD','USDT'] as const).map(currency=><Box key={currency} sx={{minWidth:0,display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',sm:'auto minmax(0,1fr)'},columnGap:2,alignItems:'center',...(currency==='USDT'?{borderLeft:{sm:'1px solid #e7ebf0'},pl:{sm:3}}:{})}}><Stack direction="row" gap={1.25} alignItems="center"><CurrencyLogo currency={currency}/><Box><Typography variant="subtitle2">{currency==='USD'?'美元钱包':'USDT 钱包'}</Typography><Typography variant="caption" color="text.secondary">可用余额</Typography></Box></Stack><Typography sx={{textAlign:{xs:'left',sm:'right'},mt:{xs:.75,sm:0},fontSize:'clamp(1.2rem, 1.65vw, 1.65rem)',fontWeight:700,fontVariantNumeric:'tabular-nums',letterSpacing:'-.025em',overflowWrap:'anywhere'}}>{balance(currency)}</Typography><Typography variant="caption" color="text.secondary" sx={{gridColumn:'1 / -1',mt:.5}}>{currency==='USD'?'用于美元业务结算':'充值后可按报价兑换为 USD'}</Typography></Box>)}</Box>}
   <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:1.5,pt:1.5,borderTop:1,borderColor:'divider'}}>钱包可用余额不含卡片额度、预占与在途资金。</Typography>
  </Paper>}
  {children}
  <Paper variant="outlined" component="section" aria-label="最近资金交易" sx={{p:{xs:2.5,md:3},minWidth:0}}>
   <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="h6" component="h2" sx={{display:'flex',alignItems:'center',gap:1}}><WalletSectionIcon kind="history"/>最近资金交易</Typography><Button component={Link} to="/portal/funds/history">查看全部 →</Button></Stack>
   <Typography variant="body2" color="text.secondary" sx={{mt:.5,mb:2}}>最近 5 笔充值、兑换与资金划转</Typography>
   {attention.length>0&&<Alert severity="warning" sx={{mb:2}} action={<Button component={Link} to={`/portal/funds/orders/${attention[0].id}`}>查看详情</Button>}>最近记录中有 {attention.length} 笔需要关注，请查看处理结果。</Alert>}
   {!showWallet&&error&&<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>}
   {!data?<Typography role="status">{error?'资金交易暂不可用，请重试。':'正在读取资金交易…'}</Typography>:<>
    {data.orders.map(order=><Box key={order.id} sx={{display:'grid',gridTemplateColumns:'36px minmax(0,1fr) auto',columnGap:1.5,py:2,borderBottom:1,borderColor:'divider',alignItems:'center'}}>
     <Box sx={{color:order.kind==='deposit'?'success.main':'primary.main',display:'flex',alignSelf:'start',pt:.5}}>{flowIcon(order.kind)}</Box>
     <Box sx={{minWidth:0}}><Typography variant="subtitle2">{labels[order.kind]||order.kind}</Typography><Typography variant="caption" color="text.secondary">{new Date(order.createdAt).toLocaleString('zh-CN')}</Typography><Typography variant="body2" sx={{mt:.5,color:['unknown','failed','rejected'].includes(order.state)?'warning.dark':['completed','posted'].includes(order.state)?'success.dark':'text.secondary'}}>{labels[order.state]||order.state}</Typography></Box>
     <Stack alignItems="flex-end" sx={{maxWidth:{xs:145,sm:240}}}><Typography variant="subtitle2" sx={{fontVariantNumeric:'tabular-nums',overflowWrap:'anywhere',textAlign:'right'}}>{cryptoMoney(order.amountMinor,order.currency)}</Typography><Button component={Link} size="small" aria-label={`查看${labels[order.kind]||order.kind}详情`} to={`/portal/funds/orders/${order.id}`}>详情</Button></Stack>
    </Box>)}
    {!data.orders.length&&<Box sx={{py:3}}><Typography role="status">暂无正式资金订单。</Typography><Typography variant="body2" color="text.secondary" sx={{mt:1}}>完成充值或兑换后，可在这里追踪进度与结果。</Typography><Button component={Link} to="/portal/funds" sx={{mt:1}}>了解资金服务 →</Button></Box>}
   </>}
   <Button component={Link} to="/portal/transactions" sx={{mt:2}}>查找卡片消费与退款 →</Button>
  </Paper>
 </Stack>;
}

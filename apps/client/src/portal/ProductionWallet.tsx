import {useEffect,useState} from 'react';
import {Alert,Box,Button,Paper,Stack,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,Typography} from '@mui/material';
import {Link} from 'react-router-dom';
import {cryptoRequest,cryptoError} from '../../../../packages/shared/src/auth/cryptoApi';
import {cryptoMoney,type CryptoSnapshot} from '../../../../packages/shared/src/auth/cryptoContract';

const labels:Record<string,string>={deposit:'充值',withdrawal:'提款',otc:'OTC 兑换',card_transfer:'卡片充提',completed:'已完成',posted:'已入账',pending_review:'待审核',processing:'处理中',reserving:'预占中',releasing:'释放中',failed:'失败',rejected:'已拒绝',unknown:'待核实',cancelled:'已取消'};
export default function ProductionWallet({customerId,reload=0,showWallet=true}:{customerId:string;reload?:number;showWallet?:boolean}){
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
 return <Stack spacing={3}>
  {showWallet&&<Paper variant="outlined" sx={{p:{xs:2,md:3},minWidth:0}}><Stack spacing={2}>
   <Stack direction="row" justifyContent="space-between"><Typography variant="h6">我的钱包</Typography><Button component={Link} to="/portal/funds">资金中心</Button></Stack>
   {error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>正式资金暂不可用：{error}</Alert>:<Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:2}}>{(['USD','USDT'] as const).map(currency=><Box key={currency}><Typography color="text.secondary">{currency} 钱包余额</Typography><Typography variant="h4" sx={{overflowWrap:'anywhere'}}>{balance(currency)}</Typography></Box>)}</Box>}
   <Typography variant="body2" color="text.secondary">与资金中心使用同一正式钱包；卡片资金、在途及预占不重复计入钱包余额。</Typography>
  </Stack></Paper>}
  <Paper variant="outlined" sx={{p:{xs:2,md:3},minWidth:0}}><Stack spacing={2}>
   <Stack direction="row" justifyContent="space-between"><Typography variant="h6">最近资金交易</Typography><Button component={Link} to="/portal/funds/history">查看全部</Button></Stack>
   <Typography variant="body2" color="text.secondary">最近 5 笔充值、兑换、提款及卡片充提。卡片消费与退款请在交易与账单中查询。</Typography>
   {!showWallet&&error&&<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>}
   {!data?<Typography>{error?'资金交易暂不可用，请重试。':'正在读取资金交易…'}</Typography>:<>
    <Stack spacing={2} sx={{display:{xs:"flex",sm:"none"}}}>{data.orders.map(order=><Box key={order.id} sx={{py:1.5,borderBottom:1,borderColor:"divider"}}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="subtitle2">{labels[order.kind]||order.kind}</Typography><Typography variant="subtitle2">{cryptoMoney(order.amountMinor,order.currency)}</Typography></Stack><Typography variant="caption" color="text.secondary">{new Date(order.createdAt).toLocaleString("zh-CN")}</Typography><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="body2">{labels[order.state]||order.state}</Typography><Button component={Link} to={`/portal/funds/orders/${order.id}`}>详情</Button></Stack></Box>)}</Stack><TableContainer sx={{display:{xs:"none",sm:"block"}}} tabIndex={0} aria-label="最近资金交易，可横向滚动"><Table size="small" sx={{minWidth:600}}><TableHead><TableRow>{['时间','类型','金额','状态','操作'].map(v=><TableCell key={v}>{v}</TableCell>)}</TableRow></TableHead><TableBody>{data.orders.map(order=><TableRow key={order.id}>
     <TableCell>{new Date(order.createdAt).toLocaleString('zh-CN')}</TableCell><TableCell>{labels[order.kind]||order.kind}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{cryptoMoney(order.amountMinor,order.currency)}</TableCell><TableCell>{labels[order.state]||order.state}</TableCell><TableCell><Button component={Link} to={`/portal/funds/orders/${order.id}`}>详情</Button></TableCell>
    </TableRow>)}</TableBody></Table></TableContainer>
    {!data.orders.length&&<Typography role="status" color="text.secondary" sx={{py:3,textAlign:"center"}}>暂无正式资金订单。</Typography>}
   </>}
  </Stack></Paper>
 </Stack>;
}

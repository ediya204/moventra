import FundsNavigation from './FundsNavigation';
import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,MenuItem,Paper,Stack,TextField,Typography} from '@mui/material';
import {Link,useLocation} from 'react-router-dom';
import {QRCodeSVG} from 'qrcode.react';
import {cryptoRequest,cryptoError} from '../auth/cryptoApi';
type Event={id:string;amount:string;txHash:string;providerStatus:string;receivedAt:string;state:string;posting:string;error?:string;orderId?:string};
type Snapshot={address:{network:string;address:string;state:string};events:Event[];postingEnabled:boolean;mode:'observation'|'deposit_pilot'|'production';pilot?:{capMinor?:string;remainingMinor?:string;walletMinor?:string;reconciliation?:string}};
const usdt=(minor:string)=>{const n=BigInt(minor);return `${n/1000000n}.${(n%1000000n).toString().padStart(6,'0')}`};
export default function DepositAddress({customerId,basePath}:{customerId:string;basePath:string}){
 const [network,setNetwork]=useState('TRC20'),[data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false),[tick,setTick]=useState(0);
 const location=useLocation(),params=new URLSearchParams(location.search),event=params.get('event')||'',page=Math.max(0,Number(params.get('page'))||0);
 const requested=useRef(new Set<string>());const endpoint=`/client-api/v1/customers/${customerId}/deposit-addresses`;const query=event?'?event='+encodeURIComponent(event):page?'?page='+page:'';
 useEffect(()=>{let active=true,running=false;setData(null);setError('');setCopied(false);
  if(network!=='TRC20')return;
  const load=async()=>{if(running)return;running=true;try{let v=await cryptoRequest<Snapshot>(endpoint+query);if(active&&!event&&page===0&&v.address.state==='not_created'&&!requested.current.has(endpoint)){requested.current.add(endpoint);v=await cryptoRequest<Snapshot>(endpoint,{network:'TRC20'},crypto.randomUUID())}if(active){setData(v);setError('')}}catch(e){if(active)setError(cryptoError(e))}finally{running=false}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load()},5000);return()=>{active=false;clearInterval(timer)};
 },[endpoint,query,network,tick,event,page]);
 const address=network==='TRC20'&&data?.address.state==='completed'?data.address.address:'';
 return <Stack spacing={3}>
  <FundsNavigation basePath={basePath} section="deposit" onRefresh={()=>setTick(x=>x+1)}/>
  <Paper variant="outlined" sx={{p:{xs:2,md:3},maxWidth:920}}><Stack spacing={3}>
   <Box><Typography variant="h6">USDT 充值</Typography><Typography variant="body2" color="text.secondary" sx={{mt:.5}}>选择网络，复制专属地址后从外部钱包转入。</Typography></Box>
   {data && (data.postingEnabled?<Alert severity="info">{data.mode==='production'?'TRC20 正式充值已开通。链上最终确认且记账完成后自动到账。':`TRC20 充值已开通，当前剩余额度 ${usdt(data.pilot?.remainingMinor||'0')} USDT。仅在链上最终确认且记账完成后到账，请勿超额转入。`}</Alert>:<Alert severity="info">{data.mode==='production'?'充值核验服务正在恢复，请稍后刷新查看。':data.mode==='deposit_pilot'?'当前暂不接收新的转入，请等待核验或额度确认。':'当前提供地址及渠道记录查询。到账核验与自动入账尚未启用，请勿转入资金。'}</Alert>)}
   {data?.pilot?.walletMinor!==undefined&&<Typography>USDT 钱包已入账余额：{usdt(data.pilot.walletMinor)} USDT</Typography>}
   <Stack direction={{xs:'column',sm:'row'}} spacing={2}><TextField label="币种" value="USDT" disabled fullWidth/><TextField select label="网络" value={network} onChange={e=>{setData(null);setCopied(false);setNetwork(e.target.value)}} fullWidth><MenuItem value="TRC20">TRON · TRC20</MenuItem><MenuItem value="ERC20">Ethereum · ERC20（尚未开通）</MenuItem></TextField></Stack>
   {error&&<Alert severity="error" action={<Button onClick={()=>setTick(x=>x+1)}>重试</Button>}>{error}</Alert>}
   {network==='ERC20'?<Alert severity="info">该网络尚未开通，暂不提供充值地址。</Alert>:address?<Stack direction={{xs:'column',sm:'row'}} spacing={3} alignItems={{xs:'center',sm:'flex-start'}}>
    <Box sx={{p:2,bgcolor:'background.paper',border:1,borderColor:'divider',borderRadius:2,flexShrink:0}}><QRCodeSVG value={address} size={160}/></Box>
    <Stack spacing={2} sx={{minWidth:0,width:'100%'}}><Typography variant="subtitle2">TRC20 充值地址</Typography><Typography sx={{overflowWrap:'anywhere',fontFamily:'monospace',p:2,bgcolor:'background.default',borderRadius:1}}>{address}</Typography><Button variant="outlined" sx={{alignSelf:'flex-start'}} onClick={()=>void navigator.clipboard.writeText(address).then(()=>setCopied(true)).catch(()=>setError('复制失败，请手动复制完整地址。'))}>{copied?'已复制':'复制地址'}</Button><Typography variant="body2" color="text.secondary">仅支持 USDT · TRC20。请核对转出网络与地址；刷新后仍使用此地址。</Typography></Stack>
   </Stack>:!error&&<Typography role="status" color="text.secondary">{data?.address.state==='submitting'||data?.address.state==='unknown'||data?.address.state==='verifying'?'地址结果待核实，请勿重复创建。':'正在查询充值地址…'}</Typography>}
  </Stack></Paper>
  <Paper variant="outlined" sx={{p:{xs:2,md:3}}}><Stack spacing={2}>
   <Stack direction={{xs:'column',sm:'row'}} gap={1} justifyContent="space-between" alignItems={{sm:'center'}}><Typography variant="h6">{event?'充值详情':'充值记录'}</Typography>{event&&<Button component={Link} to={basePath+'/deposit'}>返回充值记录</Button>}</Stack>
   <Typography variant="body2" color="text.secondary">渠道通知不代表已入账；金额在链上核验完成前不计入可用余额。</Typography>
   {data?.events.map(ev=><Box key={ev.id} sx={{py:2,borderTop:1,borderColor:'divider'}}><Stack direction={{xs:'column',sm:'row'}} gap={1} justifyContent="space-between" alignItems={{sm:'center'}}><Box><Typography variant="subtitle2">{ev.amount} USDT · TRC20</Typography><Typography variant="caption" color="text.secondary">{new Date(ev.receivedAt).toLocaleString('zh-CN')}</Typography></Box><Typography variant="body2">{ev.posting==='posted'?'链上已确认 · 已入账':ev.state==='verified'?'链上已确认 · 记账处理中':ev.error==='deposit_pilot_cap_reached'?'超过充值额度 · 暂未入账':ev.state==='non_posting'?'渠道尚未确认到账 · 未入账':'待核验 · 未入账'}</Typography>{!event&&<Button sx={{alignSelf:'flex-start'}} component={Link} to={basePath+'/deposit?event='+ev.id}>详情</Button>}</Stack><Typography variant="body2" color="text.secondary" sx={{overflowWrap:'anywhere',mt:1}}>交易哈希：{ev.txHash||'渠道未提供'}</Typography></Box>)}
   {!data&&!error&&network==='TRC20'&&<Typography role="status">正在读取充值记录…</Typography>}
   {data&&!data.events.length&&<Typography sx={{py:4,textAlign:'center'}} color="text.secondary">{event?'未找到该充值通知':'暂无充值通知'}</Typography>}
   {!event&&data&&<Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap"><Button disabled={page===0} component={Link} to={basePath+'/deposit?page='+(page-1)}>上一页</Button><Typography variant="body2" color="text.secondary">第 {page+1} 页 · 每页最多 5 条</Typography><Button disabled={data.events.length<5} component={Link} to={basePath+'/deposit?page='+(page+1)}>下一页</Button></Stack>}
  </Stack></Paper>
 </Stack>;
}

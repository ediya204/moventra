import {usdtDecimal} from '../auth/cryptoContract';
import {CryptoTransferLayout,TransferStep,TransferAsset,transferTableSx} from './CryptoTransferLayout';
import FundsNavigation from './FundsNavigation';
import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Chip,MenuItem,Paper,Stack,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,TextField,Typography} from '@mui/material';
import {Link,useLocation} from 'react-router-dom';
import {QRCodeSVG} from 'qrcode.react';
import {cryptoRequest,cryptoError} from '../auth/cryptoApi';
type Event={id:string;amount:string;txHash:string;providerStatus:string;receivedAt:string;state:string;posting:string;error?:string;orderId?:string};
type Snapshot={address:{network:string;address:string;state:string};events:Event[];postingEnabled:boolean;mode:'observation'|'deposit_pilot'|'production';pilot?:{capMinor?:string;remainingMinor?:string;walletMinor?:string;reconciliation?:string}};
const usdt=(minor:string)=>{const n=BigInt(minor)/10000n;return `${n/100n}.${(n%100n).toString().padStart(2,'0')}`};
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
  <CryptoTransferLayout notice={<Stack spacing={2}>
   {data && (data.postingEnabled?<Alert severity="info">{data.mode==='production'?'TRC20 正式充值已开通。链上最终确认且记账完成后自动到账。':`TRC20 充值已开通，当前剩余额度 ${usdt(data.pilot?.remainingMinor||'0')} USDT。仅在链上最终确认且记账完成后到账，请勿超额转入。`}</Alert>:<Alert severity="info">{data.mode==='production'?'充值核验服务正在恢复，请稍后刷新查看。':data.mode==='deposit_pilot'?'当前暂不接收新的转入，请等待核验或额度确认。':'当前提供地址及渠道记录查询。到账核验与自动入账尚未启用，请勿转入资金。'}</Alert>)}
   {data?.pilot?.walletMinor!==undefined&&<Typography>USDT 钱包已入账余额：{usdt(data.pilot.walletMinor)} USDT</Typography>}
  </Stack>}>
   <TransferStep number={1} title="选择币种"><TextField select label="币种" value="USDT" fullWidth><MenuItem value="USDT"><TransferAsset/></MenuItem></TextField></TransferStep>
   <TransferStep number={2} title="选择网络"><TextField select label="网络" SelectProps={{renderValue:()=> <TransferAsset network={network}/>}} value={network} onChange={e=>{setData(null);setCopied(false);setNetwork(e.target.value)}} fullWidth><MenuItem value="TRC20"><TransferAsset network="TRC20"/></MenuItem><MenuItem value="ERC20"><TransferAsset network="ERC20"/>（尚未开通）</MenuItem></TextField><Typography variant="caption" color="text.secondary" sx={{display:'block',mt:1}}>请使用与转出钱包一致的网络</Typography></TransferStep>
   <TransferStep number={3} title="充值地址" last>
    {error&&<Alert severity="error" action={<Button onClick={()=>setTick(x=>x+1)}>重试</Button>}>{error}</Alert>}
    {network==='ERC20'?<Alert severity="info">该网络尚未开通，暂不提供充值地址。</Alert>:address?<Stack direction={{xs:'column',md:'row'}} spacing={3} alignItems={{xs:'stretch',md:'center'}}>
     <Stack spacing={1.5} sx={{minWidth:0,flex:1}}><Typography variant="body2" color="text.secondary">TRC20 充值地址</Typography><Box sx={{display:'flex',alignItems:'center',gap:1,border:1,borderColor:'divider',borderRadius:1,p:1.5}}><Typography sx={{overflowWrap:'anywhere',minWidth:0,flex:1,fontSize:14}}>{address}</Typography><Button aria-label="复制充值地址" sx={{minWidth:48,flexShrink:0}} onClick={()=>void navigator.clipboard.writeText(address).then(()=>setCopied(true)).catch(()=>setError('复制失败，请手动复制完整地址。'))}>{copied?'已复制':'复制地址'}</Button></Box><Typography variant="body2" color="text.secondary">仅支持 USDT · TRC20。请核对转出网络与地址；刷新后仍使用此地址。</Typography></Stack>
     <Box sx={{p:1,bgcolor:'#fff',flexShrink:0,alignSelf:'center'}}><QRCodeSVG value={address} size={180} marginSize={1}/></Box>
    </Stack>:!error&&<Typography role="status" color="text.secondary">{data?.address.state==='submitting'||data?.address.state==='unknown'||data?.address.state==='verifying'?'地址结果待核实，请勿重复创建。':'正在查询充值地址…'}</Typography>}
   </TransferStep>
  </CryptoTransferLayout>
  <Paper variant="outlined" sx={{overflow:'hidden',borderRadius:2}}>
   <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{p:2.5}}><Typography variant="h6">{event?'充值详情':'近期充值'}</Typography>{event&&<Button component={Link} to={basePath+'/deposit'}>返回充值记录</Button>}</Stack>
   <TableContainer tabIndex={0} aria-label="充值记录，可横向滚动"><Table sx={transferTableSx}><TableHead><TableRow>{['通知编号','状态','链 / 网络','链上交易金额','TXID','时间','操作'].map(v=><TableCell key={v}>{v}</TableCell>)}</TableRow></TableHead><TableBody>
   {data?.events.map(ev=><TableRow key={ev.id}><TableCell sx={{maxWidth:190,overflowWrap:'anywhere'}}>{ev.id}</TableCell><TableCell><Chip size="small" variant="outlined" color={ev.posting==='posted'?'success':'warning'} label={ev.posting==='posted'?'链上已确认 · 已入账':ev.state==='verified'?'链上已确认 · 记账处理中':ev.error==='deposit_pilot_cap_reached'?'超过充值额度 · 暂未入账':ev.state==='non_posting'?'渠道尚未确认到账 · 未入账':'待核验 · 未入账'}/></TableCell><TableCell><TransferAsset network="TRC20"/></TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{usdtDecimal(ev.amount)} USDT</TableCell><TableCell sx={{maxWidth:220,overflowWrap:'anywhere'}}>{ev.txHash||'渠道未提供'}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{new Date(ev.receivedAt).toLocaleString('zh-CN')}</TableCell><TableCell>{!event&&<Button component={Link} to={basePath+'/deposit?event='+encodeURIComponent(ev.id)}>详情</Button>}</TableCell></TableRow>)}
   </TableBody></Table></TableContainer>
   {network==='ERC20'&&<Typography role="status" sx={{py:7,textAlign:'center'}} color="text.secondary">该网络尚未开通，暂无可查询记录。</Typography>}
   {error&&<Typography role="status" sx={{p:3}} color="error">充值记录暂不可用，请重试查询。</Typography>}
   {!data&&!error&&network==='TRC20'&&<Typography role="status" sx={{p:3}}>正在读取充值记录…</Typography>}
   {data&&!data.events.length&&<Typography sx={{py:7,textAlign:'center'}} color="text.secondary">{event?'未找到该充值通知':'暂无充值通知'}</Typography>}
   {!event&&data&&<Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap" sx={{p:2}}><Button disabled={page===0} component={Link} to={basePath+'/deposit?page='+(page-1)}>上一页</Button><Typography variant="body2" color="text.secondary">第 {page+1} 页 · 每页最多 5 条</Typography><Button disabled={data.events.length<5} component={Link} to={basePath+'/deposit?page='+(page+1)}>下一页</Button></Stack>}
  </Paper>
 </Stack>;
}

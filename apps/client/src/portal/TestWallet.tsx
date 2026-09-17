import {useEffect,useState} from 'react';
import {Alert,Box,Button,Chip,Paper,Stack,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,Typography} from '@mui/material';
import {authMessage,liveGet} from '../../../../packages/shared/src/auth/liveApi';

type Balance={currency:'USD'|'USDT';amountMinor:string;scale:number};
type Grant={requestId:string;usdMinor:string;usdtMinor:string;reason:string;createdAt:string};
export type TestWalletData={customerId:string;mode:'online_test';enabled:boolean;executionEligible:false;withdrawalEligible:false;balances:Balance[];grants:Grant[];hasMore:boolean};
export function testMoney(minor:string,scale:number){
 const digits=minor.padStart(scale+1,'0');
 const whole=digits.slice(0,-scale).replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return whole+'.'+digits.slice(-scale);
}
export default function TestWallet({customerId,reload=0}:{customerId:string;reload?:number}){
 const [data,setData]=useState<TestWalletData|null>(null);
 const [error,setError]=useState('');const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;setData(null);setError('');
  liveGet<TestWalletData>(`/client-api/v1/customers/${customerId}/test-wallet`).then(value=>{
   if(value.customerId!==customerId||value.mode!=='online_test'||value.executionEligible!==false||value.withdrawalEligible!==false||!Array.isArray(value.balances)||!Array.isArray(value.grants)||value.balances.some(b=>!/^\d+$/.test(b.amountMinor)||b.scale!==(b.currency==='USD'?2:b.currency==='USDT'?6:-1)))throw new Error('invalid_test_wallet');
   if(active)setData(value);
  }).catch(e=>{if(active)setError(authMessage(e));});
  return()=>{active=false;};
 },[customerId,reload,retry]);
 const current=data?.customerId===customerId?data:null;
 return <Paper variant="outlined" sx={{p:3}}>
  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} mb={2}>
   <Typography variant="h6">线上测试钱包</Typography><Chip size="small" variant="outlined" label="测试资金" color="warning"/>
  </Stack>
  <Alert severity="info" sx={{mb:2}}>仅用于线上功能测试，不代表真实到账资金，不可提现到真实账户、转账或充值到真实卡片；可在资金中心进行模拟操作。</Alert>
  {error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>:!current?<Typography color="text.secondary">正在读取测试余额…</Typography>:!current.enabled?<Typography color="text.secondary">当前账户尚未配置测试余额。</Typography>:<>
   <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:2,mb:3}}>
    {current.balances.map(b=><Paper key={b.currency} variant="outlined" sx={{p:2.5}}>
     <Typography variant="body2" color="text.secondary">{b.currency} 可用测试余额</Typography>
     <Typography variant="h4" sx={{mt:1,fontVariantNumeric:'tabular-nums',overflowWrap:'anywhere'}}>{testMoney(b.amountMinor,b.scale)}</Typography>
    </Paper>)}
   </Box>
   <Typography variant="subtitle1" mb={1}>测试额度记录</Typography>
   <TableContainer><Table size="small"><TableHead><TableRow><TableCell>时间 / 记录编号</TableCell><TableCell>USD 增加</TableCell><TableCell>USDT 增加</TableCell><TableCell>原因</TableCell></TableRow></TableHead>
    <TableBody>{current.grants.map(g=><TableRow key={g.requestId}>
     <TableCell>{new Date(g.createdAt).toLocaleString('zh-CN')}<Typography variant="caption" display="block" color="text.secondary">{g.requestId}</Typography></TableCell>
     <TableCell sx={{whiteSpace:'nowrap'}}>+{testMoney(g.usdMinor,2)}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>+{testMoney(g.usdtMinor,6)}</TableCell><TableCell>{g.reason}</TableCell>
    </TableRow>)}</TableBody></Table></TableContainer>
   {current.hasMore&&<Typography variant="caption" color="text.secondary">仅展示最近 50 条记录；可用余额包含全部测试额度、已完成操作及提现预占。</Typography>}
  </>}
 </Paper>;
}

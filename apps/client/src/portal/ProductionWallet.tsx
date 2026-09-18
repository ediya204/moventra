import {useEffect,useState} from 'react';
import {Alert,Box,Button,Paper,Stack,Typography} from '@mui/material';
import {Link} from 'react-router-dom';
import {cryptoRequest,cryptoError} from '../../../../packages/shared/src/auth/cryptoApi';
import {cryptoMoney,type CryptoSnapshot} from '../../../../packages/shared/src/auth/cryptoContract';
export default function ProductionWallet({customerId,reload=0}:{customerId:string;reload?:number}){
 const [data,setData]=useState<CryptoSnapshot|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true,running=false;setData(null);setError('');const load=async()=>{if(running)return;running=true;try{const v=await cryptoRequest<CryptoSnapshot>(`/client-api/v1/customers/${customerId}/crypto?limit=5`);if(v.customerId!==customerId||v.mode!=='live')throw new Error('正式资金信息暂不可用');if(active){setData(v);setError('')}}catch(e){if(active){setData(null);setError(cryptoError(e))}}finally{running=false}};void load();const timer=setInterval(()=>{if(!document.hidden)void load()},15000);return()=>{active=false;clearInterval(timer)}},[customerId,reload]);
 function balance(currency:'USD'|'USDT'){if(!data)return '正在读取…';const accounts=data.ledger.accounts.filter(a=>a.kind==='wallet'&&a.currency===currency);if(!accounts.length)return '尚未开通';if(data.ledger.reconciliation!=='matched')return '余额核对中';return cryptoMoney(accounts.reduce((v,a)=>v+BigInt(a.ledgerAvailableMinor),0n).toString(),currency)}
 return <Paper variant="outlined" sx={{p:3}}><Stack spacing={2}><Stack direction="row" justifyContent="space-between"><Typography variant="h6">我的钱包</Typography><Button component={Link} to="/portal/funds">资金中心</Button></Stack>{error?<Alert severity="info">正式资金暂不可用，请稍后刷新。</Alert>:<Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:2}}>{(['USD','USDT'] as const).map(currency=><Box key={currency}><Typography color="text.secondary">{currency} 钱包余额</Typography><Typography variant="h4" sx={{overflowWrap:'anywhere'}}>{balance(currency)}</Typography></Box>)}</Box>}</Stack></Paper>;
}

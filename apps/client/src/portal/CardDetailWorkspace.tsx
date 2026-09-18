import {MerchantCell,LogoAttribution} from '../../../../packages/shared/src/components/MerchantLogo';
import {useEffect,useState} from 'react';
import {Alert,Box,Button,Paper,Stack,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,TextField,Typography} from '@mui/material';
import {Link,useLocation,useSearchParams} from 'react-router-dom';
import ChannelCardStatus from '../../../../packages/shared/src/components/ChannelCardStatus';
import CardControls from '../../../../packages/shared/src/components/CardControls';
import {liveGet,authMessage} from '../../../../packages/shared/src/auth/liveApi';
import {cryptoRequest,cryptoError} from '../../../../packages/shared/src/auth/cryptoApi';
import {cryptoMoney,type CryptoSnapshot} from '../../../../packages/shared/src/auth/cryptoContract';
import {snapshotAmount,type CardSyncInfo} from '../../../../packages/shared/src/auth/cardSnapshotContract';
import CustomerFunds from '../../../../packages/shared/src/finance/CustomerFunds';
import {RemoteCardCvv} from './RemoteCardCvv';

type Card=CardSyncInfo&{id:string;cardName?:string;name?:string;cardLast4?:string;last4?:string;cardStatus?:string;expiryMonth?:string;expiryYear?:string;network?:string;fundingCardId?:string|null;cvvAvailable?:boolean};
type Funds=Omit<CryptoSnapshot,'capabilities'>&{canOperate?:boolean;capabilities?:{cardTransfersEnabled?:boolean};cards?:{id:string;availableMinor:string|null;heldMinor?:string|null;inTransitMinor?:string|null;ledgerAccountId?:string;canOperate:boolean;reason:string}[]};
const labels:Record<string,string>={deposit:'充值',withdrawal:'提款',otc:'兑换',card_transfer:'卡片充提',wallet_to_card:'充值到卡',card_to_wallet:'退回钱包',completed:'已完成',processing:'处理中',unknown:'待核实',failed:'失败',rejected:'已拒绝',cancelled:'已取消',reserving:'预占中',releasing:'释放中'};
export default function CardDetailWorkspace({customerId,connection,card,reload,onRefresh}:{customerId:string;connection:string;card:Card;reload:number;onRefresh:()=>void}){
 const location=useLocation(),[params,setParams]=useSearchParams();const tab=params.get('tab')||'overview';
 const [funds,setFunds]=useState<Funds|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const detail=`/portal/cards/${card.id}?${new URLSearchParams({connection,...(params.get('back')?{back:params.get('back')!}:{})})}`;
 const go=(value:string)=>{const q=new URLSearchParams(params);q.set('tab',value);q.delete('txPage');setParams(q)};
 useEffect(()=>{let active=true;setFunds(null);setError('');const load=async()=>{try{
  const q=new URLSearchParams({limit:'5'});if(card.fundingCardId){q.set('kind','card_transfer');q.set('cardId',card.fundingCardId)}
  const value=await cryptoRequest<Funds>(`/client-api/v1/customers/${customerId}/crypto?${q}`);
  if(value.customerId!==customerId||value.mode!=='live')throw new Error('资金响应不一致');
  if(active)setFunds(value);
 }catch(e){if(active){setFunds(null);setError(cryptoError(e))}}};void load();const timer=setInterval(()=>{if(!document.hidden)void load()},15000);return()=>{active=false;clearInterval(timer)}},[customerId,card.id,card.fundingCardId,reload,retry]);
 const funded=funds?.cards?.find(c=>c.id===card.fundingCardId);
 const enabled=!!funded?.canOperate&&funds?.canOperate===true&&funds?.capabilities?.cardTransfersEnabled===true;
 const balance=()=>{if(error)return '暂不可用';if(!funds)return '读取中…';if(funds.ledger.reconciliation!=='matched')return '核对中';const rows=funds.ledger.accounts.filter(a=>a.kind==='wallet'&&a.currency==='USD');return rows.length?cryptoMoney(rows.reduce((v,a)=>v+BigInt(a.ledgerAvailableMinor),0n).toString(),'USD'):'尚未开通'};
 return <Stack spacing={3}>
  <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={2}><Box><Typography variant="h5">{card.cardName||card.name||'卡片'} · {card.cardLast4||card.last4||'尾号未知'}</Typography><Typography color="text.secondary">{card.network||'品牌未提供'} · 有效期 {card.expiryMonth&&card.expiryYear?`${card.expiryMonth}/${card.expiryYear}`:'未提供'}</Typography></Box><ChannelCardStatus status={card.cardStatus}/></Stack>
  <Stack direction="row" flexWrap="wrap" gap={1}>{[['overview','概览'],['transactions','交易记录'],['funding','资金记录']].map(([v,label])=><Button key={v} variant={tab===v?'contained':'text'} onClick={()=>go(v)}>{label}</Button>)}</Stack>
  {['deposit','withdraw'].includes(tab)?card.fundingCardId?<CustomerFunds key={`${card.id}:${tab}`} customerId={customerId} cardContext={{id:card.fundingCardId,direction:tab==='deposit'?'wallet_to_card':'card_to_wallet',returnTo:detail}}/>:<Alert severity="info">尚未开通卡片资金账户。</Alert>:<>
   {tab==='overview'&&<>
    <Paper variant="outlined" sx={{p:2}}><Stack spacing={2}>
     <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,1fr)',lg:'repeat(4,1fr)'},gap:2}}>{[['USD 钱包可用',balance()],['本卡可用资金',!card.fundingCardId?'尚未开通':error?'暂不可用':!funds?'读取中…':funded?.availableMinor!=null&&funds.ledger.reconciliation==='matched'?cryptoMoney(funded.availableMinor,'USD'):'待核实'],['本卡充提在途',!card.fundingCardId?'尚未开通':funded?.inTransitMinor!=null?cryptoMoney(funded.inTransitMinor,'USD'):'待核实'],['本卡授权预占',!card.fundingCardId?'尚未开通':funded?.heldMinor!=null?cryptoMoney(funded.heldMinor,'USD'):'待核实']].map(([label,value])=><Box key={label}><Typography color="text.secondary">{label}</Typography><Typography variant="h6">{value}</Typography></Box>)}</Box>
     <Typography variant="caption" color="text.secondary">钱包与本卡资金分别展示；授权预占不重复计入资产。转账在途请查看对应资金订单。</Typography>
     {error&&<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>}
     <Stack direction="row" gap={1}><Button disabled={!enabled} onClick={()=>go('deposit')}>充值到卡</Button><Button disabled={!enabled} onClick={()=>go('withdraw')}>退回钱包</Button></Stack>
     {!enabled&&<Typography variant="body2" color="text.secondary">{!card.fundingCardId?'尚未开通卡片资金账户':funded?.reason||'卡片充提尚未开放或正在核验'}</Typography>}
    </Stack></Paper>
    <CardControls row={card} path={`/client-api/v1/customers/${customerId}/card-projections/${connection}/cards/${card.id}/actions`} onRefresh={onRefresh}/>
    <RemoteCardCvv remoteIdentity={card.cvvAvailable?{source:'customer-api',id:card.id,customerId,connection}:undefined}/>
   </>}
   {(tab==='overview'||tab==='transactions')&&<CardTransactions customerId={customerId} connection={connection} cardId={card.id} full={tab==='transactions'} reload={reload} onAll={()=>go('transactions')}/>}
   {(tab==='overview'||tab==='funding')&&<Paper variant="outlined" sx={{p:2}}><Stack spacing={2}><Typography variant="h6">{tab==='overview'?'最近资金记录':'资金记录'}</Typography>
    {!card.fundingCardId?<Typography>尚未开通卡片资金账户。</Typography>:tab==='funding'?<CustomerFunds key={card.fundingCardId} customerId={customerId} cardContext={{id:card.fundingCardId,returnTo:detail}}/>:error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>:!funds?<Typography>正在读取…</Typography>:<>
     {funds.orders.filter(o=>o.cardId===card.fundingCardId).map(o=><Stack key={o.id} direction={{xs:'column',sm:'row'}} gap={1} justifyContent="space-between"><Typography>{new Date(o.createdAt).toLocaleString()} · {labels[o.direction||o.kind]||o.kind} · {cryptoMoney(o.amountMinor,o.currency)} · 费用 {cryptoMoney(o.feeMinor,o.currency)} · {labels[o.state]||o.state}</Typography><Button component={Link} to={`/portal/funds/orders/${o.id}?${new URLSearchParams({returnTo:location.pathname+location.search})}`}>详情</Button></Stack>)}
     {!funds.orders.some(o=>o.cardId===card.fundingCardId)&&<Typography>暂无本卡资金订单。</Typography>}<Button onClick={()=>go('funding')}>查看全部资金记录</Button>
    </>}
   </Stack></Paper>}
  </>}
 </Stack>;
}
function CardTransactions({customerId,connection,cardId,full,reload,onAll}:{customerId:string;connection:string;cardId:string;full:boolean;reload:number;onAll:()=>void}){
 const [params,setParams]=useSearchParams();const [data,setData]=useState<{rows:{id:string;merchant?:string;amountCents?:string;detailedStatus?:string;date?:string}[];total:number}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const page=full?Number(params.get('txPage')||'0'):0,keyword=full?params.get('txKeyword')||'':'',state=full?params.get('txStatus')||'':'',from=full?params.get('txFrom')||'':'',to=full?params.get('txTo')||'':'';
 useEffect(()=>{let active=true;setData(null);setError('');if(!Number.isInteger(page)||page<0||page>2500){setError('页码无效');return}
 const q=new URLSearchParams({page:String(page),cardId});if(keyword)q.set('keyword',keyword);if(state)q.set('detailedStatus',state);
 try{if(from)q.set('from',new Date(from+'T00:00:00Z').toISOString());if(to)q.set('to',new Date(new Date(to+'T00:00:00Z').getTime()+86400000).toISOString());if(from&&to&&from>to)throw new Error()}catch{setError('日期范围无效');return}
 liveGet<typeof data>(`/client-api/v1/customers/${customerId}/card-projections/${connection}/transactions?${q}`).then(v=>{if(active)setData(v)}).catch(e=>{if(active)setError(authMessage(e))});return()=>{active=false};
 },[customerId,connection,cardId,page,keyword,state,from,to,reload,retry]);
 const update=(key:string,value:string)=>{const q=new URLSearchParams(params);q.set(key,value);if(key!=='txPage'&&key!=='transaction')q.set('txPage','0');setParams(q)};
 return <Paper variant="outlined" sx={{p:2}}><Stack spacing={2}><Typography variant="h6">{full?'卡片交易记录':'最近 5 笔卡片交易'}</Typography>
 {full&&<Stack direction={{xs:'column',sm:'row'}} gap={1}><TextField size="small" label="商户" value={keyword} onChange={e=>update('txKeyword',e.target.value)}/><TextField size="small" label="渠道交易状态" value={state} onChange={e=>update('txStatus',e.target.value)}/><TextField type="date" size="small" label="开始日期 UTC" InputLabelProps={{shrink:true}} value={from} onChange={e=>update('txFrom',e.target.value)}/><TextField type="date" size="small" label="结束日期 UTC" InputLabelProps={{shrink:true}} value={to} onChange={e=>update('txTo',e.target.value)}/></Stack>}
 {error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>:!data?<Typography>正在读取交易…</Typography>:<><TableContainer><Table size="small"><TableHead><TableRow>{['商户','金额','状态','时间','操作'].map(v=><TableCell key={v}>{v}</TableCell>)}</TableRow></TableHead><TableBody>{(full?data.rows:data.rows.slice(0,5)).map(row=><TableRow key={row.id}><TableCell><MerchantCell name={row.merchant||'未知商户'}/></TableCell><TableCell>{snapshotAmount(row.amountCents)}</TableCell><TableCell>{row.detailedStatus||'未知'}</TableCell><TableCell>{row.date?new Date(row.date).toLocaleString():'未提供'}</TableCell><TableCell><Button onClick={()=>update('transaction',row.id)}>详情</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer><LogoAttribution/>{!data.rows.length&&<Typography>当前范围暂无交易。</Typography>}{full?<Stack direction="row" gap={1}><Button disabled={!page} onClick={()=>update('txPage',String(page-1))}>上一页</Button><Typography>第 {page+1} 页 · 共 {data.total} 笔</Typography><Button disabled={(page+1)*20>=data.total} onClick={()=>update('txPage',String(page+1))}>下一页</Button></Stack>:<Button onClick={onAll}>查看全部交易</Button>}</>}
 </Stack></Paper>;
}

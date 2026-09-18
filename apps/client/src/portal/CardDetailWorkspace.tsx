import {MerchantCell,LogoAttribution} from '../../../../packages/shared/src/components/MerchantLogo';
import {useEffect,useState} from 'react';
import {Alert,Box,Button,ButtonBase,Drawer,IconButton,Paper,Stack,Tab,Tabs,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,TextField,Typography} from '@mui/material';
import {Link,useSearchParams} from 'react-router-dom';
import {Icon} from '@iconify/react';
import ChannelCardStatus from '../../../../packages/shared/src/components/ChannelCardStatus';
import CardControls from '../../../../packages/shared/src/components/CardControls';
import {liveGet,liveCardSync,authMessage} from '../../../../packages/shared/src/auth/liveApi';
import {cryptoRequest,cryptoError} from '../../../../packages/shared/src/auth/cryptoApi';
import {cryptoMoney,type CryptoSnapshot} from '../../../../packages/shared/src/auth/cryptoContract';
import {snapshotAmount,cardMetricDisplay,cardQuotaDisplay,type CardSyncInfo} from '../../../../packages/shared/src/auth/cardSnapshotContract';
import CustomerFunds from '../../../../packages/shared/src/finance/CustomerFunds';
import {RemoteCardCvv} from './RemoteCardCvv';

type Card=CardSyncInfo&{id:string;cardName?:string;name?:string;cardLast4?:string;last4?:string;cardStatus?:string;expiryMonth?:string;expiryYear?:string;network?:string;fundingCardId?:string|null;issuingOrderId?:string;cvvAvailable?:boolean;detailsAvailable?:boolean};
type Funds=Omit<CryptoSnapshot,'capabilities'>&{canOperate?:boolean;capabilities?:{cardTransfersEnabled?:boolean};cards?:{id:string;availableMinor:string|null;heldMinor?:string|null;inTransitMinor?:string|null;ledgerAccountId?:string;canOperate:boolean;reason:string}[]};
export default function CardDetailWorkspace({customerId,connection,card,reload,onRefresh}:{customerId:string;connection:string;card:Card;reload:number;onRefresh:()=>void}){
 const [params,setParams]=useSearchParams();const requestedTab=params.get('tab');
 const tab=['funding','deposit','withdraw'].includes(requestedTab||'')?requestedTab!:'transactions';
 const [metricError,setMetricError]=useState(''),[metricBusy,setMetricBusy]=useState(false);
 const [detailsOpen,setDetailsOpen]=useState(false);
 const quota=cardQuotaDisplay(card.metrics);
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
 const name=card.cardName||card.name||'未命名卡片';
 const last4=card.cardLast4||card.last4||'••••';
 const expiry=card.expiryMonth&&card.expiryYear?`${card.expiryMonth}/${card.expiryYear}`:'未提供';
 const cardValue=(value?:string|null)=>!card.fundingCardId?'尚未开通':error?'暂不可用':!funds?'读取中…':value!=null&&funds.ledger.reconciliation==='matched'?cryptoMoney(value,'USD'):'待核实';
 const metricRefresh=async()=>{setRetry(n=>n+1);setMetricBusy(true);setMetricError('');try{await liveCardSync(`/client-api/v1/customers/${customerId}/card-projections/${connection}/cards/${card.id}/metrics-sync`);onRefresh()}catch(e){setMetricError(authMessage(e))}finally{setMetricBusy(false)}};
 const showSpending=()=>{const q=new URLSearchParams(params);q.set('tab','transactions');q.set('txPage','0');q.set('txMetric','spending');q.set('txMetricFrom',card.metrics?.from||'');q.set('txMetricTo',card.metrics?.to||'');q.delete('txFrom');q.delete('txTo');q.delete('txKeyword');q.delete('txStatus');setParams(q)};
 return <Stack spacing={3}>
  <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',md:'minmax(0,0.95fr) minmax(0,1.2fr)'},columnGap:{xs:3,md:4},rowGap:1.5}}>
   <Stack spacing={2.5} sx={{minWidth:0,gridColumn:{md:1},gridRow:{md:1}}}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Typography variant="subtitle2">我的卡片</Typography><ChannelCardStatus status={card.cardStatus}/></Stack>
    <ButtonBase onClick={()=>setDetailsOpen(true)} aria-label="查看卡片信息" sx={{display:'block',width:'100%',maxWidth:440,textAlign:'left',borderRadius:3,bgcolor:'#17392F',color:'#F5F7F2',p:{xs:2.5,sm:3},overflow:'hidden',position:'relative',alignSelf:'center',border:'1px solid #315448','&:focus-visible':{outline:'3px solid',outlineColor:'primary.main',outlineOffset:4},'&:hover':{bgcolor:'#20483B'}}}>
     <Box aria-hidden="true" sx={{position:'absolute',right:-65,top:-90,width:260,height:260,border:'1px solid rgba(220,239,223,.16)',borderRadius:'50%','&::after':{content:'""',position:'absolute',inset:25,border:'1px solid rgba(220,239,223,.16)',borderRadius:'50%'}}}/>
     <Stack spacing={3} sx={{position:'relative'}}>
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{fontWeight:700,letterSpacing:2,fontSize:16}}>MOVENTRA</Typography><Typography variant="body2">{card.network||'支付卡'}</Typography></Stack>
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Box aria-hidden="true" sx={{width:38,height:29,border:'1px solid #C7C9A8',borderRadius:1,bgcolor:'#B4BE9F',display:'grid',gridTemplateColumns:'repeat(3,1fr)',overflow:'hidden'}}>{[0,1,2].map(i=><Box key={i} sx={{height:29,borderRight:'1px solid #7F916F'}}/>)}</Box><Icon icon="solar:eye-linear" width={21}/></Stack>
      <Typography sx={{fontSize:{xs:20,sm:25},letterSpacing:{xs:2,sm:3},fontVariantNumeric:'tabular-nums'}}>•••• •••• •••• {last4}</Typography>
      <Stack direction="row" justifyContent="space-between" gap={2}><Box sx={{minWidth:0}}><Typography sx={{fontSize:10,opacity:.65,letterSpacing:1.3,mb:.5}}>CARD NAME</Typography><Typography variant="body2" sx={{overflowWrap:'anywhere',fontWeight:600}}>{name}</Typography></Box><Box sx={{flexShrink:0}}><Typography sx={{fontSize:10,opacity:.65,letterSpacing:1.3,mb:.5}}>VALID THRU</Typography><Typography variant="body2">{expiry}</Typography></Box></Stack>
     </Stack>
    </ButtonBase>
    <Stack spacing={1.5} sx={{width:'100%',maxWidth:440,alignSelf:'center',mt:'auto !important',pt:2.5}}>
     <Typography variant="caption" color="text.secondary" textAlign="center">点击卡片查看卡片信息与安全码</Typography>
     <Stack spacing={1}>
      <Box sx={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:1,'& .MuiButton-root':{minHeight:42}}}>
       <Button variant="outlined" startIcon={<Icon icon="solar:add-circle-linear"/>} disabled={!enabled} onClick={()=>go('deposit')}>充值到卡</Button>
       <Button variant="outlined" startIcon={<Icon icon="solar:arrow-left-down-linear"/>} disabled={!enabled} onClick={()=>go('withdraw')}>退回钱包</Button>
      </Box>
      <CardControls row={card} layout="grid" pauseLabel="冻结卡片" path={`/client-api/v1/customers/${customerId}/card-projections/${connection}/cards/${card.id}/actions`} onRefresh={onRefresh}/>
      {!card.controlsEnabled&&<Button variant="outlined" disabled sx={{minHeight:42}}>冻结卡片 · 暂未开放</Button>}
     </Stack>
    </Stack>
   </Stack>
     {!enabled&&<Stack direction="row" alignItems="flex-start" gap={.75} sx={{color:'text.secondary',width:'100%',maxWidth:440,justifySelf:'center',gridColumn:{md:1},gridRow:{md:2}}}><Icon icon="solar:info-circle-linear" width={15} style={{flexShrink:0,marginTop:2}}/><Typography variant="caption">{!card.fundingCardId?'尚未开通卡片资金账户':funded?.reason||'卡片充提尚未开放或正在核验'}</Typography></Stack>}
   <Stack spacing={2.5} sx={{minWidth:0,gridColumn:{md:2},gridRow:{md:1},borderLeft:{md:1},borderColor:{md:'divider'},pl:{md:4}}}>
    <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="h6">资金情况</Typography><Button size="small" disabled={metricBusy||card.metrics?.syncState==='pending'} onClick={metricRefresh} startIcon={<Icon icon="solar:refresh-linear"/>}>{metricBusy||card.metrics?.syncState==='pending'?'同步中…':'刷新数据'}</Button></Stack>
    <Box sx={{bgcolor:'#F4F6F8',borderRadius:2.5,p:{xs:2,sm:2.5}}}>
     <Stack direction="row" alignItems="center" gap={1}><Typography variant="body2" color="text.secondary">剩余额度</Typography><Icon icon="solar:info-circle-linear" width={16} color="#919EAB"/></Stack>
     <Typography aria-label="剩余额度" sx={{fontSize:32,lineHeight:1.3,fontWeight:700,mt:.5,mb:2,fontVariantNumeric:'tabular-nums'}}>{quota.remaining}</Typography>
     {quota.percent!==null&&<Box role="progressbar" aria-label="额度使用进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={quota.percent} sx={{height:6,bgcolor:'#DFE3E8',borderRadius:3,mb:1.5,overflow:'hidden'}}><Box sx={{width:`${quota.percent}%`,height:'100%',bgcolor:'#FFAB00',borderRadius:3}}/></Box>}
     <Box sx={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:2}}>
      {[['总额度',quota.total],['本周期已用',quota.used]].map(([label,value])=><Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="subtitle2" sx={{mt:.25,fontVariantNumeric:'tabular-nums'}}>{value}</Typography></Box>)}
     </Box>
     <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>剩余为本周期可消费额度，不等于可提现资金。{card.metrics?.sharedGroup?'受卡组共享额度限制。':''}{card.metrics?.availableAt?` 更新于 ${new Date(card.metrics.availableAt).toLocaleString('zh-CN',{hour12:false})}`:' 尚无渠道快照。'}</Typography>
    </Box>
    {metricError&&<Alert severity="error" action={<Button onClick={metricRefresh}>重试</Button>}>{metricError}</Alert>}
    <Box sx={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:2}}>{[['本卡可用资金',cardValue(funded?.availableMinor)],['USD 钱包可用',balance()]].map(([label,value])=><Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="subtitle1" sx={{mt:.5,fontWeight:600,fontVariantNumeric:'tabular-nums',overflowWrap:'anywhere'}}>{value}</Typography></Box>)}</Box>
    <Box component="details" sx={{color:'text.secondary'}}><Typography component="summary" variant="caption" sx={{cursor:'pointer'}}>在途与预占资金</Typography><Box sx={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:2,mt:1.5}}>{[['本卡充提在途',cardValue(funded?.inTransitMinor)],['本卡授权预占',cardValue(funded?.heldMinor)]].map(([label,value])=><Box key={label}><Typography variant="caption">{label}</Typography><Typography variant="body2" color="text.primary" mt={.5}>{value}</Typography></Box>)}</Box><Typography variant="caption" display="block" mt={1.5}>额度不等于可提现资金；钱包与本卡资金分别展示，授权预占不重复计入资产。</Typography></Box>
    {error&&<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>}
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
     <Box><Typography variant="caption" color="text.secondary">近 30 天消费</Typography><Typography variant="subtitle2" title={cardMetricDisplay(card.metrics,'spending').help}>{cardMetricDisplay(card.metrics,'spending').value}</Typography></Box>
     <Button size="small" disabled={card.metrics?.coverage!=='complete'} onClick={showSpending}>查看消费明细</Button>
    </Stack>
  <Box sx={{borderTop:1,borderColor:'divider',pt:2,mt:'auto !important'}}><Typography variant="subtitle2" mb={1.5}>快捷操作</Typography><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,minmax(0,1fr))'},gap:1.5,'& .MuiButton-root':{justifyContent:'flex-start',minHeight:42,px:1.5,borderColor:'divider',color:'text.primary','&:hover':{borderColor:'primary.main',bgcolor:'action.hover'}}}}><Button variant="outlined" component={Link} to="/portal/funds" startIcon={<Icon icon="solar:wallet-linear"/>} endIcon={<Icon icon="solar:arrow-right-up-linear"/>} sx={{'& .MuiButton-endIcon':{ml:'auto',color:'text.secondary'}}}>资金中心</Button><Button variant="outlined" onClick={()=>go('funding')} startIcon={<Icon icon="solar:document-text-linear"/>} endIcon={<Icon icon="solar:arrow-right-linear"/>} sx={{'& .MuiButton-endIcon':{ml:'auto',color:'text.secondary'}}}>资金记录</Button></Box></Box>
   </Stack>
  </Box>
  <Box sx={{borderTop:1,borderColor:'divider',pt:1,minWidth:0}}>
   <Tabs value={tab==='transactions'?'transactions':'funding'} onChange={(_,value)=>go(value)} aria-label="卡片记录" sx={{mb:2}}><Tab value="transactions" label="交易记录" id="card-transactions-tab" aria-controls="card-records-panel"/><Tab value="funding" label="资金记录" id="card-funding-tab" aria-controls="card-records-panel"/></Tabs>
   {['deposit','withdraw'].includes(tab)?<Stack spacing={2}><Button sx={{alignSelf:'flex-start'}} onClick={()=>go('funding')}>返回资金记录</Button>{card.fundingCardId?<CustomerFunds key={`${card.id}:${tab}`} customerId={customerId} cardContext={{id:card.fundingCardId,direction:tab==='deposit'?'wallet_to_card':'card_to_wallet',returnTo:detail}}/>:<Alert severity="info">尚未开通卡片资金账户。</Alert>}</Stack>:<Box role="tabpanel" id="card-records-panel" aria-labelledby={tab==='funding'?'card-funding-tab':'card-transactions-tab'}>
    {tab==='funding'&&card.issuingOrderId&&<Button component={Link} to={'/portal/card-orders/'+card.issuingOrderId} sx={{mb:2}}>查看开卡费、首充及退款记录</Button>}
    {tab==='transactions'?<CardTransactions customerId={customerId} connection={connection} cardId={card.id} full reload={reload} onAll={()=>go('transactions')}/>:card.fundingCardId?<CustomerFunds key={card.fundingCardId} customerId={customerId} cardContext={{id:card.fundingCardId,returnTo:detail}}/>:<Alert severity="info">尚未开通卡片资金账户，暂无资金记录。</Alert>}
   </Box>}
  </Box>
  <Drawer anchor="right" open={detailsOpen} onClose={()=>setDetailsOpen(false)} PaperProps={{sx:{width:{xs:'100%',sm:420},p:3}}}>
   {detailsOpen&&<Stack spacing={3}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h6">卡片信息</Typography><IconButton aria-label="关闭卡片信息" onClick={()=>setDetailsOpen(false)}><Icon icon="solar:close-circle-linear"/></IconButton></Stack>
    <RemoteCardCvv fullDetails remoteIdentity={card.detailsAvailable?{source:'customer-api',id:card.id,customerId,connection}:undefined}/>

   </Stack>}
  </Drawer>
 </Stack>;
}

function CardTransactions({customerId,connection,cardId,full,reload,onAll}:{customerId:string;connection:string;cardId:string;full:boolean;reload:number;onAll:()=>void}){
 const [params,setParams]=useSearchParams();const [data,setData]=useState<{rows:{id:string;merchant?:string;amountCents?:string;detailedStatus?:string;date?:string}[];total:number}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const page=full?Number(params.get('txPage')||'0'):0,keyword=full?params.get('txKeyword')||'':'',state=full?params.get('txStatus')||'':'',from=full?params.get('txFrom')||'':'',to=full?params.get('txTo')||'':'';
 const metric=full?params.get('txMetric')||'':'',metricFrom=full?params.get('txMetricFrom')||'':'',metricTo=full?params.get('txMetricTo')||'':'';
 useEffect(()=>{let active=true;setData(null);setError('');if(!Number.isInteger(page)||page<0||page>2500){setError('页码无效');return}
 const q=new URLSearchParams({page:String(page),cardId});if(keyword)q.set('keyword',keyword);if(state)q.set('detailedStatus',state);
 try{if(from)q.set('from',new Date(from+'T00:00:00Z').toISOString());if(to)q.set('to',new Date(new Date(to+'T00:00:00Z').getTime()+86400000).toISOString());if(from&&to&&from>to)throw new Error()}catch{setError('日期范围无效');return}
 if(metric==='spending'){if(!metricFrom||!metricTo){setError('统计区间无效');return}q.set('metric','spending');q.set('from',metricFrom);q.set('to',metricTo)}
 liveGet<typeof data>(`/client-api/v1/customers/${customerId}/card-projections/${connection}/transactions?${q}`).then(v=>{if(active)setData(v)}).catch(e=>{if(active)setError(authMessage(e))});return()=>{active=false};
 },[customerId,connection,cardId,page,keyword,state,from,to,metric,metricFrom,metricTo,reload,retry]);
 const update=(key:string,value:string)=>{const q=new URLSearchParams(params);q.set(key,value);if(key!=='txPage'&&key!=='transaction'){q.set('txPage','0');q.delete('txMetric');q.delete('txMetricFrom');q.delete('txMetricTo')}setParams(q)};
 return <Paper variant="outlined" sx={{p:2}}><Stack spacing={2}><Typography variant="h6">{full?'卡片交易记录':'最近 5 笔卡片交易'}</Typography>
 {metric==='spending'&&<Alert severity="info" action={<Button onClick={()=>update('txMetric','')}>查看全部交易</Button>}>当前仅显示统计区间内的已入账消费，不含退款与费用。</Alert>}
 {full&&<Stack direction={{xs:'column',sm:'row'}} gap={1}><TextField size="small" label="商户" value={keyword} onChange={e=>update('txKeyword',e.target.value)}/><TextField size="small" label="渠道交易状态" value={state} onChange={e=>update('txStatus',e.target.value)}/><TextField type="date" size="small" label="开始日期 UTC" InputLabelProps={{shrink:true}} value={from} onChange={e=>update('txFrom',e.target.value)}/><TextField type="date" size="small" label="结束日期 UTC" InputLabelProps={{shrink:true}} value={to} onChange={e=>update('txTo',e.target.value)}/></Stack>}
 {error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>:!data?<Typography>正在读取交易…</Typography>:<><TableContainer><Table size="small"><TableHead><TableRow>{['商户','金额','状态','时间','操作'].map(v=><TableCell key={v}>{v}</TableCell>)}</TableRow></TableHead><TableBody>{(full?data.rows:data.rows.slice(0,5)).map(row=><TableRow key={row.id} hover tabIndex={0} aria-label={`查看 ${row.merchant||'交易'} 的详情`} onClick={event=>{if(!(event.target as HTMLElement).closest('a,button,input,select,textarea,[role="button"]'))update('transaction',row.id);}} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();update('transaction',row.id);}}} sx={{cursor:'pointer','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main',outlineOffset:-2}}}><TableCell><MerchantCell name={row.merchant||'未知商户'}/></TableCell><TableCell>{snapshotAmount(row.amountCents)}</TableCell><TableCell>{row.detailedStatus||'未知'}</TableCell><TableCell>{row.date?new Date(row.date).toLocaleString():'未提供'}</TableCell><TableCell><Button onClick={()=>update('transaction',row.id)}>详情</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer><LogoAttribution/>{!data.rows.length&&<Typography>当前范围暂无交易。</Typography>}{full?<Stack direction="row" gap={1}><Button disabled={!page} onClick={()=>update('txPage',String(page-1))}>上一页</Button><Typography>第 {page+1} 页 · 共 {data.total} 笔</Typography><Button disabled={(page+1)*20>=data.total} onClick={()=>update('txPage',String(page+1))}>下一页</Button></Stack>:<Button onClick={onAll}>查看全部交易</Button>}</>}
 </Stack></Paper>;
}

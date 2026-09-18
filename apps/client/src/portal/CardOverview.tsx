import ChannelCardStatus from '../../../../packages/shared/src/components/ChannelCardStatus';
import {useEffect,useState} from 'react';
import {Alert,Box,Button,Paper,Stack,Typography} from '@mui/material';
import {Link} from 'react-router-dom';
import {liveGet,authMessage} from '../../../../packages/shared/src/auth/liveApi';
import {cardMetricDisplay,type CardSyncInfo} from '../../../../packages/shared/src/auth/cardSnapshotContract';

type Connection={id:string;label:string;revision:string};
type Card=CardSyncInfo & {id:string;name?:string;cardName?:string;last4?:string;cardLast4?:string;cardStatus?:string};
type Group={connection:Connection;rows:Card[];total:number;error?:string};
export function cardChartData(groups:Group[]){
 const rows=groups.filter(g=>!g.error).flatMap(g=>g.rows.slice(0,5).map(card=>({card,connection:g.connection.id})));
 const statuses=[['active','正常','#23815b'],['paused','已暂停','#b7791f'],['inactive','未启用','#64748b'],['closed','已注销','#b75b64'],['unknown','其他 / 未知','#94a3b8']].map(([key,label,color])=>({key,label,color,count:rows.filter(({card})=>(['active','paused','inactive','closed'].includes(card.cardStatus||'')?card.cardStatus:'unknown')===key).length})).filter(s=>s.count);
 const series=new Map<string,{currency:string;from:string;to:string;items:{card:Card;connection:string;amount:bigint;width:number}[]}>();
 let excluded=0;
 for(const row of rows){
  const m=row.card.metrics;
  if(!m||m.coverage!=='complete'||m.spendingMinor===null||!/^\d+$/.test(m.spendingMinor)||!m.currency||!Number.isInteger(m.scale)||m.scale<0||!m.from||!m.to||!Number.isFinite(Date.parse(m.from))||!Number.isFinite(Date.parse(m.to))||Date.parse(m.from)>=Date.parse(m.to)){excluded++;continue}
  const key=JSON.stringify([m.currency,m.scale,m.from,m.to]);
  const group=series.get(key)||{currency:m.currency,from:m.from,to:m.to,items:[]};
  group.items.push({...row,amount:BigInt(m.spendingMinor),width:0});series.set(key,group);
 }
 for(const group of series.values()){
  group.items.sort((a,b)=>a.amount>b.amount?-1:a.amount<b.amount?1:0);
  const max=group.items[0]?.amount||0n;
  for(const item of group.items)item.width=max===0n?0:Number(item.amount*10000n/max)/100;
 }
 return {count:rows.length,statuses,series:[...series.values()],excluded};
}
function OverviewCharts({groups}:{groups:Group[]}){
 const chart=cardChartData(groups);
 if(!chart.count)return null;
 return <Box component="section" aria-label="卡片数据图表" sx={{minWidth:0}}>
  <Typography variant="subtitle2" component="h3">卡片分布与对比</Typography>
  <Typography variant="caption" color="text.secondary">仅统计下方预览的 {chart.count} 张卡片，每个分组最多 5 张。</Typography>
  <Typography variant="body2" sx={{mt:2,mb:1,fontWeight:600}}>状态分布</Typography>
  <Box role="img" aria-label={chart.statuses.map(s=>`${s.label} ${s.count} 张`).join('，')} sx={{display:'flex',height:12,gap:'2px',overflow:'hidden',borderRadius:.75}}>{chart.statuses.map(s=><Box key={s.key} sx={{width:`${s.count/chart.count*100}%`,backgroundColor:s.color}}/>)}</Box>
  <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{mt:1}}>{chart.statuses.map(s=><Typography key={s.key} variant="caption" sx={{display:'flex',alignItems:'center',gap:.6}}><Box component="span" aria-hidden="true" sx={{width:7,height:7,borderRadius:'50%',bgcolor:s.color}}/>{s.label} {s.count}</Typography>)}</Stack>
  <Typography variant="body2" sx={{mt:3,fontWeight:600}}>近 30 天消费对比</Typography>
  <Typography variant="caption" color="text.secondary">同币种、同统计区间比较已入账消费</Typography>
  {chart.series.map((group,index)=><Box key={index} sx={{mt:2}}>
   <Typography variant="caption" color="text.secondary" title={`${group.from} — ${group.to}`}>{group.currency} · {group.from.slice(0,10)} — {group.to.slice(0,10)}（UTC）</Typography>
   <Stack spacing={1.5} sx={{mt:1}}>{group.items.map(({card,connection,width})=><Box key={`${connection}:${card.id}`}>
    <Stack direction="row" justifyContent="space-between" gap={1} alignItems="baseline"><Button component={Link} to={`/portal/cards/${card.id}?${new URLSearchParams({connection,back:'/portal'})}`} sx={{p:0,minWidth:0,fontSize:12,textAlign:'left',justifyContent:'flex-start',overflowWrap:'anywhere'}}>{card.cardName||card.name||'卡片'} · {card.cardLast4||card.last4||'尾号未知'}</Button><Typography variant="caption" sx={{maxWidth:'48%',flexShrink:0,minWidth:0,overflowWrap:'anywhere',textAlign:'right',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{cardMetricDisplay(card.metrics,'spending').value}</Typography></Stack>
    <Box aria-hidden="true" sx={{height:7,mt:.5,bgcolor:'action.hover',borderRadius:.5,overflow:'hidden'}}><Box sx={{height:'100%',width:`${width}%`,bgcolor:'primary.main',borderRadius:.5}}/></Box>
   </Box>)}</Stack>
  </Box>)}
  {!chart.series.length&&<Typography variant="body2" color="text.secondary" sx={{mt:1.5}}>暂无完整消费数据可供比较。</Typography>}
  {chart.excluded>0&&<Typography variant="caption" color="text.secondary" sx={{display:'block',mt:1.5}}>{chart.excluded} 张卡片的消费数据不完整，未计入对比。</Typography>}
 </Box>;
}
type TrendRow={id:string;cardId?:string;amountCents?:string;date?:string;status?:string;detailedStatus?:string};
export function dailySpending(rows:TrendRow[],card:Card){
 const m=card.metrics;
 if(!m||m.coverage!=='complete'||m.currency!=='USD'||m.scale!==2||!m.from||!m.to||!m.spendingMinor||!/^\d+$/.test(m.spendingMinor))throw new Error('该卡暂无完整的美元消费统计。');
 const from=Date.parse(m.from),to=Date.parse(m.to),day=86400000;
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>31*day)throw new Error('统计区间无效。');
 const start=Math.floor(from/day)*day,end=Math.ceil(to/day)*day;
 const days=Array.from({length:(end-start)/day},(_,i)=>({date:new Date(start+i*day).toISOString().slice(0,10),amount:0n,height:0}));
 const seen=new Set<string>();let total=0n;
 for(const row of rows){
  const at=Date.parse(row.date||'');
  if(seen.has(row.id)||row.cardId!==card.id||row.status!=='posted'||row.detailedStatus!=='settled'||!/^-[0-9]+$/.test(row.amountCents||'')||!Number.isFinite(at)||at<from||at>=to)throw new Error('消费明细已变化，请刷新后重试。');
  seen.add(row.id);const amount=-BigInt(row.amountCents!);total+=amount;days[Math.floor((at-start)/day)].amount+=amount;
 }
 if(total!==BigInt(m.spendingMinor))throw new Error('消费明细与汇总暂未一致，请刷新数据后重试。');
 const max=days.reduce((v,d)=>d.amount>v?d.amount:v,0n);
 return days.map(d=>({...d,height:max===0n?0:Number(d.amount*10000n/max)/100}));
}
function SpendingTrend({groups,customerId}:{groups:Group[];customerId:string}){
 const options=groups.filter(g=>!g.error).flatMap(g=>g.rows.slice(0,5).map(card=>({card,connection:g.connection.id,key:JSON.stringify([g.connection.id,card.id])})));
 const [chosen,setChosen]=useState(''),[days,setDays]=useState<ReturnType<typeof dailySpending>|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState(0);
 const option=options.find(o=>o.key===chosen)||options[0];
 const card=option?.card,connection=option?.connection;
 useEffect(()=>{
  let active=true;setDays(null);setError('');
  if(!card||!connection)return;
  const load=async()=>{try{
   const m=card.metrics;
   if(m?.coverage!=='complete'||m.currency!=='USD'||m.scale!==2||!m.from||!m.to)throw new Error('该卡消费数据尚不完整，暂无法绘制趋势。');
   const rows:TrendRow[]=[];let total:number|undefined,revision:string|undefined;
   for(let page=0;;page++){
    if(!active)return;
    const q=new URLSearchParams({page:String(page),cardId:card.id,metric:'spending',from:m.from,to:m.to});if(revision)q.set('revision',revision);
    const result=await liveGet<{rows:TrendRow[];total:number;revision:string}>(`/client-api/v1/customers/${customerId}/card-projections/${connection}/transactions?${q}`);
    if(!active)return;
    if(!Number.isSafeInteger(result.total)||result.total<0||result.total>5000||total!==undefined&&result.total!==total||revision!==undefined&&result.revision!==revision)throw new Error('记录过多或数据已更新，请到卡片详情查询。');
    total=result.total;revision=result.revision;rows.push(...result.rows);
    if(rows.length===total)break;
    if(rows.length>total||result.rows.length!==20)throw new Error('消费明细未读取完整，请重试。');
   }
   const result=dailySpending(rows,card);if(active){setDays(result);setSelected(result.length-1)}
  }catch(e){if(active)setError(authMessage(e))}};
  void load();return()=>{active=false};
 },[card,connection,customerId,retry]);
 const money=(n:bigint)=>`USD ${n/100n}.${(n%100n).toString().padStart(2,'0')}`;
 if(!option)return null;
 return <Box component="section" aria-label="每日消费趋势" sx={{minWidth:0}}>
  <Typography variant="subtitle2" component="h3">每日消费趋势</Typography>
  <Typography variant="caption" color="text.secondary">近 30 天 · 已入账消费 · UTC</Typography>
  <Box component="select" aria-label="选择趋势卡片" value={option.key} onChange={(e:React.ChangeEvent<HTMLSelectElement>)=>setChosen(e.target.value)} sx={{display:'block',width:'100%',minWidth:0,mt:1.5,mb:2,p:1,border:1,borderColor:'divider',borderRadius:1,bgcolor:'background.paper',color:'text.primary',font:'inherit',fontSize:13}}>{options.map(o=><option key={o.key} value={o.key}>{o.card.cardName||o.card.name||'卡片'} · {o.card.cardLast4||o.card.last4||'尾号未知'}</option>)}</Box>
  {error?<Alert severity="info" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>:!days?<Typography role="status" variant="body2">正在读取每日消费…</Typography>:<>
   <Typography variant="body2" aria-live="polite" sx={{mb:1,fontVariantNumeric:'tabular-nums'}}>{days[selected]?.date} · {money(days[selected]?.amount||0n)}</Typography>
   <Typography variant="caption" color="text.secondary" sx={{display:'block',textAlign:'right'}}>刻度上限 {money(days.reduce((max,d)=>d.amount>max?d.amount:max,0n))}</Typography>
   <Box sx={{display:'flex',alignItems:'stretch',gap:'3px',height:220,borderBottom:1,borderColor:'divider',backgroundImage:'linear-gradient(to top, transparent calc(100% - 1px), #e7ebf0 1px)',backgroundSize:'100% 50%'}}>{days.map((d,i)=><Box component="button" key={d.date} onClick={()=>setSelected(i)} onFocus={()=>setSelected(i)} aria-label={`${d.date} ${money(d.amount)}`} title={`${d.date} ${money(d.amount)}`} sx={{flex:1,minWidth:0,p:0,border:0,bgcolor:'transparent',display:'flex',alignItems:'flex-end',cursor:'pointer','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main',outlineOffset:2}}}><Box sx={{width:'100%',height:`${d.height}%`,minHeight:d.amount>0n?2:0,bgcolor:i===selected?'primary.dark':'primary.main',opacity:i===selected?1:.65,borderRadius:'2px 2px 0 0'}}/></Box>)}</Box>
   <Stack direction="row" justifyContent="space-between" sx={{mt:.5}}>{[0,Math.floor(days.length/2),days.length-1].map(i=><Typography key={i} variant="caption" color="text.secondary">{days[i].date.slice(5)}</Typography>)}</Stack>
   <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:1}}>点击柱查看金额 · 首尾日期按统计窗口计算</Typography>
  </>}
 </Box>;
}
function CardDataIcon({kind,size=16}:{kind:'cards'|'available'|'spending';size?:number}){
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{flexShrink:0}}>{kind==='cards'?<><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 11h18M7 16h4M6 3h12"/></>:kind==='available'?<><circle cx="12" cy="12" r="9"/><path d="M15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9M12 6v12"/></>:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 17v-3M12 17v-2M17 17v-4"/></>}</svg>;
}
export default function CardOverview({customerId,reload=0}:{customerId:string;reload?:number}){
 const [groups,setGroups]=useState<Group[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;setGroups(null);setError('');
  const base=`/client-api/v1/customers/${customerId}/card-projections`;
  const load=async()=>{try{
   const connections=await liveGet<Connection[]>(base);
   const result=await Promise.all(connections.map(async connection=>{
    try{const data=await liveGet<{rows:Card[];total:number}>(`${base}/${connection.id}/cards?${new URLSearchParams({page:'0',revision:connection.revision})}`);return {connection,...data};}
    catch(e){return {connection,rows:[],total:0,error:authMessage(e)}}
   }));
   if(active)setGroups(result);
  }catch(e){if(active)setError(authMessage(e))}};
  void load();return()=>{active=false};
 },[customerId,reload,retry]);
 const knownTotal=groups?.every(g=>!g.error)?groups.reduce((n,g)=>n+g.total,0):null;
 return <Stack spacing={3} sx={{minWidth:0}}>
 {groups&&groups.some(g=>g.rows.length>0)&&<Paper variant="outlined" component="section" aria-label="消费分析" sx={{p:{xs:2.5,md:3}}}>
  <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1} sx={{mb:2.5}}><Typography variant="h6" component="h2">消费分析</Typography><Typography variant="caption" color="text.secondary">已入账消费，不含退款与费用</Typography></Stack>
  <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',md:'minmax(0,1.65fr) minmax(280px,1fr)'},gap:{xs:3,md:4}}}>
   <SpendingTrend groups={groups} customerId={customerId}/>
   <Box sx={{minWidth:0,borderLeft:{md:'1px solid #e7ebf0'},borderTop:{xs:'1px solid #e7ebf0',md:0},pl:{md:3},pt:{xs:3,md:0}}}><OverviewCharts groups={groups}/></Box>
  </Box>
 </Paper>}
 <Paper variant="outlined" component="section" aria-label="我的卡片" sx={{p:{xs:2.5,md:3},minWidth:0}}><Stack spacing={2}>
  <Stack direction="row" alignItems="center" gap={1} justifyContent="space-between"><Box><Typography variant="h6" component="h2" sx={{display:'flex',alignItems:'center',gap:1}}><Box component="span" sx={{display:'flex',color:'primary.main'}}><CardDataIcon kind="cards" size={22}/></Box>我的卡片</Typography><Typography variant="caption" color="text.secondary">{knownTotal===null?'额度与近期消费一览':`${knownTotal} 张已授权卡片`}</Typography></Box><Button component={Link} to="/portal/cards">管理卡片 →</Button></Stack>
  {error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>:!groups?<Typography role="status">正在读取卡片…</Typography>:groups.length===0?<Box sx={{py:2}}><Typography>暂无已授权的卡片。</Typography><Typography variant="body2" color="text.secondary" sx={{mt:1}}>先了解可申请的卡片，再查看申请进度。</Typography><Button component={Link} to="/portal/cards/new">查看可申请卡片 →</Button></Box>:groups.map(group=><Stack key={group.connection.id} spacing={0}>
   {group.error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>部分卡片读取失败：{group.error}</Alert>:<>
    <Typography variant="caption" color="text.secondary">预览 {Math.min(group.rows.length,5)} / {group.total} 张</Typography>
    <Box sx={{display:{xs:'none',md:'grid'},gridTemplateColumns:'minmax(0,1.2fr) minmax(0,1fr)',gap:3,pt:1.5,pb:1,borderBottom:1,borderColor:'divider'}}><Typography variant="caption" color="text.secondary">卡片 / 状态</Typography><Box sx={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1.5}}><Typography variant="caption" color="text.secondary">可消费额度</Typography><Typography variant="caption" color="text.secondary">近 30 天消费</Typography></Box></Box>
    {group.rows.slice(0,5).map(card=><Box key={card.id} sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',md:'minmax(0,1.2fr) minmax(0,1fr)'},gap:{xs:1,md:3},alignItems:'center',py:1.5,borderBottom:1,borderColor:'divider'}}>
     <Stack direction="row" gap={1} alignItems="center"><Box sx={{color:'primary.main',display:'flex',flexShrink:0}}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/></svg></Box><Button component={Link} sx={{minWidth:0,justifyContent:'flex-start',textAlign:'left',overflowWrap:'anywhere',lineHeight:1.5,flex:1}} to={`/portal/cards/${card.id}?${new URLSearchParams({connection:group.connection.id,back:'/portal'})}`}>{card.cardName||card.name||'卡片'} · {card.cardLast4||card.last4||'尾号未知'}</Button><ChannelCardStatus status={card.cardStatus}/></Stack>
     <Box sx={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1.5,mt:{xs:.5,md:0}}}>{(['available','spending'] as const).map(kind=><Box key={kind}><Typography variant="caption" color="text.secondary" sx={{display:{xs:'flex',md:'none'},alignItems:'center',gap:.75,mb:.5}}><Box component="span" sx={{display:'flex',color:kind==='available'?'primary.main':'text.secondary'}}><CardDataIcon kind={kind}/></Box>{kind==='available'?'可消费额度':'近 30 天消费'}</Typography><Typography variant="body2" title={cardMetricDisplay(card.metrics,kind).help} sx={{fontWeight:600,fontVariantNumeric:'tabular-nums',overflowWrap:'anywhere'}}>{cardMetricDisplay(card.metrics,kind).value}</Typography></Box>)}</Box>
    </Box>)}
    {!group.rows.length&&<Typography color="text.secondary" sx={{py:2}}>当前没有已授权卡片。</Typography>}
   </>}
  </Stack>)}
  <Typography variant="caption" color="text.secondary">可消费额度受卡片规则限制，不计入钱包余额。完整卡片和统计时间可在详情查看。</Typography>
 </Stack></Paper></Stack>;
}

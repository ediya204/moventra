import ChannelCardStatus from '../../../../packages/shared/src/components/ChannelCardStatus';
import {useEffect,useState} from 'react';
import {Alert,Button,Paper,Stack,Typography} from '@mui/material';
import {Link} from 'react-router-dom';
import {liveGet,authMessage} from '../../../../packages/shared/src/auth/liveApi';
import {type CardSyncInfo} from '../../../../packages/shared/src/auth/cardSnapshotContract';

type Connection={id:string;label:string;revision:string};
type Card=CardSyncInfo & {id:string;name?:string;last4?:string;cardStatus?:string};
type Group={connection:Connection;rows:Card[];total:number;error?:string};
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
 return <Paper variant="outlined" sx={{p:{xs:2,md:3},minWidth:0}}><Stack spacing={2}>
  <Stack direction={{xs:"column",sm:"row"}} gap={1} justifyContent="space-between"><Typography variant="h6">我的卡片</Typography><Button component={Link} to="/portal/cards">查看全部卡片</Button></Stack>
  <Typography variant="body2" color="text.secondary">仅展示已授权卡片，每个来源预览前 5 张；状态以最近一次渠道核验为准。</Typography>
  {error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{error}</Alert>:!groups?<Typography>正在读取卡片…</Typography>:groups.length===0?<Typography>暂无已授权的卡片来源。</Typography>:groups.map(group=><Stack key={group.connection.id} spacing={1}>
   <Typography variant="subtitle2">{group.connection.label}{!group.error?` · ${group.total} 张`:''}</Typography>
   {group.error?<Alert severity="error" action={<Button onClick={()=>setRetry(n=>n+1)}>重试</Button>}>{group.error}</Alert>:<>
    {group.rows.slice(0,5).map(card=><Stack key={card.id} direction={{xs:'column',sm:'row'}} spacing={1} justifyContent="space-between" alignItems={{xs:"flex-start",sm:"center"}} sx={{py:1,borderBottom:1,borderColor:"divider"}}>
     <Button component={Link} to={`/portal/cards/${card.id}?${new URLSearchParams({connection:group.connection.id,back:'/portal/cards'})}`}>{card.name||'卡片'} · {card.last4?`•••• ${card.last4}`:'尾号未知'}</Button>
     <ChannelCardStatus status={card.cardStatus}/>
    </Stack>)}
    {!group.rows.length&&<Typography color="text.secondary">该来源暂无已授权卡片。</Typography>}
    <Button component={Link} to={`/portal/cards?${new URLSearchParams({connection:group.connection.id})}`} sx={{alignSelf:'start'}}>查看该来源全部卡片</Button>
   </>}
  </Stack>)}
  <Button component={Link} to="/portal/transactions" sx={{alignSelf:'start'}}>查看卡片消费与退款明细</Button>
 </Stack></Paper>;
}

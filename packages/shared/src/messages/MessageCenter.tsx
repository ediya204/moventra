import {useCallback,useEffect,useRef,useState} from 'react';
import {Alert,Badge,Box,Button,Chip,CircularProgress,Divider,IconButton,List,ListItemButton,ListItemText,MenuItem,Paper,Popover,Stack,TextField,Typography} from '@mui/material';
import {Icon} from '@iconify/react';
import {Link,useLocation,useSearchParams} from 'react-router-dom';
import {messageRequest,messageError} from '../auth/messageApi';
import type {Message,MessagePage,MessageSummary} from '../auth/messageContract';
import {cryptoMoney} from '../auth/cryptoContract';
const labels:Record<string,string>={otc:'OTC',letter:'站内信',system:'系统消息'};
const icons:Record<string,string>={otc:'solar:transfer-horizontal-linear',letter:'solar:letter-linear',system:'solar:bell-linear'};
export const messageTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const changed=()=>window.dispatchEvent(new Event('moventra:messages'));
function useRefresh(load:()=>Promise<void>){
 useEffect(()=>{
  let delay=30000,active=true,running=false,rerun=false,timer:ReturnType<typeof setTimeout>;
  const run=async()=>{
   if(!active)return;
   if(running){rerun=true;return}
   clearTimeout(timer);
   if(document.visibilityState==='hidden'){timer=setTimeout(run,30000);return}
   running=true;
   try{await load();delay=30000}catch{delay=Math.min(delay*2,120000)}
   finally{running=false;if(active){const wait=rerun?0:delay;rerun=false;timer=setTimeout(run,wait)}}
  };
  const wake=()=>{void run()};void run();window.addEventListener('moventra:messages',wake);document.addEventListener('visibilitychange',wake);
  return()=>{active=false;clearTimeout(timer);window.removeEventListener('moventra:messages',wake);document.removeEventListener('visibilitychange',wake)};
 },[load]);
}
export function MessageBell({customerId}:{customerId:string}){
 const [summary,setSummary]=useState<MessageSummary|null>(null),[items,setItems]=useState<Message[]>([]),[error,setError]=useState(''),[anchor,setAnchor]=useState<HTMLElement|null>(null);
 const version=useRef(0);useEffect(()=>()=>{version.current++},[]);
 const base=`/client-api/v1/customers/${customerId}/messages`;
 const load=useCallback(async()=>{const v=++version.current;try{const data=await messageRequest<MessagePage>(base+'?limit=5');if(v===version.current){setSummary(data.summary);setItems(data.items);setError('')}}catch(e){if(v===version.current)setError(messageError(e));throw e}},[base]);useRefresh(load);
 return <><IconButton aria-label={error?'消息暂不可读取':`消息中心${summary?`，${summary.unread}条未读`:''}`} onClick={e=>setAnchor(e.currentTarget)}><Badge badgeContent={error?'!':summary?.unread} max={99} color={error?'warning':'primary'}><Icon icon="solar:bell-linear" width={24}/></Badge></IconButton><Popover open={!!anchor} anchorEl={anchor} onClose={()=>setAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'right'}} transformOrigin={{vertical:'top',horizontal:'right'}}><Box sx={{p:2,width:340,maxWidth:'90vw'}}><Typography variant="h6">消息中心</Typography>{error?<Alert severity="warning">{error}</Alert>:!summary?<CircularProgress size={20}/>:!items.length?<Typography sx={{py:2}} color="text.secondary">暂无消息</Typography>:<List>{items.map(m=><ListItemButton key={m.id} component={Link} to={`/portal/messages/${m.id}`} onClick={()=>setAnchor(null)}><ListItemText primary={`${m.readAt?'':'• '}${m.title}`} secondary={messageTime(m.deliveredAt)}/></ListItemButton>)}</List>}<Button fullWidth component={Link} to="/portal/messages" onClick={()=>setAnchor(null)}>查看全部消息</Button></Box></Popover></>;
}
function Facts({message}:{message:Message}){
 const f=message.facts;const amount=(value:string|undefined,currency:string|undefined)=>value&&/^\d+$/.test(value)&&['USD','USDT'].includes(currency||'')?cryptoMoney(value,currency!):'暂不可用';
 return message.category==='otc'?<Paper variant="outlined" sx={{p:2}}><Typography variant="subtitle2">通知发出时的订单信息</Typography><Stack gap={1} sx={{mt:1}}><Typography variant="body2">卖出：{amount(f.amountMinor,f.currency)}</Typography><Typography variant="body2">买入：{amount(f.receiveMinor,f.toCurrency)}</Typography><Typography variant="body2">汇率：{f.rate||'暂不可用'} · 费用：{amount(f.feeMinor,f.currency)}</Typography><Typography variant="caption" color="text.secondary">历史通知不代表订单当前状态，请查看订单最新进度。</Typography></Stack></Paper>:null;
}
export default function MessageCenter({customerId}:{customerId:string}){
 const {pathname,search}=useLocation();const [params,setParams]=useSearchParams();const id=pathname.split('/messages/')[1]||'';const base=`/client-api/v1/customers/${customerId}/messages`;
 const [data,setData]=useState<MessagePage|null>(null),[detail,setDetail]=useState<Message|null>(null),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState('');
 const version=useRef(0),current=useRef('');const route=customerId+pathname+search;current.current=route;
 useEffect(()=>()=>{version.current++},[]);
 const query=new URLSearchParams();for(const key of ['category','status','q','cursor']){const v=params.get(key);if(v)query.set(key,v)}
 const queryString=query.toString();
 const load=useCallback(async()=>{const v=++version.current;try{
  if(id){const item=await messageRequest<Message>(base+'/'+id);if(v===version.current){setDetail(item);setData(null)}}else{const page=await messageRequest<MessagePage>(base+(queryString?'?'+queryString:''));if(v===version.current){setData(page);setDetail(null)}}
  if(v===version.current){setError('');setLoaded(route)}
 }catch(e){if(v===version.current){setError(messageError(e));setLoaded(route)}throw e}},[base,id,queryString,route]);useRefresh(load);
 const mark=useCallback(async(messageId:string,snapshot?:string)=>{
  const at=current.current;setBusy(true);setActionError('');try{await messageRequest<MessageSummary>(base+(messageId?'/'+messageId+'/read':'/read-all'),messageId?{}:{snapshotToken:snapshot});if(current.current===at){if(messageId)setDetail(d=>d?.id===messageId?{...d,readAt:new Date().toISOString()}:d);changed();await load()}}catch(e){if(current.current===at)setActionError(messageError(e))}finally{if(current.current===at)setBusy(false)}
 },[base,load]);
 const autoRead=useRef('');useEffect(()=>{if(loaded===route&&detail&&!detail.readAt&&autoRead.current!==detail.id){autoRead.current=detail.id;void mark(detail.id)}},[detail,loaded,route,mark]);
 useEffect(()=>{setBusy(false);setActionError('')},[route]);
 const filter=(key:string,value:string)=>{const next=new URLSearchParams(params);next.delete('cursor');if(value)next.set(key,value);else next.delete(key);setParams(next)};
 const back=`/portal/messages${search}`;
 if(loaded!==route)return <Stack direction="row" gap={2}><CircularProgress size={20}/><Typography>正在读取消息…</Typography></Stack>;
 return <Stack spacing={2}>
  {error&&<Alert severity="warning" action={<Button onClick={()=>void load().catch(()=>{})}>重试</Button>}>{error}</Alert>}
  {actionError&&<Alert severity="error" action={id?<Button disabled={busy} onClick={()=>void mark(id)}>重试已读</Button>:undefined}>{actionError}</Alert>}
  {id?<><Button component={Link} to={back} sx={{alignSelf:'flex-start'}}>返回消息列表</Button>{detail&&!error&&<Paper variant="outlined" sx={{p:{xs:2,md:3}}}><Stack spacing={2}><Stack direction="row" gap={1}><Chip size="small" label={labels[detail.category]}/>{detail.priority==='high'&&<Chip size="small" color="warning" label="重要"/>}<Chip size="small" variant="outlined" label={detail.readAt?'已读':'未读'}/></Stack><Typography variant="h5">{detail.title}</Typography><Typography variant="caption" color="text.secondary">{detail.category==='letter'?'Moventra 运营':'Moventra 系统'} · 发生于 {messageTime(detail.occurredAt)} · 收到于 {messageTime(detail.deliveredAt)}</Typography><Divider/><Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.body}</Typography><Facts message={detail}/>{detail.orderId&&<Button component={Link} to={`/portal/funds/orders/${detail.orderId}`} state={{messageReturn:pathname+search}} variant="outlined" sx={{alignSelf:'flex-start'}}>查看订单</Button>}</Stack></Paper>}</>:<>
   <Stack direction={{xs:'column',sm:'row'}} gap={1} alignItems={{sm:'center'}}><Chip variant="outlined" label={data&&!error?`${data.summary.unread} 条未读`:'未读数暂不可用'}/><Box sx={{flex:1}}/><Button disabled={busy||!data||!!error||data.summary.unread===0} onClick={()=>void mark('',data?.summary.snapshotToken)}>全部标为已读</Button></Stack><Typography variant="caption" color="text.secondary">全部已读适用于所有分类中本次列表读取前收到的消息。</Typography>
   <Stack direction={{xs:'column',sm:'row'}} gap={1}><TextField select SelectProps={{displayEmpty:true}} InputLabelProps={{shrink:true}} size="small" label="分类" value={params.get('category')||''} onChange={e=>filter('category',e.target.value)} sx={{minWidth:130}}>{[['','全部分类'],...Object.entries(labels)].map(([v,l])=><MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField><TextField select SelectProps={{displayEmpty:true}} InputLabelProps={{shrink:true}} size="small" label="状态" value={params.get('status')||''} onChange={e=>filter('status',e.target.value)} sx={{minWidth:130}}>{[['','全部状态'],['unread','未读'],['read','已读']].map(([v,l])=><MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField><TextField size="small" label="搜索标题或订单号" defaultValue={params.get('q')||''} key={params.get('q')||''} inputProps={{maxLength:100}} onKeyDown={e=>{if(e.key==='Enter')filter('q',(e.target as HTMLInputElement).value)}} onBlur={e=>{if(e.target.value!==(params.get('q')||''))filter('q',e.target.value)}} sx={{flex:1}}/><Button onClick={()=>setParams({})}>清除筛选</Button></Stack>
   {!error&&data&&<Paper variant="outlined">{data.items.length?<List disablePadding>{data.items.map(m=><Box component="li" key={m.id} sx={{display:"flex",alignItems:"center",borderBottom:1,borderColor:"divider"}}><ListItemButton component={Link} to={`/portal/messages/${m.id}${search}`} sx={{p:2,gap:2,minWidth:0,borderBottom:0,borderColor:'divider',alignItems:'flex-start'}}><Box sx={{pt:.5,color:'primary.main'}}><Icon icon={icons[m.category]} width={24}/></Box><ListItemText disableTypography primary={<Stack direction="row" flexWrap="wrap" gap={1} alignItems="center"><Typography fontWeight={m.readAt?400:700} sx={{overflowWrap:'anywhere'}}>{m.title}</Typography>{!m.readAt&&<Chip size="small" label="未读"/>}{m.priority==='high'&&<Chip size="small" color="warning" label="重要"/>}</Stack>} secondary={<><Typography component="span" variant="body2" sx={{display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:{xs:200,sm:500}}}>{m.body}</Typography><Typography component="span" variant="caption">{labels[m.category]} · {messageTime(m.deliveredAt)}</Typography></>}/></ListItemButton>{!m.readAt&&<Button size="small" sx={{flexShrink:0,mr:1}} disabled={busy} onClick={()=>void mark(m.id)}>标为已读</Button>}</Box>)}</List>:<Box sx={{p:4,textAlign:'center'}}><Typography>{queryString?'没有符合条件的消息':'暂无消息'}</Typography><Typography variant="body2" color="text.secondary">{queryString?'清除筛选后查看其他消息。':'业务进度更新和站内信会显示在这里。'}</Typography></Box>}</Paper>}
   <Stack direction="row" justifyContent="space-between"><Button disabled={!params.has('cursor')} onClick={()=>{const p=new URLSearchParams(params);p.delete('cursor');setParams(p)}}>返回第一页</Button><Button disabled={!data?.nextCursor||!!error} onClick={()=>{const p=new URLSearchParams(params);p.set('cursor',data!.nextCursor);setParams(p)}}>下一页</Button></Stack>
  </>}
 </Stack>;
}

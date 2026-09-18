import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Checkbox,Chip,CircularProgress,Dialog,DialogActions,DialogContent,DialogTitle,FormControlLabel,MenuItem,Paper,Stack,TextField,Typography} from '@mui/material';
import {Link,Navigate,useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {messageRequest,messageError} from '../../../../packages/shared/src/auth/messageApi';
import type {Campaign,MessageDraft,MessageScope,Receipt} from '../../../../packages/shared/src/auth/messageContract';
const base='/admin-api/v1/message-campaigns';
const empty=():MessageDraft=>({title:'',body:'',priority:'normal',customerIds:[],revision:0});
const time=(v:string|null)=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—';
const states:Record<string,string>={draft:'草稿',published:'已发布',pending:'待投递',delivered:'已入收件箱',failed:'投递失败',skipped:'资格变化，已跳过'};
export default function MessagesPage(){
 const {ready,authenticated,session}=useAuth();const location=useLocation();const navigate=useNavigate();
 if(!ready)return <CircularProgress/>;if(!authenticated||!session?.operator||!session.mfaVerified)return <Navigate to="/session" replace/>;
 return <DashboardLayout production><Workspace key={session.id+location.pathname} actor={session.id} navigate={navigate}/></DashboardLayout>;
}
function Workspace({actor,navigate}:{actor:string;navigate:ReturnType<typeof useNavigate>}){
 const {pathname}=useLocation();const [params,setParams]=useSearchParams();const part=pathname.split('/operations/messages/')[1]||'';const id=part.split('/')[0];const isNew=id==='new',receipts=part.endsWith('/recipients');const page=Number(params.get('page')||0);
 const [scopes,setScopes]=useState<MessageScope[]>([]),[items,setItems]=useState<Campaign[]>([]),[total,setTotal]=useState(0),[campaign,setCampaign]=useState<Campaign|null>(null),[rows,setRows]=useState<Receipt[]>([]),[draft,setDraft]=useState<MessageDraft>(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false),[reload,setReload]=useState(0);
 const generation=useRef(0);const pendingKey=`moventra:message-create:${actor}`;
 const [createKey]=useState(()=>{try{return sessionStorage.getItem(pendingKey)||crypto.randomUUID()}catch{return crypto.randomUUID()}});
 const [pending,setPending]=useState(()=>{try{return !!sessionStorage.getItem(pendingKey)}catch{return false}});
 const refresh=()=>setReload(n=>n+1);
 useEffect(()=>{let active=true;const g=++generation.current;setLoading(true);setError('');async function load(){try{
  const all=await messageRequest<MessageScope[]>(base+'/scopes');if(!active)return;setScopes(all);
  if(id&&!isNew){const c=await messageRequest<Campaign>(base+'/'+id);if(!active)return;setCampaign(c);setDraft({title:c.title,body:c.body,priority:c.priority,customerIds:c.customerIds,revision:c.revision});if(receipts){const result=await messageRequest<{items:Receipt[]}>(base+'/'+id+'/recipients?page='+page);if(active)setRows(result.items)}}
  else if(!isNew){const result=await messageRequest<{items:Campaign[];total:number}>(base+'?page='+page);if(active){setItems(result.items);setTotal(result.total)}}
 }catch(e){if(active)setError(messageError(e))}finally{if(active)setLoading(false)}}void load();return()=>{active=false;if(g===generation.current)generation.current++}},[id,isNew,receipts,page,reload]);
 const can=(permission:string)=>draft.customerIds.length>0&&draft.customerIds.every(id=>scopes.find(s=>s.id===id)?.permissions.includes(permission));
 async function action(run:()=>Promise<void>){const g=generation.current;setBusy(true);setError('');setNotice('');try{await run()}catch(e){if(g===generation.current)setError(messageError(e))}finally{if(g===generation.current)setBusy(false)}}
 async function save(){await action(async()=>{
  if(isNew){sessionStorage.setItem(pendingKey,createKey);setPending(true)}
  const result=await messageRequest<Campaign>(isNew?base:base+'/'+id+'/draft',draft,isNew?createKey:undefined);
  if(isNew){sessionStorage.removeItem(pendingKey);setPending(false);navigate('/operations/messages/'+result.id)}else{setCampaign(result);setDraft({...draft,revision:result.revision});setNotice('草稿已保存。')}
 })}
 async function recover(){await action(async()=>{const result=await messageRequest<Campaign>(base+'/requests/'+createKey);sessionStorage.removeItem(pendingKey);setPending(false);navigate('/operations/messages/'+result.id)})}
 async function publish(){await action(async()=>{const result=await messageRequest<Campaign>(base+'/'+id+'/publish',{revision:campaign!.revision},id);setCampaign(result);setPreview(false);setNotice('发布任务已保存，正在分发到接收人收件箱。');refresh()})}
 const unchanged=campaign&&draft.title===campaign.title&&draft.body===campaign.body&&draft.priority===campaign.priority&&[...draft.customerIds].sort().join()===campaign.customerIds.join();
 return <Stack spacing={3}>
  <Stack direction="row" gap={1} justifyContent="space-between" alignItems="center"><Box><Typography variant="h4">{isNew?'新建站内信':receipts?'投递与阅读明细':id?'站内信详情':'消息管理'}</Typography><Typography color="text.secondary" sx={{mt:1}}>发送运营站内信，查询投递和阅读情况。</Typography></Box>{!id&&<Button component={Link} to="/operations/messages/new" variant="contained">新建站内信</Button>}</Stack>
  {id&&<Button component={Link} to={receipts?'/operations/messages/'+id:'/operations/messages'} sx={{alignSelf:'flex-start'}}>返回{receipts?'消息详情':'消息列表'}</Button>}
  {error&&<Alert severity="error" action={<Button disabled={busy} onClick={refresh}>刷新</Button>}>{error}</Alert>}{notice&&<Alert severity="success">{notice}</Alert>}
  {loading?<CircularProgress size={24}/>:<>
  {!scopes.length&&<Alert severity="info">尚未分配消息权限及对应客户读取范围。</Alert>}
  {!id&&<><Stack spacing={1}>{items.map(c=><Paper key={c.id} variant="outlined" sx={{p:2}}><Stack direction="row" justifyContent="space-between" gap={1}><Box><Typography variant="subtitle1">{c.title}</Typography><Typography variant="caption" color="text.secondary">{time(c.createdAt)} · {c.customerIds.length} 位接收人</Typography></Box><Chip size="small" label={states[c.state]}/></Stack><Typography variant="body2" sx={{mt:1}}>已投递 {c.counts.delivered} · 已读 {c.counts.read} · 待投递 {c.counts.pending} · 失败 {c.counts.failed} · 跳过 {c.counts.skipped}</Typography><Button component={Link} to={'/operations/messages/'+c.id}>查看详情</Button></Paper>)}{!items.length&&!error&&<Alert severity="info">暂无可查看的站内信。</Alert>}</Stack><Stack direction="row" gap={1}><Button disabled={page<=0} onClick={()=>setParams({page:String(page-1)})}>上一页</Button><Typography sx={{py:1}}>共 {total} 封</Typography><Button disabled={(page+1)*20>=total} onClick={()=>setParams({page:String(page+1)})}>下一页</Button></Stack></>}
  {isNew&&pending&&<Alert severity="warning" action={<Button disabled={busy} onClick={()=>void recover()}>查询原草稿</Button>}>上次保存结果待确认，请先查询原草稿。未保存成功时可填写原内容并使用同一请求重试。</Alert>}
  {(isNew||campaign?.state==='draft')&&!receipts&&<Paper variant="outlined" sx={{p:{xs:2,md:3}}}><Stack spacing={2}>
   <TextField label="标题" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} inputProps={{maxLength:80}} disabled={busy}/><TextField label="正文" multiline minRows={6} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} inputProps={{maxLength:5000}} disabled={busy} helperText="纯文本站内信；请勿填写卡号、验证码或密钥。"/><TextField select label="优先级" value={draft.priority} onChange={e=>setDraft({...draft,priority:e.target.value as 'normal'|'high'})} disabled={busy}><MenuItem value="normal">普通</MenuItem><MenuItem value="high">重要</MenuItem></TextField>
   <Typography variant="subtitle2">接收人（{draft.customerIds.length}/100）</Typography><Box sx={{maxHeight:260,overflowY:'auto'}}>{scopes.filter(s=>s.permissions.includes('compose')).map(s=><FormControlLabel key={s.id} sx={{display:'flex'}} control={<Checkbox checked={draft.customerIds.includes(s.id)} disabled={busy||!draft.customerIds.includes(s.id)&&draft.customerIds.length>=100} onChange={e=>setDraft({...draft,customerIds:e.target.checked?[...draft.customerIds,s.id]:draft.customerIds.filter(v=>v!==s.id)})}/>} label={s.name}/>)}</Box>
   <Stack direction="row" gap={1}><Button disabled={busy||!can('compose')||!draft.title.trim()||!draft.body.trim()} variant="outlined" onClick={()=>void save()}>{busy?'处理中…':'保存草稿'}</Button>{campaign&&<Button variant="contained" disabled={busy||!unchanged||!can('publish')} onClick={()=>setPreview(true)}>预览发送</Button>}</Stack>{campaign&&!unchanged&&<Typography variant="caption">修改后请先保存草稿，再预览发送。</Typography>}
  </Stack></Paper>}
  {campaign?.state==='published'&&!receipts&&<Paper variant="outlined" sx={{p:3}}><Stack spacing={2}><Typography variant="h5">{campaign.title}</Typography><Chip label="已发布" sx={{alignSelf:'flex-start'}}/><Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{campaign.body}</Typography><Typography variant="body2">已入收件箱 {campaign.counts.delivered} · 已读 {campaign.counts.read} · 待投递 {campaign.counts.pending} · 失败 {campaign.counts.failed} · 跳过 {campaign.counts.skipped}</Typography><Stack direction="row" gap={1}><Button component={Link} to={'/operations/messages/'+id+'/recipients'}>查看投递明细</Button><Button onClick={refresh}>刷新进度</Button>{campaign.counts.failed>0&&<Button disabled={busy||!can('retry')||!can('publish')} onClick={()=>void action(async()=>{await messageRequest(base+'/'+id+'/retry-failed',{});setNotice('失败投递已重新排队。');refresh()})}>重试失败投递</Button>}</Stack><Typography variant="caption" color="text.secondary">发送后正文不可修改。投递完成表示已进入收件箱，不等于客户已阅读。</Typography></Stack></Paper>}
  {receipts&&campaign&&<><Stack spacing={1}>{rows.map(r=><Paper key={r.customerId} variant="outlined" sx={{p:2}}><Typography variant="subtitle2">{r.name}</Typography><Typography variant="body2">{states[r.state]} · 尝试 {r.attempts} 次</Typography><Typography variant="caption">入箱：{time(r.deliveredAt)} · 阅读：{time(r.readAt)}</Typography>{r.error&&<Typography variant="body2" color="text.secondary">{r.state==='skipped'?'接收资格或发送权限已变化。':'投递暂不可用，可重试原任务。'}</Typography>}</Paper>)}</Stack><Stack direction="row" gap={1}><Button disabled={page<=0} onClick={()=>setParams({page:String(page-1)})}>上一页</Button><Button onClick={refresh}>刷新</Button><Button disabled={(page+1)*20>=campaign.customerIds.length} onClick={()=>setParams({page:String(page+1)})}>下一页</Button></Stack></>}
  </>}
  <Dialog open={preview} onClose={()=>{if(!busy)setPreview(false)}} fullWidth><DialogTitle>确认发送站内信</DialogTitle><DialogContent><Stack spacing={2}><Typography variant="h6">{campaign?.title}</Typography><Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{campaign?.body}</Typography><Typography>接收人：{campaign?.customerIds.length} 位</Typography><Typography variant="body2">{campaign?.customerIds.map(id=>scopes.find(s=>s.id===id)?.name||id).join('、')}</Typography><Alert severity="info">确认后正文和接收人将固定，系统按此版本分发。</Alert>{error&&<Alert severity="error">{error}</Alert>}</Stack></DialogContent><DialogActions><Button disabled={busy} onClick={()=>setPreview(false)}>返回编辑</Button><Button disabled={busy} variant="contained" onClick={()=>void publish()}>{busy?'正在提交…':'确认发送'}</Button></DialogActions></Dialog>
 </Stack>;
}

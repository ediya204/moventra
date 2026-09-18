import {useRef,useState} from 'react';
import {Alert,Button,Dialog,DialogActions,DialogContent,DialogTitle,Stack,Typography} from '@mui/material';
import {authMessage,liveCardAction} from '../auth/liveApi';
import type {CardSyncInfo} from '../auth/cardSnapshotContract';

type Action='activate'|'pause'|'close';
const defaultLabels:Record<Action,string>={activate:'启用卡片',pause:'停用卡片',close:'注销卡片'};
export default function CardControls({path,row,onRefresh,pauseLabel='停用卡片',layout='row'}:{layout?:'row'|'grid';pauseLabel?:string;path:string;row:CardSyncInfo&{cardStatus?:string;last4?:string;cardLast4?:string};onRefresh:()=>void}){
 const labels={...defaultLabels,pause:pauseLabel};
 const [more,setMore]=useState(false);
 const [selected,setSelected]=useState<Action|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const attempt=useRef<{fingerprint:string;key:string}>();
 if(!row.controlsEnabled)return null;
 const pending=['queued','submitted','confirming','review'].includes(row.cardAction?.state||'');
 const choose=(action:Action)=>{attempt.current=undefined;setError('');setSelected(action)};
 const submit=async()=>{
  if(!selected||!row.cardStatus||busy||pending)return;
  const body={action:selected,expectedStatus:row.cardStatus,confirmClose:selected==='close'};
  const fingerprint=JSON.stringify(body);
  if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,key:crypto.randomUUID()};
  setBusy(true);setError('');
  try{await liveCardAction(path,body,attempt.current.key);setSelected(null);onRefresh()}
  catch(e){setError(authMessage(e))}finally{setBusy(false)}
 };
 return <Stack spacing={1}>
  {pending&&<Alert severity={row.cardAction?.state==='review'?'warning':'info'}>{row.cardAction?.state==='review'?'操作结果待核实，暂不能继续修改。请手动核对或联系管理员。':'操作处理中，正在等待渠道确认。'}</Alert>}
  {row.cardAction?.state==='failed'&&<Alert severity="warning">上一次操作未完成。{row.cardAction.error==='card_status_changed'?'渠道状态已变化，请核对后重新操作。':'请核对当前状态后重试。'}</Alert>}
  {row.cardStatus==='closed'?<Typography color="text.secondary">卡片已注销，历史记录继续保留。</Typography>:<Stack direction="row" useFlexGap gap={1} flexWrap="wrap" sx={layout==='grid'?{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))','& .MuiButton-root':{minHeight:42}}:undefined}>
   {['paused','inactive'].includes(row.cardStatus||'')&&<Button variant="outlined" disabled={pending||busy} onClick={()=>choose('activate')}>启用卡片</Button>}
   {row.cardStatus==='active'&&<Button variant="outlined" disabled={pending||busy} onClick={()=>choose('pause')}>{pauseLabel}</Button>}
   {['active','paused','inactive'].includes(row.cardStatus||'')&&<Button variant={layout==='grid'?'outlined':'text'} disabled={pending||busy} aria-expanded={more} onClick={()=>setMore(v=>!v)}>更多操作</Button>}
   {more&&['active','paused','inactive'].includes(row.cardStatus||'')&&<Button color="error" disabled={pending||busy} onClick={()=>choose('close')}>注销卡片</Button>}
  </Stack>}
  <Dialog open={Boolean(selected)} onClose={()=>{if(!busy)setSelected(null)}} aria-labelledby="card-control-title" fullWidth maxWidth="xs">
   <DialogTitle id="card-control-title">{selected?labels[selected]:''} · 尾号 {row.cardLast4||row.last4||'未知'}</DialogTitle>
   <DialogContent><Typography>{selected==='close'?'注销后本系统不提供恢复入口，请确认不再使用这张卡。历史交易和记录会保留。':selected==='pause'?'停用后将不能继续使用此卡消费，之后可重新启用。':'确认重新启用此卡？最终可用状态以渠道确认为准。'}</Typography>{error&&<Alert severity="error" sx={{mt:2}}>{error}</Alert>}</DialogContent>
   <DialogActions><Button disabled={busy} onClick={()=>setSelected(null)}>取消</Button><Button disabled={busy||pending} color={selected==='close'?'error':'primary'} variant="contained" onClick={()=>void submit()}>{busy?'正在提交…':'确认'+(selected?labels[selected]:'')}</Button></DialogActions>
  </Dialog>
 </Stack>;
}

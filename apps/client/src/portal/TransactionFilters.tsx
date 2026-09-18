import {useEffect,useState} from 'react';
import {Box,Button,Chip,Divider,MenuItem,Popover,Stack,TextField,Typography} from '@mui/material';
import {transactionStatuses,transactionFilterError,type TransactionFilters as Filters} from './transactionQuery';
function FilterIcon({kind}:{kind:'search'|'date'|'status'}){
 const paths={search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',date:'M5 5h14v16H5zM8 2v6m8-6V2M5 10h14',status:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'};
 return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg>;
}
export default function TransactionFilters({value,onChange}:{value:Filters;onChange:(value:Filters)=>void}){
 const [anchor,setAnchor]=useState<HTMLElement|null>(null),[kind,setKind]=useState<'date'|'status'>('date');
 const [draft,setDraft]=useState(value),[statusSearch,setStatusSearch]=useState('');
 const [keyword,setKeyword]=useState(value.keyword);
 useEffect(()=>setKeyword(value.keyword),[value.keyword]);
 const close=()=>setAnchor(null);
 const apply=(next:Filters)=>{onChange(next);close()};
 const active=Boolean(value.keyword||value.status||value.from||value.to);
 const dateLabel=value.from||value.to?`${value.from||'不限'} — ${value.to||'不限'}`:'日期';
 const error=transactionFilterError(draft);
 const preset=(days:number)=>{const end=new Date();const start=new Date(end);start.setUTCDate(start.getUTCDate()-days+1);apply({...value,from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)})};
 return <Stack spacing={1.5}>
  <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" aria-label="交易筛选">
   <Box component="form" role="search" onSubmit={event=>{event.preventDefault();onChange({...value,keyword:keyword.trim()})}} sx={{width:{xs:'100%',sm:380},maxWidth:'100%'}}>
    <TextField fullWidth size="small" placeholder="搜索商户、卡号后四位或交易 ID" value={keyword} onChange={event=>setKeyword(event.target.value)} inputProps={{'aria-label':'搜索商户、卡号后四位或交易 ID',maxLength:200}} InputProps={{startAdornment:<Box sx={{display:'flex',mr:1,color:'text.secondary'}}><FilterIcon kind="search"/></Box>,endAdornment:<Button type="submit" size="small" sx={{minWidth:44,flexShrink:0}}>搜索</Button>}} sx={{'& .MuiOutlinedInput-root':{height:38,pr:0.5,fontSize:14}}}/>
   </Box>
   {([{key:'date',label:dateLabel,active:Boolean(value.from||value.to)},{key:'status',label:value.status?`状态：${transactionStatuses[value.status]||value.status}`:'状态',active:Boolean(value.status)}] as const).map(item=><Button key={item.key} size="small" variant="outlined" startIcon={<FilterIcon kind={item.key}/>} endIcon={<span aria-hidden="true">⌄</span>} aria-haspopup="dialog" aria-expanded={Boolean(anchor)&&kind===item.key} onClick={event=>{setKind(item.key);setDraft(value);setStatusSearch('');setAnchor(event.currentTarget)}} sx={{minHeight:36,color:item.active?'primary.dark':'text.secondary',borderColor:item.active?'primary.main':'divider',bgcolor:item.active?'primary.lighter':'background.paper',maxWidth:'100%','& .MuiButton-startIcon':{ml:0},textTransform:'none'}}><Box component="span" sx={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:260}}>{item.label}</Box></Button>)}
   {active&&<Button size="small" color="inherit" onClick={()=>onChange({keyword:'',status:'',from:'',to:''})}>清空筛选</Button>}
  </Stack>
  <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close} anchorOrigin={{vertical:'bottom',horizontal:'left'}} transformOrigin={{vertical:'top',horizontal:'left'}} PaperProps={{role:'dialog','aria-label':kind==='date'?'日期筛选':'状态筛选',sx:{mt:1,width:kind==='date'?360:300,maxWidth:'calc(100vw - 32px)',border:1,borderColor:'divider',borderRadius:1.5}}}>
   <Typography variant="subtitle2" sx={{px:2,py:1.5}}>{kind==='date'?'交易日期':'交易状态'}</Typography><Divider/>
   {kind==='date'?<Stack sx={{p:2}} spacing={2}>
    <Stack direction="row" gap={1}><Chip label="近 7 天" onClick={()=>preset(7)}/><Chip label="近 30 天" onClick={()=>preset(30)}/><Chip label="不限日期" onClick={()=>apply({...value,from:'',to:''})}/></Stack>
    <TextField size="small" type="date" label="开始日期" InputLabelProps={{shrink:true}} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/><TextField size="small" type="date" label="结束日期" InputLabelProps={{shrink:true}} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/>
    <Typography variant="caption" color={error?'error.main':'text.secondary'}>{error||'按 UTC 日期筛选，包含开始和结束日期当天。'}</Typography><Button variant="contained" disabled={Boolean(error)} onClick={()=>apply(draft)}>应用日期</Button>
   </Stack>:<Box sx={{py:1}}><Box sx={{px:2,py:1}}><TextField autoFocus size="small" fullWidth label="搜索状态" value={statusSearch} onChange={e=>setStatusSearch(e.target.value)}/></Box><Box role="listbox" aria-label="交易状态" sx={{maxHeight:300,overflowY:'auto'}}>{[['','全部状态'],...Object.entries(transactionStatuses)].filter(([key,label])=>(key+' '+label).toLowerCase().includes(statusSearch.toLowerCase())).map(([key,label])=><MenuItem key={key} role="option" aria-selected={value.status===key} selected={value.status===key} onClick={()=>apply({...value,status:key})} sx={{gap:1.5,mx:1,borderRadius:0.75}}><Box component="span" aria-hidden="true" sx={{width:14,height:14,border:1,borderColor:value.status===key?'primary.main':'divider',borderRadius:'50%',bgcolor:value.status===key?'primary.main':'transparent'}}/>{label}</MenuItem>)}</Box>{!([['','全部状态'],...Object.entries(transactionStatuses)]).some(([key,label])=>(key+' '+label).toLowerCase().includes(statusSearch.toLowerCase()))&&statusSearch&&<Typography variant="body2" sx={{px:2,py:1}} color="text.secondary">没有匹配的状态</Typography>}</Box>}
  </Popover>
 </Stack>;
}

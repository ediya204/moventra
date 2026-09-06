import type {ReactNode} from 'react';
import {Alert,Box,Breadcrumbs,Button,Card,CardContent,Chip,Divider,Link,Stack,Tab,Tabs,Table,TableBody,TableCell,TableContainer,TableHead,TableRow,Typography} from '@mui/material';
import {Link as RouterLink,useSearchParams} from 'react-router-dom';
import {money,matchingLabels} from './api';
import type {SourceDetail} from './types';

export function accountType(raw?:string) {
 const labels:Record<string,string>={debit:'借记账户',charge_card:'签账卡账户'};
 return raw ? labels[raw] || `未知类型 · ${raw}` : '—';
}
export function accountTime(value?:string) {
 if(!value)return '—';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?value:date.toISOString().slice(0,19).replace('T',' ');
}
export function AccountStatus({value}:{value?:string}) {
 return <Chip size="small" variant="outlined" color={value==='open'?'success':value==='closed'?'default':'warning'} title={value} label={value==='open'?'已开立':value==='closed'?'已关闭':value?`未知状态 · ${value}`:'—'}/>;
}
function Field({label,children}:{label:string;children:ReactNode}) {
 return <Box sx={{minWidth:0}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography component="div" variant="body2" sx={{mt:0.5,overflowWrap:'anywhere'}}>{children==null||children===''?'—':children}</Typography></Box>;
}
function Fields({children}:{children:ReactNode}) {return <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,minmax(0,1fr))'},gap:2.5}}>{children}</Box>;}
function Section({title,children}:{title:string;children:ReactNode}) {return <Card variant="outlined"><CardContent><Typography variant="h6" sx={{mb:2}}>{title}</Typography>{children}</CardContent></Card>;}

export default function AccountDetail({data:d,renderRecords}:{data:SourceDetail;renderRecords:(kind:'cards'|'transactions')=>ReactNode}) {
 const [params,setParams]=useSearchParams();
 const tabs=['overview','cards','transactions','source'];
 const tab=tabs.includes(params.get('tab')||'')?params.get('tab')!:'overview';
 const i=d.internal,s=d.source;
 const requestedReturn=params.get('returnTo');
 const back=requestedReturn&&/^\/customers(?:\?[^#]*)?$/.test(requestedReturn)?requestedReturn:'/customers';
 const switchTab=(next:string)=>setParams({tab:next,...(requestedReturn?{returnTo:requestedReturn}:{})});
 return <Stack gap={2.5}>
  <Breadcrumbs aria-label="账户详情导航"><Link component={RouterLink} to={back}>账户目录</Link><Typography color="text.primary">账户详情</Typography></Breadcrumbs>
  <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={2}>
   <Box><Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap"><Typography variant="h5">{s.name||'未命名账户'}</Typography><AccountStatus value={s.status}/></Stack><Typography variant="body2" color="text.secondary" sx={{mt:1,overflowWrap:'anywhere'}}>{d.id}</Typography></Box>
   <Stack direction="row" gap={1} alignItems="flex-start"><Button component={RouterLink} to={back}>返回列表</Button><Button variant="outlined" onClick={()=>switchTab('transactions')}>查看关联交易</Button></Stack>
  </Stack>
  <Box sx={{borderBottom:1,borderColor:'divider'}}><Tabs value={tab} onChange={(_,next)=>switchTab(next)} variant="scrollable" scrollButtons="auto" aria-label="账户详情分组">{['账户概览','关联卡片','关联交易','数据来源'].map((label,n)=><Tab key={tabs[n]} value={tabs[n]} label={label} id={`account-tab-${tabs[n]}`} aria-controls={`account-panel-${tabs[n]}`}/>)}</Tabs></Box>
  <Box role="tabpanel" id={`account-panel-${tab}`} aria-labelledby={`account-tab-${tab}`}>
  {tab==='overview'&&<Stack gap={2.5}>
   <Section title="账户信息"><Fields><Field label="账户名称">{s.name}</Field><Field label="账户类型">{accountType(s.type)}</Field><Field label="所属用户（内部映射）">{i.customerName||i.email||i.customerId||'未关联用户'}</Field><Field label="用户邮箱">{i.email}</Field><Field label="渠道">{i.platform==='slash'?'Slash':i.platform||'—'}</Field><Field label="最近同步时间 · UTC">{accountTime(i.lastSyncedAt)}</Field></Fields></Section>
   <Section title="账户余额">
    <Typography variant="body2" color="text.secondary" sx={{mb:2}}>按币种和余额类型分别展示。以下为 Demo 模型余额，非实时渠道余额。</Typography>
    <TableContainer><Table size="small" aria-label="账户余额"><TableHead><TableRow>{['币种','余额类型','可用余额 · available','已入账余额 · posted','余额时间 · UTC'].map((h,n)=><TableCell key={h} align={n===2||n===3?'right':'left'} sx={{whiteSpace:'nowrap'}}>{h}</TableCell>)}</TableRow></TableHead><TableBody>{d.balances.map(b=><TableRow key={b.id}><TableCell>{b.internal.currency||'—'}</TableCell><TableCell>{b.source.type||'—'}</TableCell><TableCell align="right" sx={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{b.internal.currency?money(b.source.available?.amountCents,b.internal.currency):'—（币种未提供）'}</TableCell><TableCell align="right" sx={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{b.internal.currency?money(b.source.posted?.amountCents,b.internal.currency):'—（币种未提供）'}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{accountTime(b.source.timestamp)}</TableCell></TableRow>)}{!d.balances.length&&<TableRow><TableCell colSpan={5}>尚未采集账户余额</TableCell></TableRow>}</TableBody></Table></TableContainer>
   </Section>
   <Section title="虚拟账户"><Stack divider={<Divider/>} gap={2}>{d.virtualAccounts.map(v=><Fields key={v.id}><Field label="名称">{v.source.name}</Field><Field label="虚拟账户 ID">{v.id}</Field><Field label="来源账户类型">{v.source.accountType}</Field><Field label="所属账户 ID">{v.source.accountId}</Field></Fields>)}{!d.virtualAccounts.length&&<Typography color="text.secondary">暂无关联虚拟账户</Typography>}</Stack></Section>
  </Stack>}
  {(tab==='cards'||tab==='transactions')&&renderRecords(tab)}
  {tab==='source'&&<Stack gap={2.5}>
   <Alert severity={i.matchingStatus==='demo_verified'?'info':'warning'}>{matchingLabels[i.matchingStatus||'']||'待确认'}{i.assumption?` · ${i.assumption}`:''}</Alert>
   <Section title="来源与同步"><Fields><Field label="平台账户 ID">{d.id}</Field><Field label="来源状态">{s.status}</Field><Field label="来源账户类型">{s.type}</Field><Field label="平台 / 实体">{`${i.platform||'—'} / ${i.entityId||'—'}`}</Field><Field label="内部用户 ID">{i.customerId}</Field><Field label="首次采集时间 · UTC">{accountTime(i.firstCollectedAt)}</Field><Field label="最近同步时间 · UTC">{accountTime(i.lastSyncedAt)}</Field><Field label="同步错误">{i.syncError||'未记录错误'}</Field><Field label="内部版本（非渠道字段）">{i.version}</Field><Field label="数据命名空间">{i.namespace}</Field><Field label="测试场景">{i.scenarioId}</Field></Fields></Section>
   <Section title="余额变化记录"><Typography variant="body2" color="text.secondary" sx={{mb:2}}>内部 Demo 步骤快照，USD；不代表完整的渠道事件历史。</Typography><TableContainer><Table size="small" aria-label="余额变化记录"><TableHead><TableRow><TableCell>时间 · UTC</TableCell><TableCell>变化步骤</TableCell><TableCell align="right">可用余额</TableCell><TableCell align="right">已入账余额</TableCell></TableRow></TableHead><TableBody>{d.snapshots.map(b=><TableRow key={b.id}><TableCell sx={{whiteSpace:'nowrap'}}>{accountTime(b.timestamp)}</TableCell><TableCell>{b.step}</TableCell><TableCell align="right" sx={{whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{money(b.available_cents)}</TableCell><TableCell align="right" sx={{whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{money(b.posted_cents)}</TableCell></TableRow>)}{!d.snapshots.length&&<TableRow><TableCell colSpan={4}>暂无已采集的余额变化记录</TableCell></TableRow>}</TableBody></Table></TableContainer></Section>
  </Stack>}
  </Box>
 </Stack>;
}

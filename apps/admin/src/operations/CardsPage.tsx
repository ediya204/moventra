import {useEffect,useState} from 'react';
import {Link,Navigate,useSearchParams} from 'react-router-dom';
import {Alert,Button,MenuItem,Paper,Stack,TextField,Typography} from '@mui/material';
import {DataGrid,type GridColDef} from '@mui/x-data-grid';
import {zhCN} from '@mui/x-data-grid/locales';
import {DashboardLayout} from '../components/DashboardLayout';
import {useAuth} from '../../../../packages/shared/src/auth/AuthContext';
import {liveGet} from '../../../../packages/shared/src/auth/liveApi';
import {PageSkeleton} from '../../../../packages/shared/src/components/AsyncState';
import {utcTime} from '../components/cardTransactionFields';
type Connection={id:string;label:string;revision:string|null;sourceAt:string|null;importedAt:string|null};
type Card={id:string;cardName?:string;name?:string;last4?:string;cardStatus?:string;createdAtUTC?:string};
type Result={rows:Card[];total:number;revision:string;sourceAt:string;importedAt:string;coverageReason:string};
export default function CardsPage({channels=false}:{channels?:boolean}){
 const auth=useAuth();
 if(!auth.ready)return <PageSkeleton/>;
 if(!auth.authenticated||!auth.session?.operator||!auth.session.mfaVerified)return <Navigate to={auth.user?'/session?security=1':'/admin/login'} replace/>;
 return <CardsContent key={auth.user?.uid} channels={channels}/>;
}
function CardsContent({channels}:{channels:boolean}){
 const [params,setParams]=useSearchParams();
 const [connections,setConnections]=useState<Connection[]>([]),[result,setResult]=useState<Result>(),[busy,setBusy]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const [search,setSearch]=useState(params.get('keyword')||'');
 const connection=params.get('connection')||connections[0]?.id||'',keyword=params.get('keyword')||'',cardStatus=params.get('status')||'';
 const page=Math.max(0,Number(params.get('page'))||0);
 useEffect(()=>setSearch(keyword),[keyword]);
 const showError=(e:unknown)=>{const code=(e as {code?:string}).code;return code==='projection_updated'?'数据版本已更新，请刷新。':code==='channel_scope_required'||code==='not_found'?'当前没有此渠道的读取权限。':'读取失败，请重试。'};
 useEffect(()=>{let active=true;setBusy(true);setError('');setConnections([]);setResult(undefined);liveGet<Connection[]>('/admin-api/v1/channel-projections').then(rows=>{if(active){setConnections(rows);if(channels||!rows.length)setBusy(false)}}).catch(e=>{if(active){setError(showError(e));setBusy(false)}});return()=>{active=false}},[refresh,channels]);
 useEffect(()=>{if(channels||!connections.length||!connection)return;let active=true;setBusy(true);setResult(undefined);setError('');const q=new URLSearchParams({page:String(page),keyword,cardStatus,revision:connections.find(c=>c.id===connection)?.revision||''});
 liveGet<Result>(`/admin-api/v1/channel-projections/${encodeURIComponent(connection)}/cards?${q}`).then(data=>{if(active)setResult(data)}).catch(e=>{if(active)setError(showError(e))}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[connection,connections,page,keyword,cardStatus,channels]);
 const update=(values:Record<string,string>)=>{const q=new URLSearchParams(params);q.set('page','0');for(const [k,v] of Object.entries(values))v?q.set(k,v):q.delete(k);setParams(q)};
 const detail=(id:string)=>`/cards/${encodeURIComponent(id)}?${new URLSearchParams({connection,cardsPage:String(page),cardsKeyword:keyword,cardsStatus:cardStatus})}`;
 const columns:GridColDef<Card>[]=[
  {field:'cardName',headerName:'卡片名称',flex:1,minWidth:220,renderCell:p=><Button component={Link} to={detail(p.row.id)}>{p.row.cardName||p.row.name||'名称未采集'}</Button>},
  {field:'last4',headerName:'卡片尾号',width:140,valueFormatter:(v?:string)=>v?`•••• ${v}`:'未采集'},
  {field:'cardStatus',headerName:'来源状态',width:130,valueFormatter:(v?:string)=>v||'未知'},
  {field:'createdAtUTC',headerName:'创建时间 · UTC',width:200,valueFormatter:utcTime},
  {field:'owner',headerName:'内部用户',width:150,renderCell:()=> '未绑定'},
  {field:'actions',headerName:'操作',width:120,sortable:false,renderCell:p=><Button component={Link} to={detail(p.row.id)}>查看详情</Button>},
 ];
 return <DashboardLayout production><Stack spacing={2.5}>
  <Stack direction="row" justifyContent="space-between"><Typography variant="h4">{channels?'渠道与数据':'全部卡片'}</Typography><Button onClick={()=>setRefresh(n=>n+1)} disabled={busy}>刷新已导入数据</Button></Stack>
  <Typography color="text.secondary">{channels?'已授权连接及导入状态':'展示所选连接中全部已导入卡片，按服务端分页查询。'}</Typography>
  {error&&<Alert severity="error" action={<Button onClick={()=>setRefresh(n=>n+1)}>重试</Button>}>{error}</Alert>}
  {!busy&&!error&&!connections.length&&<Alert severity="info">当前没有已授权的渠道连接。</Alert>}
  {channels ? busy?<PageSkeleton/>:connections.map(c=><Paper variant="outlined" key={c.id} sx={{p:3}}><Stack spacing={1}><Typography variant="h6">{c.label}</Typography><Typography>最近采集：{utcTime(c.sourceAt)} UTC</Typography><Typography>最近导入：{utcTime(c.importedAt)} UTC</Typography><Typography color="text.secondary">手动导入；页面刷新不会采集上游。连接内的卡片和交易使用同一导入版本。</Typography><Stack direction="row" spacing={2}><Button component={Link} to={`/cards?connection=${encodeURIComponent(c.id)}`}>查看卡片</Button><Button component={Link} to={`/transactions?connection=${encodeURIComponent(c.id)}`}>查看交易</Button></Stack></Stack></Paper>):<>
   {connections.length>0&&<TextField select label="渠道连接" size="small" value={connection} onChange={e=>update({connection:e.target.value})}>{connections.map(c=><MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}</TextField>}
   {result&&<Alert severity="info">{result.coverageReason} 最近采集：{utcTime(result.sourceAt)} UTC · 导入：{utcTime(result.importedAt)} UTC</Alert>}
   <Paper variant="outlined" sx={{p:2}}><Stack direction="row" spacing={2} mb={2}><TextField size="small" label="卡片名称、尾号或 ID" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&update({keyword:search})}/><TextField size="small" label="来源状态" value={cardStatus} onChange={e=>update({status:e.target.value})}/><Button variant="contained" onClick={()=>update({keyword:search})}>查询</Button></Stack>
   <DataGrid autoHeight rows={result?.rows||[]} columns={columns} loading={busy} rowCount={result?.total||0} paginationMode="server" paginationModel={{page,pageSize:20}} pageSizeOptions={[20]} onPaginationModelChange={m=>update({page:String(m.page)})} disableRowSelectionOnClick disableColumnSorting disableColumnFilter localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}/></Paper>
  </>}
 </Stack></DashboardLayout>;
}

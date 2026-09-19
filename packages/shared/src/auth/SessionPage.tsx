import { loginPath } from './site';
import { isAdminSite, siteTitle } from './site';
import { useEffect, useRef, useState } from 'react';
import AccountSecurity from './AccountSecurity';
import { Alert, Box, Button, CircularProgress, Container, Link, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { needsRegistration } from './sessionState';
import CompleteRegistration from './CompleteRegistration';
import { authMessage, liveGet } from './liveApi';

type Row = { id: string; name?: string; status: string; currency?: string; amountMinor?: string; scale?: number; direction?: string; occurredAt?: string };
function exactAmount(row: Row): string {
  const digits = row.amountMinor || '0', scale = row.scale || 0;
  const value = digits.padStart(scale + 1, '0');
  return (row.direction === 'debit' ? '−' : '+') + (scale ? `${value.slice(0, -scale)}.${(row.currency === 'USDT' ? value.slice(-scale).slice(0, 2).padEnd(2, '0') : value.slice(-scale))}` : value) + ` ${row.currency}`;
}
export default function SessionPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, ready, session, sessionError, signOut } = useAuth();
  const location = useLocation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setRows(null); setScope(!isAdminSite && session?.customers.find(c => c.kind === 'personal') ? `/client-api/v1/customers/${session.customers.find(c => c.kind === 'personal')!.id}/accounts` : ''); setError(''); }, [session]);
  useEffect(() => () => { generation.current++; }, []);
  if (!ready) return <Container sx={{py:6}}><CircularProgress /></Container>;
  if (!user) return <Navigate to={loginPath} replace />;
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (cause) { setError(authMessage(cause)); } finally { setBusy(false); } };
  if (!isAdminSite && needsRegistration(sessionError)) return <CompleteRegistration />;
  if (!session && !sessionError) return <Container sx={{py:6}}><CircularProgress aria-label="正在检查账户" /></Container>;
  if (!isAdminSite && session && !sessionError && location.pathname === '/session') return <Navigate to="/portal" replace />;
  const options = [
    ...(!isAdminSite ? session?.customers.filter(c => c.kind === "personal") || [] : []).flatMap(c => ['accounts','transactions'].map(resource => ({ value: `/client-api/v1/customers/${c.id}/${resource}`, label: `${c.name} · ${c.kind === 'personal' ? '个人' : '企业'} · ${resource === 'accounts' ? '账户' : '交易'}` }))),
    ...(isAdminSite ? session?.staffScopes || [] : []).map(g => { const resource = g.permission.split(':')[0]; return { value: `/admin-api/v1/customers/${g.customerId}/${resource}`, label: `${g.name} · 运营 · ${resource === 'accounts' ? '账户' : '交易'}` }; }),
  ];
  return <Container maxWidth={embedded?false:"md"} disableGutters={embedded} sx={{ py: embedded?0:5 }}><Stack spacing={3}>
    {!embedded&&<Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h4" component="h1">{isAdminSite && (!user.emailVerified || !session?.mfaVerified) ? '完成后台安全验证' : siteTitle}</Typography><Button onClick={signOut}>退出登录</Button></Stack>}
    {sessionError != null && <Alert severity="warning">{authMessage(sessionError)}</Alert>}
    {session?.requiresMfa && <Alert severity="warning">运营访问需要双重验证。请先设置验证器，再重新登录。</Alert>}
    <AccountSecurity key={user.uid} user={user} />
    {session && !embedded && <Paper variant="outlined" sx={{p:{xs:2,md:3},maxWidth:840}}><Stack spacing={2}>
      <Typography variant="h6">已授权的数据范围</Typography>{error && <Alert severity="error">{error}</Alert>}
      {!options.length ? <Alert severity="info">当前没有可访问的客户数据。身份登录不会自动开通业务或授予运营权限。</Alert> : <>
        <TextField select label={isAdminSite ? "客户与资源" : "个人账户业务"} value={scope} onChange={e => { generation.current++; setScope(e.target.value); setRows(null); setError(''); }}>{options.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}</TextField>
        <Button disabled={busy || !scope} onClick={() => void run(async () => {
          const current = ++generation.current; setRows(null);
          const result = await liveGet<Row[]>(scope);
          if (current === generation.current) setRows(result);
        })}>查询</Button>
        {rows && (rows.length ? rows.map(row => <Box key={row.id} sx={{borderBottom:1,borderColor:'divider',py:1}}><Typography>{row.name || exactAmount(row)}</Typography><Typography variant="caption" color="text.secondary">{row.id} · {row.status}{row.occurredAt ? ` · ${row.occurredAt}` : ''}</Typography></Box>) : <Typography>该授权范围内暂无记录。</Typography>)}
        <Typography variant="caption" color="text.secondary">当前显示前 50 条记录；每次请求都会重新检查客户范围与运营权限。</Typography>
      </>}
    </Stack></Paper>}
    {!embedded&&<Typography variant="body2" color="text.secondary">卡片、资金操作和其他业务模块仍在接入中。此工作台展示当前已接入的身份、权限与只读查询。</Typography>}
    {!embedded&&<Link href="/">返回官网</Link>}
  </Stack></Container>;
}

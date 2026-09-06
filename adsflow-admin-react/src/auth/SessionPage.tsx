import { useEffect, useRef, useState } from 'react';
import { multiFactor, sendEmailVerification, TotpMultiFactorGenerator, type TotpSecret } from 'firebase/auth';
import { QRCodeSVG } from 'qrcode.react';
import { Alert, Box, Button, Chip, CircularProgress, Container, Link, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { authMessage, liveGet } from './liveApi';

type Row = { id: string; name?: string; status: string; currency?: string; amountMinor?: string; scale?: number; direction?: string; occurredAt?: string };
function exactAmount(row: Row): string {
  const digits = row.amountMinor || '0', scale = row.scale || 0;
  const value = digits.padStart(scale + 1, '0');
  return (row.direction === 'debit' ? '−' : '+') + (scale ? `${value.slice(0, -scale)}.${value.slice(-scale)}` : value) + ` ${row.currency}`;
}
export default function SessionPage() {
  const { user, ready, session, sessionError, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState('');
  const [scope, setScope] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setRows(null); setScope(''); setError(''); }, [session]);
  useEffect(() => () => { generation.current++; }, []);
  if (!ready) return <Container sx={{py:6}}><CircularProgress /></Container>;
  if (!user) return <Navigate to="/login" replace />;
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (cause) { setError(authMessage(cause)); } finally { setBusy(false); } };
  const options = [
    ...(session?.customers || []).flatMap(c => ['accounts','transactions'].map(resource => ({ value: `/client-api/v1/customers/${c.id}/${resource}`, label: `${c.name} · ${c.kind === 'personal' ? '个人' : '企业'} · ${resource === 'accounts' ? '账户' : '交易'}` }))),
    ...(session?.staffScopes || []).map(g => { const resource = g.permission.split(':')[0]; return { value: `/admin-api/v1/customers/${g.customerId}/${resource}`, label: `${g.name} · 运营 · ${resource === 'accounts' ? '账户' : '交易'}` }; }),
  ];
  return <Container maxWidth="md" sx={{ py: 5 }}><Stack spacing={3}>
    <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h4" component="h1">Moventra 工作台</Typography><Button onClick={signOut}>退出登录</Button></Stack>
    <Paper variant="outlined" sx={{p:3}}><Stack spacing={2}>
      <Typography>{user.email}</Typography>
      <Stack direction="row" spacing={1}><Chip label={user.emailVerified ? '邮箱已验证' : '邮箱待验证'} /><Chip label={session?.mfaVerified ? '本次登录已完成双重验证' : '本次登录未完成双重验证'} /></Stack>
      {sessionError != null && <Alert severity="warning">{authMessage(sessionError)}</Alert>}
      {session?.requiresMfa && <Alert severity="warning">运营访问需要双重验证。请先设置验证器，再退出并重新登录。</Alert>}
      {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}
      {!user.emailVerified && <Button disabled={busy} onClick={() => void run(async () => { await sendEmailVerification(user, { url: window.location.origin + '/login' }); setNotice('验证邮件已发送，请检查收件箱。'); })}>发送邮箱验证邮件</Button>}
      <Button disabled={busy} onClick={() => void run(refreshSession)}>刷新身份和权限</Button>
    </Stack></Paper>
    {user.emailVerified && <Paper variant="outlined" sx={{p:3}}><Stack spacing={2}>
      <Typography variant="h6">验证器双重验证</Typography>
      <Typography variant="body2" color="text.secondary">使用 Google Authenticator 等验证器保护登录。请自行保管验证器密钥，不要发送给他人。</Typography>
      {multiFactor(user).enrolledFactors.length > 0 ? <Typography>已绑定验证器。需要更新时请联系账户管理员；此页面不提供绕过验证器的重置入口。</Typography> : !secret ? <Button disabled={busy} onClick={() => void run(async () => { setSecret(await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession())); })}>设置验证器</Button> : <>
        <Box sx={{ bgcolor: 'white', p:2, width:'fit-content' }}><QRCodeSVG value={secret.generateQrCodeUrl(user.email || user.uid, 'Moventra')} size={190} /></Box>
        <Typography variant="body2" sx={{wordBreak:'break-all'}}>手动设置密钥：{secret.secretKey}</Typography>
        <TextField label="验证器当前的六位验证码" value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))} autoComplete="one-time-code" inputProps={{inputMode:'numeric',maxLength:6}} />
        <Button variant="contained" disabled={busy || code.length !== 6} onClick={() => void run(async () => {
          await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code), 'Moventra 验证器');
          setSecret(null); setCode(''); signOut(); navigate('/login', { replace:true, state:{ notice:'验证器已绑定。请等待验证码刷新后，重新登录并完成双重验证。' } });
        })}>确认绑定并重新登录</Button><Button onClick={() => { setSecret(null); setCode(''); }}>取消设置</Button>
      </>}
    </Stack></Paper>}
    {session && <Paper variant="outlined" sx={{p:3}}><Stack spacing={2}>
      <Typography variant="h6">已授权的数据范围</Typography>
      {!options.length ? <Alert severity="info">当前没有可访问的客户数据。身份登录不会自动开通业务或授予运营权限。</Alert> : <>
        <TextField select label="客户与资源" value={scope} onChange={e => { generation.current++; setScope(e.target.value); setRows(null); setError(''); }}>{options.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}</TextField>
        <Button disabled={busy || !scope} onClick={() => void run(async () => {
          const current = ++generation.current; setRows(null);
          const result = await liveGet<Row[]>(scope);
          if (current === generation.current) setRows(result);
        })}>查询</Button>
        {rows && (rows.length ? rows.map(row => <Box key={row.id} sx={{borderBottom:1,borderColor:'divider',py:1}}><Typography>{row.name || exactAmount(row)}</Typography><Typography variant="caption" color="text.secondary">{row.id} · {row.status}{row.occurredAt ? ` · ${row.occurredAt}` : ''}</Typography></Box>) : <Typography>该授权范围内暂无记录。</Typography>)}
        <Typography variant="caption" color="text.secondary">当前显示前 50 条记录；每次请求都会重新检查客户范围与运营权限。</Typography>
      </>}
    </Stack></Paper>}
    <Typography variant="body2" color="text.secondary">卡片、资金操作和其他业务模块仍在接入中。此工作台展示当前已接入的身份、权限与只读查询。</Typography>
    <Link href="/">返回官网</Link>
  </Stack></Container>;
}

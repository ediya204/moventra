import { siteTitle } from '../auth/site';
import { Icon } from '@iconify/react';
import { useState } from 'react';
import { Alert, Button, CircularProgress, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth, usesFirebaseAuth } from '../auth/AuthContext';
import { authMessage } from '../auth/liveApi';
import AuthLayout from '../website/auth/AuthLayout';
import { useLocale } from '../website/i18n';

export function LoginPage() {
  const { t } = useLocale();
  const { authenticated, user, ready, loginError, factors, signIn, signInWithGoogle, completeMfa, signOut } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState(usesFirebaseAuth ? '' : 'demo@adsflow.local');
  const [password, setPassword] = useState(usesFirebaseAuth ? '' : 'demo-only');
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ready) return <AuthLayout><CircularProgress aria-label="正在检查登录状态" /></AuthLayout>;
  if (usesFirebaseAuth ? Boolean(user) : authenticated) return <Navigate to={usesFirebaseAuth ? '/session' : '/workbench'} replace />;
  const challenge = factors.length > 0;
  return <AuthLayout><Stack spacing={2.5} component="form" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { if (challenge) await completeMfa(factor || factors[0].uid, code); else await signIn(email, password); }
    catch (cause) { setError(authMessage(cause)); }
    finally { setPassword(''); setCode(''); setBusy(false); }
  }}>
    <Typography variant="h4" component="h1">{challenge ? t('双重验证') : t('欢迎回来')}</Typography>
    <Typography color="text.secondary">{challenge ? t('请输入验证器应用当前的六位验证码。') : siteTitle + '登录'}</Typography>
    {typeof location.state?.notice === 'string' && <Alert severity="info">{location.state.notice}</Alert>}
    {(error || loginError != null) && <Alert severity="error">{error || authMessage(loginError)}</Alert>}
    {usesFirebaseAuth && !challenge && <Button type="button" variant="outlined" size="large" disabled={busy} startIcon={<Icon icon="logos:google-icon" width={20} />} onClick={async () => {
      if (busy) return;
      setBusy(true); setError(''); setPassword('');
      try { await signInWithGoogle(); }
      catch (cause) { setError(authMessage(cause)); }
      finally { setBusy(false); }
    }}>{t('使用 Google 登录')}</Button>}
    {!usesFirebaseAuth && <Alert severity="info">本地 Demo：demo@adsflow.local / demo-only</Alert>}
    {challenge ? <>
      {factors.length > 1 && <TextField select label="验证器" value={factor || factors[0].uid} onChange={e => setFactor(e.target.value)}>{factors.map(f => <MenuItem key={f.uid} value={f.uid}>{f.name}</MenuItem>)}</TextField>}
      <TextField label={t('验证码')} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0,6))} autoComplete="one-time-code" inputProps={{ inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6 }} required autoFocus />
    </> : <>
      <TextField label={usesFirebaseAuth ? t('邮箱地址') : t('用户名')} type={usesFirebaseAuth ? 'email' : 'text'} value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
      <TextField label={t('密码')} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
      <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: 'flex-end' }}>{t('忘记密码？')}</Link>
    </>}
    <Button type="submit" variant="contained" size="large" disabled={busy || (challenge ? code.length !== 6 : !email.trim() || !password)} startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}>{busy ? t('正在验证…') : challenge ? t('验证并登录') : t('登录工作台')}</Button>
    {challenge && <Button onClick={() => { signOut(); setCode(''); setFactor(''); setError(''); }}>{t('重新选择登录方式')}</Button>}
    <Typography variant="caption" color="text.secondary">{t('会话仅保留在当前页面，刷新后需要重新登录。运营权限需要双重验证。')}</Typography>
  </Stack></AuthLayout>;
}

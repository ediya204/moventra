import { isAdminSite } from '../auth/site';
import { Icon } from '@iconify/react';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth, usesFirebaseAuth } from '../auth/AuthContext';
import { authMessage } from '../auth/liveApi';
import LoginLayout from '../website/auth/LoginLayout';
import { useLocale } from '../website/i18n/index.tsx';

export function LoginPage() {
  const { t } = useLocale();
  const { authenticated, user, ready, loginError, factors, signIn, signInWithGoogle, completeMfa, signOut } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState(usesFirebaseAuth ? '' : 'demo@moventra.local');
  const [password, setPassword] = useState(usesFirebaseAuth ? '' : 'demo-only');
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const pending = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const challenge = factors.length > 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || (challenge && code.length !== 6)) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (challenge) await completeMfa(factor || factors[0].uid, code);
      else await signIn(email, password);
    } catch (cause) { setError(authMessage(cause)); }
    finally {
      setPassword(''); setCode(''); setBusy(false); pending.current = false;
      requestAnimationFrame(() => codeInput.current?.focus());
    }
  }
  function cancelMfa() {
    if (pending.current) return;
    signOut(); setCode(''); setFactor(''); setError(''); setPassword('');
  }
  if (!ready) return <LoginLayout><CircularProgress aria-label={t('正在检查登录状态')} sx={{ alignSelf: 'center' }} /></LoginLayout>;
  if (usesFirebaseAuth ? Boolean(user) : authenticated) return <Navigate to={usesFirebaseAuth ? '/session' : '/workbench'} replace />;
  return <LoginLayout>
    <Stack spacing={2.5} component="form" onSubmit={submit}>
      <Box textAlign="center" sx={{ mb: 1.5 }}>
        <Typography variant="h4" component="h1">{t(isAdminSite ? '登录运营后台' : '登录您的账户')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{t(isAdminSite ? '使用已开通的运营账号安全访问' : '欢迎回来，继续您的 Moventra 之旅')}</Typography>
      </Box>
      {typeof location.state?.notice === 'string' && <Alert severity="info">{location.state.notice}</Alert>}
      {!challenge && (error || loginError != null) && <Alert severity="error">{error || authMessage(loginError)}</Alert>}
      {!usesFirebaseAuth && <Alert severity="info">本地 Demo：demo@moventra.local / demo-only</Alert>}
      <TextField label={usesFirebaseAuth ? t('邮箱地址') : t('用户名')} type={usesFirebaseAuth ? 'email' : 'text'} value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required disabled={busy || challenge} />
      <TextField inputRef={passwordInput} label={t('密码')} type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy || challenge} InputProps={{ endAdornment: <InputAdornment position="end"><IconButton aria-label={t(showPassword ? '隐藏密码' : '显示密码')} onClick={() => setShowPassword(!showPassword)} edge="end" disabled={busy || challenge}><Icon icon={showPassword ? 'solar:eye-closed-linear' : 'solar:eye-linear'} width={20} /></IconButton></InputAdornment> }} />
      <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: 'flex-end' }}>{t('忘记密码？')}</Link>
      <Button type="submit" variant="contained" size="large" disabled={busy || challenge || !email.trim() || !password} sx={{ minHeight: 48, bgcolor: 'text.primary', '&:hover': { bgcolor: '#354454' } }} startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}>{busy ? t('正在验证…') : t('登录')}</Button>
      {usesFirebaseAuth && !isAdminSite && <>
        <Divider><Typography variant="caption" color="text.secondary">{t('或')}</Typography></Divider>
        <Button type="button" variant="outlined" color="inherit" size="large" disabled={busy || challenge} startIcon={<Icon icon="logos:google-icon" width={20} />} onClick={async () => {
          if (pending.current) return;
          pending.current = true; setBusy(true); setError(''); setPassword('');
          try { await signInWithGoogle(); }
          catch (cause) { setError(authMessage(cause)); }
          finally { setBusy(false); pending.current = false; }
        }}>{t('使用 Google 登录')}</Button>
      </>}
      <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ pt: 1.5 }}>{t('会话保留在当前标签页，刷新后可恢复。')}</Typography>
    </Stack>
    <Dialog open={challenge} onClose={cancelMfa} fullWidth maxWidth="xs" TransitionProps={{ onExited: () => passwordInput.current?.focus() }} aria-labelledby="login-mfa-title" aria-describedby="login-mfa-description" PaperProps={{ sx: { borderRadius: 2.5, m: 2, width: 'calc(100% - 32px)' } }}>
      <Box component="form" onSubmit={submit}>
        <DialogTitle id="login-mfa-title" sx={{ px: 3, pt: 3 }}>{t('二次验证')}</DialogTitle>
        <DialogContent sx={{ px: 3 }}>
          <Typography id="login-mfa-description" variant="body2" color="text.secondary" sx={{ mb: 3 }}>{t('为了账户安全，请完成验证后继续登录。')}</Typography>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}><Icon icon="solar:shield-keyhole-linear" width={21} /><Typography variant="subtitle2">{t('验证器验证码')}</Typography></Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{t('请输入验证器应用当前的六位验证码。')}</Typography>
          <Stack spacing={2}>
            {(error || loginError != null) && <Alert severity="error">{error || authMessage(loginError)}</Alert>}
            {factors.length > 1 && <TextField select label={t('验证器')} value={factor || factors[0].uid} disabled={busy} onChange={e => { setFactor(e.target.value); setCode(''); setError(''); }}>{factors.map(f => <MenuItem key={f.uid} value={f.uid}>{f.name}</MenuItem>)}</TextField>}
            <TextField inputRef={codeInput} label={t('六位验证码')} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputProps={{ inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, 'aria-label': t('六位验证码'), style: { textAlign: 'center', fontSize: 26, letterSpacing: '0.45em', fontVariantNumeric: 'tabular-nums' } }} required autoFocus disabled={busy} placeholder="------" />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, pt: 1, gap: 1 }}>
          <Button onClick={cancelMfa} color="inherit" disabled={busy}>{t('取消')}</Button>
          <Button type="submit" variant="contained" disabled={busy || code.length !== 6} sx={{ minWidth: 110 }} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>{t(busy ? '正在验证…' : '验证并登录')}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  </LoginLayout>;
}

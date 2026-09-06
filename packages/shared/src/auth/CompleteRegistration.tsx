import { useState } from 'react';
import { EmailAuthProvider, linkWithCredential } from 'firebase/auth';
import { Alert, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from './AuthContext';
import { getFirebaseAuth } from '../firebase';
import { authMessage, registerUser } from './liveApi';

export default function CompleteRegistration() {
  const { user, refreshSession, signOut } = useAuth();
  const [name, setName] = useState(user?.displayName || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linked, setLinked] = useState(Boolean(user?.providerData.some(p => p.providerId === 'password')));
  if (!user) return null;
  return <Container maxWidth="sm" sx={{py:6}}><Paper variant="outlined" sx={{p:4}}><Stack spacing={2.5} component="form" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    setError('');
    if (!linked && (password.length < 12 || password.length > 128 || password !== confirm)) { setError('密码需为 12–128 位，且两次输入一致。'); return; }
    setBusy(true);
    try {
      if (getFirebaseAuth().currentUser !== user || !user.email || !user.emailVerified) throw new Error('Identity changed');
      // Link to the same Google UID, never create a second Firebase identity or overwrite a password.
      if (!user.providerData.some(p => p.providerId === 'password')) {
        await linkWithCredential(user, EmailAuthProvider.credential(user.email, password));
        setLinked(true); setPassword(''); setConfirm('');
      }
      if (getFirebaseAuth().currentUser !== user) throw new Error('Identity changed');
      await registerUser(name.trim());
      await refreshSession();
    } catch (cause) { setError(authMessage(cause)); }
    finally { setPassword(''); setConfirm(''); setBusy(false); }
  }}>
    <Typography component="h1" variant="h4">创建 Moventra 账户</Typography>
    <Alert severity="info">身份已验证。你尚未创建 Moventra 账户，请补充信息后继续。</Alert>
    <TextField label="已验证邮箱" value={user.email || ''} InputProps={{readOnly:true}} />
    <TextField label="姓名" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required inputProps={{maxLength:80}} disabled={busy} />
    {!linked ? <>
      <TextField label="设置密码（至少 12 位）" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required inputProps={{minLength:12,maxLength:128}} disabled={busy} />
      <TextField label="确认密码" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required disabled={busy} />
    </> : <Alert severity="success">已设置密码，可以继续创建账户。</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    <Button type="submit" variant="contained" disabled={busy || !name.trim()}>{busy ? '正在创建…' : '创建账户并继续'}</Button>
    <Button disabled={busy} onClick={signOut}>换一个账户登录</Button>
    <Typography variant="caption" color="text.secondary">创建后可使用已关联的登录方式。业务服务与运营权限按授权单独开通。</Typography>
  </Stack></Paper></Container>;
}

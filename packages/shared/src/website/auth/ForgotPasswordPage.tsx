import { loginPath } from '../../auth/site';
import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { getFirebaseAuth } from '../../firebase';
import { authMessage } from '../../auth/liveApi';
export default function ForgotPasswordPage() {
  const [email,setEmail]=useState('');const [sent,setSent]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <AuthLayout><Stack spacing={2.5} component="form" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError('');
    try { await sendPasswordResetEmail(getFirebaseAuth(),email.trim(),{url:window.location.origin+loginPath});setSent(true); }
    catch(cause) { if ((cause as {code?:string}).code==='auth/user-not-found')setSent(true);else setError(authMessage(cause)); }
    finally {setBusy(false);}
  }}><Typography component="h1" variant="h4">设置或找回密码</Typography><Typography color="text.secondary">使用已开通账户的邮箱接收密码设置链接。</Typography>
  <TextField label="注册邮箱" type="email" autoComplete="email" required value={email} onChange={e=>{setEmail(e.target.value);setSent(false);}} />
  <Button type="submit" variant="contained" disabled={busy || sent}>{busy?'正在提交…':'发送密码设置邮件'}</Button>
  {sent&&<Alert severity="success">如果该邮箱已注册，将收到密码设置邮件。请检查收件箱和垃圾邮件。</Alert>}{error&&<Alert severity="error">{error}</Alert>}
  <Link component={RouterLink} to={loginPath}>返回登录</Link></Stack></AuthLayout>;
}

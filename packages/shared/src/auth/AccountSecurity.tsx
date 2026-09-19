import { useRef, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, Divider, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { Icon } from '@iconify/react';
import { multiFactor, sendEmailVerification, sendPasswordResetEmail, updatePassword, verifyBeforeUpdateEmail, TotpMultiFactorGenerator, type TotpSecret, type User } from 'firebase/auth';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { authMessage } from './liveApi';
import { loginPath } from './site';
import { getFirebaseAuth } from '../firebase';

type Section = 'password' | 'email' | 'mfa' | null;
export default function AccountSecurity({ user }: { user: User }) {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [relogin, setRelogin] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [removeId, setRemoveId] = useState('');
  const factors = multiFactor(user).enrolledFactors;
  const hasPassword = user.providerData?.some(p => p.providerId === 'password');
  const settings = () => ({ url: window.location.origin + loginPath });
  const clear = () => { setPassword(''); setConfirmation(''); setEmail(''); setSecret(null); setCode(''); setDeviceName(''); setRemoveId(''); };
  const open = (next: Section) => { if (lock.current) return; clear(); setError(''); setNotice(''); setRelogin(false); setSection(next); };
  const leave = (message: string) => { clear(); signOut(); navigate(loginPath, { replace: true, state: { notice: message } }); };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setRelogin(false);
    try { await action(); }
    catch (cause) {
      const id = (cause as { code?: string }).code;
      setError(id === 'auth/user-token-expired' || id === 'auth/invalid-user-token' ? '登录状态已失效，请重新登录后检查安全设置。' : authMessage(cause)); setCode('');
      if (id === 'auth/requires-recent-login' || id === 'auth/user-token-expired' || id === 'auth/invalid-user-token') {
        clear(); setRelogin(true);
      }
    } finally { lock.current = false; setBusy(false); }
  };
  const cancel = <Button disabled={busy} onClick={() => open(null)}>取消</Button>;
  function row(id: Exclude<Section, null>, icon: string, title: string, description: string, status: string, action: string, content: ReactNode) {
    const expanded = section === id;
    return <Box component="section" sx={{ py: { xs: 2.5, md: 3.5 } }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', columnGap: { xs: 1.5, md: 2 }, alignItems: 'start' }}>
        <Box sx={{ color: 'primary.main', pt: .5 }}><Icon icon={icon} width={24} aria-hidden="true" /></Box>
        <Box><Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap"><Typography component="h2" variant="subtitle1">{title}</Typography><Chip size="small" variant="outlined" label={status} sx={{ height: 24, fontSize: 11, fontWeight: 500 }} /></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .75, maxWidth: 530, overflowWrap: 'anywhere' }}>{description}</Typography></Box>
        <Button size="small" disabled={busy} aria-expanded={expanded} aria-controls={`security-${id}`} onClick={() => open(expanded ? null : id)} sx={{ minWidth: 60 }}>{expanded ? '收起' : action}</Button>
      </Box>
      {expanded && <Box id={`security-${id}`} sx={{ ml: { xs: 0, sm: 5.5 }, mt: 3, p: { xs: 2, md: 3 }, bgcolor: 'grey.50', borderRadius: 1.5 }}>
        {content}
      </Box>}
    </Box>;
  }
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0, 1fr) 240px' }, gap: { xs: 3, lg: 4 }, maxWidth: 1160 }}>
    <Box sx={{ minWidth: 0 }}>
      <Paper variant="outlined" sx={{ px: { xs: 2, md: 3.5 }, boxShadow: 'none' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ py: 3 }}>
          <Box><Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5 }}>登录账户</Typography><Typography variant="h6" sx={{ overflowWrap: 'anywhere', mt: .5 }}>{user.email || '未提供邮箱'}</Typography></Box>
          <Chip size="small" icon={<Icon icon={user.emailVerified ? 'solar:check-circle-linear' : 'solar:info-circle-linear'} width={16} />} label={user.emailVerified ? '邮箱已验证' : '邮箱待验证'} color={user.emailVerified ? 'success' : 'warning'} variant="outlined" />
        </Stack>
        {!user.emailVerified && <Alert severity="warning" sx={{ mb: 2 }} action={<Button disabled={busy} onClick={() => void run(async () => { await sendEmailVerification(user, settings()); setNotice('验证邮件已发送，请在邮箱中完成验证后刷新状态。'); })}>发送验证邮件</Button>}>请先验证当前邮箱。</Alert>}
        <Divider />
        {row('password', 'solar:lock-password-linear', '登录密码', hasPassword ? '使用独立的强密码，保护你的账户。' : '当前账户使用第三方登录，密码由登录服务管理。', hasPassword ? '已设置' : '第三方登录', hasPassword ? '修改' : '查看', hasPassword ?
          <Box component="form" onSubmit={e => { e.preventDefault(); if (password !== confirmation || password.length < 8) return; void run(async () => { await updatePassword(user, password); leave('密码已修改，请使用新密码重新登录。'); }); }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2">设置新密码</Typography>
              <TextField autoFocus required fullWidth label="新密码" type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} inputProps={{ minLength: 8, maxLength: 128 }} helperText="至少 8 个字符，建议组合字母、数字与符号。" />
              <TextField required fullWidth label="确认新密码" type="password" autoComplete="new-password" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} error={Boolean(confirmation && confirmation !== password)} helperText={confirmation && confirmation !== password ? '两次输入的密码不一致。' : '修改完成后需要重新登录。'} />
              <Stack direction="row" gap={1} flexWrap="wrap"><Button type="submit" variant="contained" disabled={busy || password.length < 8 || password !== confirmation}>保存新密码</Button>{cancel}<Button disabled={busy || !user.email} onClick={() => void run(async () => { await sendPasswordResetEmail(getFirebaseAuth(), user.email!, settings()); setNotice('重设密码邮件已发送。请打开邮件中的链接设置新密码；当前密码尚未改变。'); })}>通过邮箱重设</Button></Stack>
            </Stack>
          </Box> : <Typography variant="body2">请前往 Google 账户管理登录密码。这里不会更改你的 Google 密码。</Typography>)}
        <Divider />
        {row('email', 'solar:letter-linear', '登录邮箱', '用于登录、接收安全通知和找回密码。', user.emailVerified ? '已验证' : '待验证', '修改',
          <Box component="form" onSubmit={e => { e.preventDefault(); if (!email.trim() || email.trim().toLowerCase() === user.email?.toLowerCase()) return; void run(async () => { await verifyBeforeUpdateEmail(user, email.trim(), settings()); setNotice(`验证邮件已发送至 ${email.trim()}。完成新邮箱验证前，登录邮箱保持不变。验证后请重新登录并检查安全设置。`); setEmail(''); setSection(null); }); }}>
            <Stack spacing={2}><Typography variant="subtitle2">验证新的登录邮箱</Typography><Typography variant="body2" color="text.secondary">确认新邮箱可以收信。账户和业务权限仍关联原身份，不会创建新账户。</Typography><TextField autoFocus required type="email" autoComplete="email" label="新邮箱地址" fullWidth value={email} disabled={busy} onChange={e => setEmail(e.target.value)} /><Stack direction="row" gap={1}><Button type="submit" variant="contained" disabled={busy || !user.emailVerified || !email.trim() || email.trim().toLowerCase() === user.email?.toLowerCase()}>发送验证邮件</Button>{cancel}</Stack></Stack>
          </Box>)}
        <Divider />
        {row('mfa', 'solar:shield-keyhole-linear', '双重验证（2FA）', '登录时额外验证动态验证码，支持 Google Authenticator 等验证器。', factors.length ? `已绑定 ${factors.length} 个` : '未绑定', factors.length ? '管理' : '绑定',
          <Stack spacing={2.5}>
            {!user.emailVerified || !session ? <Alert severity="info">请完成邮箱验证并刷新账户状态后设置验证器。</Alert> : <>
              {factors.length > 0 && <Stack spacing={1.5}>{factors.map((factor, index) => <Stack key={factor.uid} direction="row" alignItems="center" justifyContent="space-between" gap={1}><Box><Typography variant="subtitle2">{factor.displayName || `验证器 ${index + 1}`}</Typography><Typography variant="caption" color="text.secondary">{factor.factorId === TotpMultiFactorGenerator.FACTOR_ID ? '动态验证码' : '其他验证方式'}</Typography></Box><Chip size="small" label="已绑定" variant="outlined" /></Stack>)}</Stack>}
              {!secret ? <><Typography variant="body2" color="text.secondary">{factors.length ? '更换设备时，先绑定新验证器并使用它重新登录，再回来移除旧验证器。至少保留一个验证器。' : '绑定后，每次登录还需输入验证器生成的六位验证码。'}</Typography><Button variant="outlined" disabled={busy || factors.length >= 5} sx={{ alignSelf: 'flex-start' }} onClick={() => void run(async () => { setRemoveId(''); setSecret(await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession())); })}>{factors.length ? '绑定新验证器' : '开始绑定'}</Button>{factors.length >= 5 && <Typography variant="caption">验证方式已达上限，请保留可用验证器后移除不再使用的设备。</Typography>}</> :
                <Box component="form" onSubmit={e => { e.preventDefault(); if (code.length !== 6) return; void run(async () => { await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code), deviceName.trim() || 'Moventra 验证器'); leave('验证器已绑定。请等待验证码刷新后，使用新验证器重新登录。'); }); }}><Stack spacing={2}><Typography variant="subtitle2">1. 扫描二维码或手动输入密钥</Typography><Box sx={{ bgcolor: '#fff', p: 2, width: 'fit-content', maxWidth: '100%' }}><QRCodeSVG value={secret.generateQrCodeUrl(user.email || user.uid, 'Moventra')} size={176} title="验证器绑定二维码" /></Box><Box component="details"><Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>无法扫码？查看手动设置密钥</Typography><Typography sx={{ overflowWrap: 'anywhere', mt: 1 }}>{secret.secretKey}</Typography></Box><Typography variant="caption" color="text.secondary">密钥只用于在自己的验证器中设置，请勿分享或截图发送给他人。</Typography><Typography variant="subtitle2">2. 输入新验证器的验证码</Typography><TextField label="设备名称（选填）" value={deviceName} disabled={busy} onChange={e => setDeviceName(e.target.value)} inputProps={{ maxLength: 40 }} placeholder="例如：我的手机" /><TextField required label="六位验证码" value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputProps={{ inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6 }} /><Stack direction="row" gap={1} flexWrap="wrap"><Button type="submit" variant="contained" disabled={busy || code.length !== 6}>确认绑定并重新登录</Button><Button disabled={busy} onClick={() => { setSecret(null); setCode(''); setDeviceName(''); }}>取消绑定</Button></Stack></Stack></Box>}
              {!secret && factors.length > 1 && <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}><Stack spacing={2}><Typography variant="subtitle2">移除旧验证器</Typography><TextField select label="选择不再使用的验证器" value={removeId} disabled={busy} onChange={e => setRemoveId(e.target.value)}>{factors.map((factor, index) => <MenuItem key={factor.uid} value={factor.uid}>{factor.displayName || `验证器 ${index + 1}`}</MenuItem>)}</TextField>{removeId && <Alert severity="warning">确认剩余验证器可以使用。移除后，此设备的验证码将无法登录。</Alert>}<Button color="error" variant="outlined" disabled={busy || !removeId} sx={{ alignSelf: 'flex-start' }} onClick={() => void run(async () => { await user.reload(); const current = multiFactor(user); if (current.enrolledFactors.length < 2 || !current.enrolledFactors.some(f => f.uid === removeId)) { setError('验证器状态已变化，请刷新后重新选择。'); return; } await current.unenroll(removeId); leave('验证器已移除，请使用保留的验证器重新登录。'); })}>确认移除并重新登录</Button></Stack></Box>}
              <Box component="details"><Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>无法使用原验证器？</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>如已绑定其他验证器，请在登录时切换使用。所有验证器均不可用时，请联系账户管理员核验身份；此页面不提供跳过双重验证的恢复方式。</Typography></Box>
            </>}
          </Stack>)}
      </Paper>
      <Box aria-live="polite" sx={{ mt: 2 }}>{busy && <Typography role="status" variant="body2" color="text.secondary">正在处理，请稍候…</Typography>}{error && <Alert severity="error" action={relogin ? <Button onClick={() => leave('请重新登录后返回账户与安全，继续刚才的操作。')}>重新登录</Button> : undefined}>{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}</Box>
    </Box>
    <Box component="aside" sx={{ pt: { lg: 1 } }}><Stack spacing={2.5}>
      <Box><Icon icon="solar:shield-check-linear" width={28} /><Typography variant="subtitle1" sx={{ mt: 1 }}>安全提示</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.8 }}>密码、邮箱和验证器共同保护你的账户。更换设备前，请确认仍可接收邮箱中的安全邮件。</Typography></Box>
      <Divider /><Box><Typography variant="subtitle2">本次登录</Typography><Stack direction="row" alignItems="center" gap={.75} sx={{ mt: 1, color: session?.mfaVerified ? 'success.main' : 'text.secondary' }}><Icon icon={session?.mfaVerified ? 'solar:check-circle-linear' : 'solar:info-circle-linear'} width={17} /><Typography variant="body2">{session?.mfaVerified ? '已完成双重验证' : '未完成双重验证'}</Typography></Stack></Box>
      <Box><Typography variant="body2" color="text.secondary">完成邮箱验证后，可以刷新查看最新状态。</Typography><Button disabled={busy} sx={{ mt: .5, ml: -1 }} startIcon={<Icon icon="solar:refresh-linear" width={16} />} onClick={() => void run(refreshSession)}>刷新安全状态</Button></Box>
    </Stack></Box>
  </Box>;
}

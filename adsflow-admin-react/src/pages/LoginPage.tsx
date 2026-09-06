import { useLocale } from '../website/i18n';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as Yup from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Alert, Button, CircularProgress, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isDemoMode } from '../utils/dataMode';
import AuthLayout from '../website/auth/AuthLayout';
import FormProvider from '../minimals/components/hook-form/form-provider';
import RHFTextField from '../minimals/components/hook-form/rhf-text-field';
import { PasswordField } from '../website/auth/PasswordField';
export function LoginPage() {
    const { t, locale } = useLocale();
    const { authenticated, signIn } = useAuth();
    const location = useLocation();
    const [error, setError] = useState('');
    const methods = useForm({ resolver: yupResolver(Yup.object({ username: Yup.string().trim().required(t("请输入用户名")), password: Yup.string().required(t("请输入密码")) })), defaultValues: { username: isDemoMode ? 'demo@adsflow.local' : '', password: isDemoMode ? 'demo-only' : '' } });
    useEffect(() => {
      if (Object.keys(methods.formState.errors).length) void methods.trigger();
    }, [locale]);
    const requested = location.state?.from;
    const destination = typeof requested === 'string' && /^\/(workbench|analytics|customers|cards|transactions|risk|reports|reconciliation|revenue|user-groups|card-bins|approvals|pricing|finance|system|operations|demo)(\/|$)/.test(requested) ? requested : '/workbench';
    if (authenticated)
        return <Navigate to={destination} replace/>;
    const submit = methods.handleSubmit(async (values) => { setError(''); try {
        await signIn(values.username, values.password);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : t("登录失败，请稍后重试。"));
    } });
    return <AuthLayout><Stack spacing={1.5} sx={{ mb: 4 }}><Typography variant="h4" component="h1">{t("欢迎回来")}</Typography><Typography color="text.secondary" variant="body2">{t("登录 Moventra 运营工作台")}</Typography><Typography variant="body2">{t("没有账户？")}{' '}<Link component={RouterLink} to="/register" fontWeight={600}>{t("注册账户")}</Link></Typography></Stack>
    <FormProvider methods={methods} onSubmit={submit}><Stack spacing={2.5}>
      {error && <Alert severity="error">{locale === 'en' && /[\u4e00-\u9fff]/.test(error) ? t("登录失败，请核对账户或联系管理员。") : error}</Alert>}
      {isDemoMode && <Alert severity="info">{t("本地 Demo：demo@adsflow.local / demo-only")}</Alert>}
      <RHFTextField name="username" label={t("用户名")} autoComplete="username"/>
      <PasswordField />
      <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: 'flex-end' }}>{t("忘记密码？")}</Link>
      <Button type="submit" size="large" variant="contained" disabled={methods.formState.isSubmitting} startIcon={methods.formState.isSubmitting ? <CircularProgress size={18} color="inherit"/> : undefined}>{methods.formState.isSubmitting ? t("正在登录…") : t("登录工作台")}</Button>
      <Typography variant="caption" color="text.secondary" textAlign="center">{t("使用现有管理员账户登录。会话仅保留在当前页面。")}</Typography>
    </Stack></FormProvider>
  </AuthLayout>;
}

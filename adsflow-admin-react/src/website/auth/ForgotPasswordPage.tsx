import { useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as Yup from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Alert, Button, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import FormProvider from '../../minimals/components/hook-form/form-provider';
import RHFTextField from '../../minimals/components/hook-form/rhf-text-field';
import Iconify from '../../minimals/components/iconify/iconify';
export default function ForgotPasswordPage() {
    const { t, locale } = useLocale();
    const [checked, setChecked] = useState(false);
    const methods = useForm({ resolver: yupResolver(Yup.object({ email: Yup.string().trim().email(t("请输入有效的邮箱地址")).required(t("请输入邮箱")) })), defaultValues: { email: '' } });
    useEffect(() => {
      if (Object.keys(methods.formState.errors).length) void methods.trigger();
    }, [locale]);
    return <AuthLayout><Stack spacing={2} sx={{ mb: 4 }}><Iconify icon="solar:lock-password-bold-duotone" width={48} color="primary.main"/><Typography variant="h4" component="h1">{t("找回密码")}</Typography><Typography color="text.secondary">{t("填写注册邮箱，检查找回密码所需的信息。")}</Typography></Stack>
    <Alert severity="info" sx={{ mb: 3 }}>{t("邮件找回尚未接入。当前仅检查邮箱格式；请联系你的账户管理员重置密码。")}</Alert>
    <FormProvider methods={methods} onSubmit={methods.handleSubmit(() => setChecked(true))}><Stack spacing={2.5}><RHFTextField name="email" label={t("注册邮箱")} type="email" autoComplete="email" onInput={() => setChecked(false)}/><Button type="submit" variant="contained" size="large">{t("检查邮箱信息")}</Button>{checked && <Alert severity="info">{t("邮箱格式正确。未发送重置邮件，也未修改账户密码。")}</Alert>}<Link component={RouterLink} to="/login" textAlign="center" variant="subtitle2">{t("← 返回登录")}</Link></Stack></FormProvider>
  </AuthLayout>;
}

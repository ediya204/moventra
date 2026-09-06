import { useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as Yup from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Alert, Button, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { PasswordField } from './PasswordField';
import FormProvider from '../../minimals/components/hook-form/form-provider';
import RHFTextField from '../../minimals/components/hook-form/rhf-text-field';
// Based on Minimals ModernRegisterView; no demo logging or fake account creation.
export default function RegisterPage() {
    const { t, locale } = useLocale();
    const schema = Yup.object({ name: Yup.string().trim().required(t("请输入姓名")).max(80, t("姓名最多 80 个字符")), email: Yup.string().trim().email(t("请输入有效的邮箱地址")).required(t("请输入邮箱")), password: Yup.string().min(12, t("密码至少 12 位")).max(128, t("密码最多 128 位")).required(t("请输入密码")), confirmPassword: Yup.string().oneOf([Yup.ref('password')], t("两次输入的密码不一致")).required(t("请再次输入密码")) });
    const [checked, setChecked] = useState(false);
    const methods = useForm({ resolver: yupResolver(schema), defaultValues: { name: '', email: '', password: '', confirmPassword: '' } });
    useEffect(() => {
      if (Object.keys(methods.formState.errors).length) void methods.trigger();
    }, [locale]);
    return <AuthLayout><Stack spacing={1.5} sx={{ mb: 4 }}><Typography variant="h4" component="h1">{t("注册账户")}</Typography><Typography color="text.secondary" variant="body2">{t("填写以下信息，准备开通 Moventra 服务。")}</Typography><Typography variant="body2">{t("已有账户？")}{' '}<Link component={RouterLink} to="/login" fontWeight={600}>{t("立即登录")}</Link></Typography></Stack>
    <Alert severity="info" sx={{ mb: 3 }}>{t("注册功能预览：暂未开放自助开户，填写的信息不会上传或保存。")}</Alert>
    <FormProvider methods={methods} onSubmit={methods.handleSubmit(() => { methods.resetField('password'); methods.resetField('confirmPassword'); setChecked(true); })}><Stack spacing={2.5}>
      <RHFTextField name="name" label={t("姓名")} autoComplete="name"/>
      <RHFTextField name="email" label={t("邮箱地址")} autoComplete="email" type="email"/>
      <PasswordField autoComplete="new-password" label={t("设置密码（至少 12 位）")}/>
      <PasswordField name="confirmPassword" label={t("确认密码")} autoComplete="new-password"/>
      <Button type="submit" variant="contained" size="large">{t("检查注册信息")}</Button>
      {checked && <Alert severity="info">{t("格式检查通过，密码已清空。尚未创建账户；如需开通服务，请通过官网准备需求清单。")}</Alert>}
      <Link href="/#contact" variant="body2" textAlign="center">{t("咨询服务开通 →")}</Link>
    </Stack></FormProvider>
  </AuthLayout>;
}

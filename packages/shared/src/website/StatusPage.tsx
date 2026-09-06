import { useLocale, LanguageSwitch } from './i18n/index.tsx';
import { useEffect } from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import PageNotFoundIllustration from '../minimals/assets/illustrations/page-not-found-illustration';
import ForbiddenIllustration from '../minimals/assets/illustrations/forbidden-illustration';
import ServerErrorIllustration from '../minimals/assets/illustrations/sever-error-illustration';
import { PublicTheme } from './PublicTheme';
export default function StatusPage({ code = 404 }: {
    code?: 404 | 403 | 500;
}) {
    const { t, locale } = useLocale();
    const title = code === 404 ? t("页面不存在") : code === 403 ? t("无访问权限") : t("服务暂时不可用");
    const Illustration = code === 404 ? PageNotFoundIllustration : code === 403 ? ForbiddenIllustration : ServerErrorIllustration;
    useEffect(() => { const old = document.title; document.title = `${code} · ${title} | Moventra`; return () => { document.title = old; }; }, [code, title]);
    return <PublicTheme><Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: { xs: 3, md: 5 } }}><Stack direction="row" alignItems="center" justifyContent="space-between"><RouterLink to="/" aria-label={t("Moventra 首页")}><BrandLogo width={180}/></RouterLink><LanguageSwitch /></Stack><Container maxWidth="sm"><Stack alignItems="center" textAlign="center" spacing={3} sx={{ py: { xs: 7, md: 9 } }}><Typography variant="h3" component="h1" sx={{ fontSize: { xs: 28, md: 34 } }}>{title}</Typography><Typography color="text.secondary">{code === 404 ? t("请检查网址是否正确，或返回首页继续浏览。") : code === 403 ? t("请确认登录的账户，或联系管理员检查访问权限。") : t("请稍后重试，你也可以先返回官网。")}</Typography><Illustration sx={{ width: 1, maxWidth: 420, height: 'auto', my: 2 }}/><Stack direction="row" spacing={2}><Button component={RouterLink} to="/" variant="contained" size="large">{t("返回官网")}</Button><Button component={RouterLink} to="/login" variant="outlined" size="large">{t("前往登录")}</Button></Stack></Stack></Container></Box></PublicTheme>;
}

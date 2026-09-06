import { siteTitle } from '../../auth/site';
import { useLocale, LanguageSwitch } from '../i18n/index.tsx';
import { useEffect, type ReactNode } from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { BrandLogo } from '../../components/BrandLogo';
import SeoIllustration from '../../minimals/assets/illustrations/seo-illustration';
import Iconify from '../../minimals/components/iconify/iconify';
import { PublicTheme } from '../PublicTheme';
/** Minimals AuthClassicLayout composition, adapted to React Router and Moventra. */
export default function AuthLayout({ children }: {
    children: ReactNode;
}) {
    const { t, locale } = useLocale();
    const { pathname } = useLocation();
    useEffect(() => { const old = document.title; document.title = `${pathname === '/register' ? t("注册账户") : pathname === '/forgot-password' ? t("找回密码") : t("登录")} | Moventra`; return () => { document.title = old; }; }, [pathname, locale]);
    return <PublicTheme><Box sx={{ minHeight: '100vh', bgcolor: 'background.paper' }}>
    <Stack component="header" direction="row" alignItems="center" justifyContent="space-between" sx={{ px: { xs: 2, md: 5 }, py: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
      <RouterLink to="/" aria-label={t("Moventra 首页")}><Box sx={{ width: { xs: 120, sm: 180 } }}><BrandLogo width={180}/></Box></RouterLink>
      <Stack direction="row" alignItems="center"><LanguageSwitch /><Button component={RouterLink} to="/" color="inherit" startIcon={<Iconify icon="eva:arrow-back-fill"/>}>{t("返回官网")}</Button></Stack>
    </Stack>
    <Container maxWidth="lg" sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: '1.1fr 1fr' }, gap: { md: 10 }, alignItems: 'center', minHeight: 'calc(100vh - 108px)', py: { xs: 6, md: 7 } }}>
      <Stack spacing={3} alignItems="center" sx={{ display: { xs: 'none', md: 'flex' }, p: { md: 3, lg: 5 } }}>
        <Typography variant="h3" component="h2" textAlign="center">{siteTitle}</Typography>
        <SeoIllustration sx={{ maxWidth: 420, height: 'auto' }}/>
        <Typography variant="body2" color="text.secondary">{t("广告营销 · AI 订阅 · 订阅卡 · 云服务")}</Typography>
      </Stack>
      <Box sx={{ width: 1, maxWidth: 440, mx: 'auto' }}>{children}</Box>
    </Container>
  </Box></PublicTheme>;
}

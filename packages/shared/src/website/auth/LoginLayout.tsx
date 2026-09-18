import { useEffect, type ReactNode } from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { BrandLogo } from '../../components/BrandLogo';
import { isAdminSite } from '../../auth/site';
import { LanguageSwitch, useLocale } from '../i18n/index.tsx';
import { PublicTheme } from '../PublicTheme';
import SeoIllustration from '../../minimals/assets/illustrations/seo-illustration';

/** Login-only layout: registration and recovery keep their existing shell. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const title = `${t('登录')} | Moventra`;
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
  return <PublicTheme><Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, bgcolor: 'background.paper' }}>
    <Stack component="aside" sx={{ display: { xs: 'none', md: 'flex' }, position: 'relative', overflow: 'hidden', bgcolor: 'background.paper', color: 'text.primary', borderRight: '1px solid', borderColor: 'divider', p: { md: 4, lg: 5 }, minHeight: '100dvh', justifyContent: 'space-between' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ position: 'relative', color: 'text.secondary' }}>
        <Icon icon="solar:shield-check-linear" width={18} /><Typography variant="caption" sx={{ letterSpacing: 1 }}>{t('安全连接 · 专注每一笔业务')}</Typography>
      </Stack>
      <Box sx={{ position: 'relative', my: 3, maxWidth: 580 }}>
        <BrandLogo width={180} />
        <Typography component="h2" sx={{ mt: 3, fontWeight: 700, fontSize: { md: 38, lg: 48 }, letterSpacing: '-0.045em', lineHeight: 1.18 }}>
          {t('连接全球业务')}<Box component="span" sx={{ display: 'block', color: 'primary.main', mt: 1 }}>{t('从容管理每一步')}</Box>
        </Typography>
        <Typography sx={{ mt: 2, maxWidth: 420, color: 'text.secondary', lineHeight: 1.9 }}>{t('让卡片、账户与交易清晰相连，为您的日常业务提供更有序的工作空间。')}</Typography>
        <SeoIllustration aria-hidden="true" sx={{ display: 'block', width: '100%', maxWidth: 360, height: { md: 210, lg: 240 }, mt: 2, mx: 'auto' }} />
      </Box>
      <Box sx={{ position: 'relative' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3, pb: 2.5 }}>
          {[
            ['solar:card-linear', '卡片管理', '集中查看，清晰掌握'],
            ['solar:transfer-horizontal-linear', '交易记录', '每笔动态，有迹可循'],
            ['solar:shield-keyhole-linear', '账户安全', '多重验证，安心访问'],
          ].map(([icon, title, subtitle]) => <Box key={title}><Box sx={{ color: 'primary.main', mb: 1.5 }}><Icon icon={icon} width={25} /></Box><Typography fontWeight={600} variant="body2">{t(title)}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>{t(subtitle)}</Typography></Box>)}
        </Box>
        <Typography variant="caption" sx={{ display: 'block', pt: 2.5, borderTop: '1px solid', borderColor: 'divider', color: 'text.secondary' }}>MOVENTRA · {t('让业务更进一步')}</Typography>
      </Box>
    </Stack>
    <Stack component="main" sx={{ minWidth: 0, minHeight: '100dvh', px: { xs: 3, sm: 6 }, py: 3 }}>
      <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={2}>
        {!isAdminSite && <Link component={RouterLink} to="/" color="text.secondary" variant="body2">{t('返回官网')}</Link>}<LanguageSwitch />
      </Stack>
      <Stack sx={{ flex: 1, justifyContent: 'center', width: '100%', maxWidth: 400, mx: 'auto', py: { xs: 7, md: 8 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4.5 }}><BrandLogo width={216} /></Box>
        {children}
      </Stack>
      <Typography variant="caption" textAlign="center" color="text.secondary" sx={{ pb: 1 }}>© {new Date().getFullYear()} Moventra</Typography>
    </Stack>
  </Box></PublicTheme>;
}

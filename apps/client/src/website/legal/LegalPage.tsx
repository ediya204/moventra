import { useEffect } from 'react';
import { Alert, Box, Button, Container, Divider, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { BrandLogo } from '../../../../../packages/shared/src/components/BrandLogo';
import { PublicTheme } from '../../../../../packages/shared/src/website/PublicTheme';
import { LanguageSwitch, useLocale } from '../../../../../packages/shared/src/website/i18n/index.tsx';
import LegalLinks from './LegalLinks';
import { companyName, policies, policyDate, policyDraft, policyLinks, type PolicyKind } from './policies';

export default function LegalPage({ kind }: { kind: PolicyKind }) {
  const { locale } = useLocale();
  const policy = policies[kind];
  useEffect(() => {
    const previous = document.title;
    document.title = `${policy.title[locale]} | ${companyName}`;
    window.scrollTo(0, 0);
    return () => { document.title = previous; };
  }, [kind, locale, policy]);
  return <PublicTheme><Box sx={{ minHeight: '100vh', bgcolor: 'background.paper' }}>
    <Box component="header" sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Container maxWidth="lg"><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 3 }}>
        <Link component={RouterLink} to="/" aria-label={locale === 'zh' ? 'Moventra 首页' : 'Moventra home'}><BrandLogo width={150} /></Link>
        <Stack direction="row"><LanguageSwitch /><Button component={RouterLink} to="/" color="inherit">{locale === 'zh' ? '返回官网' : 'Back to home'}</Button></Stack>
      </Stack></Container>
    </Box>
    <Container component="main" maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={2} sx={{ mb: 5 }}>
        <Typography variant="overline" color="primary.main">{companyName}</Typography>
        <Typography variant="h3" component="h1">{policy.title[locale]}</Typography>
        <Typography color="text.secondary">{policy.summary[locale]}</Typography>
        <Typography variant="body2" color="text.secondary">{locale === 'zh' ? '更新日期' : 'Last updated'}: <time dateTime={policyDate}>{policyDate}</time></Typography>
        {policyDraft && <Alert severity="info">{locale === 'zh' ? '审阅草案：线上 Cookie 清单尚待核实，暂不作为正式生效版本。' : 'Review draft: the deployed cookie inventory awaits verification. This is not yet an effective published policy.'}</Alert>}
      </Stack>
      <Stack component="nav" aria-label={locale === 'zh' ? '政策导航' : 'Policy navigation'} direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 4 }}>
        {policyLinks.map(link => <Button key={link.kind} component={RouterLink} to={link.href} variant={kind === link.kind ? 'contained' : 'outlined'} aria-current={kind === link.kind ? 'page' : undefined}>{link.label[locale]}</Button>)}
      </Stack>
      <Box component="nav" aria-label={locale === 'zh' ? '本页目录' : 'On this page'} sx={{ bgcolor: 'background.default', p: 3, borderRadius: 2, mb: 5 }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>{locale === 'zh' ? '本页内容' : 'On this page'}</Typography>
        <Stack spacing={1}>{policy.sections.map((section, index) => <Link key={index} href={`#section-${index + 1}`} variant="body2">{index + 1}. {section.title[locale]}</Link>)}</Stack>
      </Box>
      <Stack component="article" spacing={4}>{policy.sections.map((section, index) => <Box component="section" key={index} id={`section-${index + 1}`} sx={{ scrollMarginTop: 24 }}>
        <Typography component="h2" variant="h5" sx={{ mb: 2 }}>{index + 1}. {section.title[locale]}</Typography>
        <Stack spacing={2}>{section.paragraphs.map((paragraph, paragraphIndex) => <Typography key={paragraphIndex} sx={{ lineHeight: 1.9, overflowWrap: 'anywhere' }}>{paragraph[locale]}</Typography>)}</Stack>
      </Box>)}</Stack>
    </Container>
    <Container component="footer" maxWidth="lg"><Divider /><LegalLinks /></Container>
  </Box></PublicTheme>;
}

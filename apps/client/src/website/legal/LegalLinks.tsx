import { Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useLocale } from '../../../../../packages/shared/src/website/i18n/index.tsx';
import { companyName, policyLinks } from './policies';

export default function LegalLinks() {
  const { locale } = useLocale();
  return <Stack spacing={1.5} sx={{ py: 3 }}>
    <Stack component="nav" aria-label={locale === 'zh' ? '法律与隐私' : 'Legal and privacy'} direction="row" spacing={2.5} useFlexGap flexWrap="wrap">
      {policyLinks.map(link => <Link key={link.kind} component={RouterLink} to={link.href} variant="body2" color="text.secondary">{link.label[locale]}</Link>)}
    </Stack>
    <Typography variant="caption" color="text.secondary">© {new Date().getFullYear()} {companyName}. All rights reserved.</Typography>
  </Stack>;
}

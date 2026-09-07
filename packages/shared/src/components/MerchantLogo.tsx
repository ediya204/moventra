import { useState } from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import { companyLogoUrl, merchantBrand } from './merchantBrand';

// Publishable client-side key, intentionally not a server credential.
const publishableKey = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY ?? 'pk_blU5waN7QUGrS0ZndewmFw';

export function MerchantLogo({ name, size = 32 }: { name?: string | null; size?: number }) {
  const brand = merchantBrand(name);
  const src = brand ? companyLogoUrl(brand, publishableKey) : undefined;
  const [failedSrc, setFailedSrc] = useState<string>();
  const available = Boolean(src && src !== failedSrc);
  return <Box title={brand ? `品牌图标参考：${brand}（名称匹配）${available ? '' : ' · 图标暂不可用'}` : '商户图标暂无'} sx={{
    width: size, height: size, flexShrink: 0, display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', borderRadius: '50%', overflow: 'hidden',
    bgcolor: available ? 'common.white' : 'action.hover', color: 'text.secondary',
  }}>
    {available ? <Box component="img" key={src} src={src} alt={`${brand} logo`}
      width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}/>
      : brand ? <Typography component="span" aria-label={`${brand} 图标暂不可用`} sx={{ fontSize: size * .45, fontWeight: 700, lineHeight: 1 }}>{brand[0]}</Typography>
      : <Box component="svg" viewBox="0 0 24 24" width={Math.round(size * .6)} height={Math.round(size * .6)} aria-label="默认商户图标" role="img" sx={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6M9 4v6m6-6v6"/>
        </Box>}
  </Box>;
}

export function MerchantCell({ name }: { name?: string | null }) {
  return <Stack direction="row" alignItems="center" gap={1.25} sx={{ height: '100%', minWidth: 0, width: '100%' }}>
    <MerchantLogo name={name}/>
    <Typography variant="body2" noWrap title={name || undefined} sx={{ minWidth: 0, flex: 1, color: 'inherit' }}>{name || '—'}</Typography>
  </Stack>;
}

export function LogoAttribution() {
  return <Link href="https://logo.dev" target="_blank" rel="noopener" variant="caption" color="text.secondary">Logos provided by Logo.dev</Link>;
}

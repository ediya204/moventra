import { Box } from '@mui/material';

/** Shared vector identity for admin, client and mobile navigation. */
export function BrandLogo({ inverse = false, width = 180 }: { inverse?: boolean; width?: number }) {
  return (
    <Box
      component="img"
      src={`${import.meta.env.BASE_URL}brand/moventra-logo${inverse ? '-inverse' : ''}.svg`}
      alt="Moventra"
      width={width}
      height={width * 116 / 540}
      sx={{ display: 'block', maxWidth: '100%', height: 'auto', flexShrink: 0 }}
    />
  );
}

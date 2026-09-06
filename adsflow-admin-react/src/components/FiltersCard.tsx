import type { ReactNode } from 'react';
import { Card, Stack } from '@mui/material';

export function FiltersCard({ children }: { children: ReactNode }) {
  return (
    <Card
      component="section"
      aria-label="筛选条件"
      sx={{ p: 2.5, mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }}>
        {children}
      </Stack>
    </Card>
  );
}

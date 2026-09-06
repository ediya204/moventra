import type { ReactNode } from 'react';
import { Box, Breadcrumbs, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export function PageHeader({
  title,
  description,
  breadcrumbs,
  action,
}: {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; to?: string }[];
  action?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      alignItems={{ md: 'flex-start' }}
      justifyContent="space-between"
      gap={2}
      sx={{ mb: 3 }}
    >
      <Box>
        {breadcrumbs?.length ? (
          <Breadcrumbs sx={{ mb: 1 }}>
            {breadcrumbs.map((item) =>
              item.to ? (
                <Link key={item.label} component={RouterLink} to={item.to} color="inherit">
                  {item.label}
                </Link>
              ) : (
                <Typography key={item.label} variant="body2" color="text.secondary">
                  {item.label}
                </Typography>
              ),
            )}
          </Breadcrumbs>
        ) : null}
        <Typography variant="h4">{title}</Typography>
        {description ? (
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 760 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action}
    </Stack>
  );
}

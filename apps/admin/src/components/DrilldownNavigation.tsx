import { Icon } from '@iconify/react';
import { Box, Button, Card, Chip, Divider, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export type DrilldownStep = {
  label: string;
  route?: string;
};

export function DrilldownNavigation({
  steps,
  siblings = [],
}: {
  steps: DrilldownStep[];
  siblings?: { label: string; route: string; active?: boolean; count?: number }[];
}) {
  const navigate = useNavigate();

  return (
    <Card sx={{ mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} alignItems={{ lg: 'center' }} gap={1.5} sx={{ px: 2.5, py: 1.75 }}>
        <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap">
          <Icon icon="solar:branching-paths-up-bold-duotone" width={21} />
          {steps.map((step, index) => (
            <Stack direction="row" alignItems="center" gap={0.75} key={`${step.label}-${index}`}>
              {index ? <Icon icon="solar:alt-arrow-right-linear" width={15} /> : null}
              {step.route ? (
                <Button size="small" color="inherit" onClick={() => navigate(step.route!)} sx={{ minWidth: 0, px: 0.7 }}>
                  {step.label}
                </Button>
              ) : <Typography variant="subtitle2" color="primary.main">{step.label}</Typography>}
            </Stack>
          ))}
        </Stack>
        {siblings.length ? <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', lg: 'block' } }} /> : null}
        {siblings.length ? (
          <Stack direction="row" gap={0.8} flexWrap="wrap" sx={{ ml: { lg: 'auto' } }}>
            {siblings.map((item) => (
              <Chip
                key={item.route}
                clickable
                color={item.active ? 'primary' : 'default'}
                variant={item.active ? 'filled' : 'outlined'}
                label={`${item.label}${item.count === undefined ? '' : ` ${item.count}`}`}
                onClick={() => navigate(item.route)}
              />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

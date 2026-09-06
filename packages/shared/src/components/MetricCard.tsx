import { Icon } from '@iconify/react';
import { alpha, Box, Card, Stack, Typography, useTheme } from '@mui/material';

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary';

export function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: string | number;
  helper?: string;
  icon: string;
  tone?: Tone;
}) {
  const theme = useTheme();
  const color = theme.palette[tone].main;

  return (
    <Card sx={{ p: 3, minHeight: 132, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h4" sx={{ mt: 0.8, letterSpacing: -0.5 }}>
            {value}
          </Typography>
          {helper ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.7 }}>
              {helper}
            </Typography>
          ) : null}
        </Box>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            color,
            bgcolor: alpha(color, 0.12),
            flexShrink: 0,
          }}
        >
          <Icon icon={icon} width={26} />
        </Box>
      </Stack>
    </Card>
  );
}

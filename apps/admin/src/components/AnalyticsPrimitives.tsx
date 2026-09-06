import type { ReactNode } from 'react';
import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  ButtonBase,
  Card,
  Chip,
  Divider,
  Grid,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { dataSourceLabel } from '../../../../packages/shared/src/utils/dataMode';

export function AnalyticsContextBar({
  period,
  scope,
  freshness,
  source = dataSourceLabel,
  sample = false,
}: {
  period: string;
  scope: string;
  freshness?: string;
  source?: string;
  sample?: boolean;
}) {
  const items = [
    { icon: 'solar:calendar-date-bold-duotone', label: '统计周期', value: period },
    { icon: 'solar:filter-bold-duotone', label: '数据范围', value: scope },
    { icon: 'solar:database-bold-duotone', label: '数据来源', value: source },
    ...(freshness ? [{ icon: 'solar:clock-circle-bold-duotone', label: '数据时间', value: freshness }] : []),
  ];

  return (
    <Card sx={{ mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ md: 'center' }}
        divider={<Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', md: 'block' } }} />}
        spacing={{ xs: 1.5, md: 2.5 }}
        sx={{ px: 2.5, py: 1.75 }}
      >
        {items.map((item) => (
          <Stack key={item.label} direction="row" alignItems="center" gap={1.1} sx={{ minWidth: 0 }}>
            <Box sx={{ color: 'primary.main', display: 'grid', placeItems: 'center' }}>
              <Icon icon={item.icon} width={20} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">{item.label}</Typography>
              <Typography variant="subtitle2" noWrap>{item.value}</Typography>
            </Box>
          </Stack>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={sample ? '汇总仅基于当前接口返回的分页记录，不能代表全部账户。' : '汇总字段由服务端接口直接返回。'}>
          <Chip
            size="small"
            variant="outlined"
            color={sample ? 'warning' : 'success'}
            icon={<Icon icon={sample ? 'solar:test-tube-bold' : 'solar:verified-check-bold'} width={16} />}
            label={sample ? '当前加载样本' : '服务端汇总'}
          />
        </Tooltip>
      </Stack>
    </Card>
  );
}

type Insight = {
  label: string;
  detail: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
};

export function InsightSummary({ title = '运营洞察', insights }: { title?: string; insights: Insight[] }) {
  if (!insights.length) return null;
  const severity = insights.some((item) => item.tone === 'error')
    ? 'error'
    : insights.some((item) => item.tone === 'warning')
      ? 'warning'
      : 'info';

  return (
    <Alert
      severity={severity}
      icon={<Icon icon="solar:lightbulb-bolt-bold-duotone" width={24} />}
      sx={{ mb: 3, alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%' } }}
    >
      <Typography variant="subtitle2" sx={{ mb: 0.6 }}>{title}</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 0.5, md: 2.5 }}>
        {insights.map((item) => (
          <Typography key={`${item.label}-${item.detail}`} variant="body2">
            <Box component="span" sx={{ fontWeight: 700 }}>{item.label}：</Box>{item.detail}
          </Typography>
        ))}
      </Stack>
    </Alert>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-end' }} gap={1} sx={{ mb: 1.5 }}>
      <Box>
        <Typography variant="h6">{title}</Typography>
        {description ? <Typography variant="body2" color="text.secondary">{description}</Typography> : null}
      </Box>
      {action}
    </Stack>
  );
}

export type Scenario = {
  title: string;
  description: string;
  route: string;
  icon: string;
  metric?: string;
};

export function ScenarioGrid({ scenarios }: { scenarios: Scenario[] }) {
  const navigate = useNavigate();
  return (
    <Grid container spacing={2}>
      {scenarios.map((scenario) => (
        <Grid item xs={12} sm={6} lg={4} key={scenario.title}>
          <ButtonBase
            onClick={() => navigate(scenario.route)}
            sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 2 }}
          >
            <Card
              sx={{
                p: 2.5,
                width: '100%',
                height: '100%',
                minHeight: 150,
                boxShadow: 'none',
                border: 1,
                borderColor: 'divider',
                transition: 'border-color 160ms ease, transform 160ms ease',
                '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)' },
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
                <Box sx={{ width: 42, height: 42, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: 'primary.lighter', color: 'primary.dark' }}>
                  <Icon icon={scenario.icon} width={24} />
                </Box>
                {scenario.metric ? <Chip size="small" label={scenario.metric} /> : null}
              </Stack>
              <Typography variant="subtitle1" sx={{ mt: 2 }}>{scenario.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{scenario.description}</Typography>
            </Card>
          </ButtonBase>
        </Grid>
      ))}
    </Grid>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardHeader,
  Divider,
  Grid,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getCardOverview, getDashboard } from '../../../../packages/shared/src/api/queries';
import { ChartCard } from '../../../../packages/shared/src/components/ChartCard';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { asRecord, formatAmount, formatNumber, numberValue, toRows } from '../utils/format';

type DashboardState = Awaited<ReturnType<typeof getDashboard>>;

export function WorkbenchPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardState | null>(null);
  const [cardOverview, setCardOverview] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboard, cards] = await Promise.all([getDashboard(), getCardOverview()]);
      setData(dashboard);
      setCardOverview(cards);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '运营数据读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const model = useMemo(() => {
    const critical = asRecord(data?.critical);
    const secondary = asRecord(data?.secondary);
    const criticalOverview = asRecord(critical.overview || critical);
    const secondaryOverview = asRecord(secondary.overview || secondary);
    const kpis = asRecord(criticalOverview.todayKpis || critical.todayKpis);
    const alerts = asRecord(criticalOverview.alerts || critical.alerts);
    const structure = asRecord(secondaryOverview.platformStructure || secondary.platformStructure);
    const cardAssets = asRecord(structure.cardAssets);
    const trends = asRecord(secondaryOverview.trends || secondary.trends);
    const tradeTrend = toRows(trends.trade).length ? toRows(trends.trade) : toRows(cardOverview.tradeTrend);
    const alertList = toRows(criticalOverview.alertList || critical.alertList);

    return {
      metrics: [
        {
          label: '今日卡交易金额',
          value: formatAmount(kpis.todayTradeAmount),
          helper: `${formatNumber(kpis.todayTradeCount)} 笔交易`,
          icon: 'solar:card-send-bold-duotone',
          tone: 'primary' as const,
        },
        {
          label: '活跃卡片',
          value: formatNumber(cardAssets.activeCardCount),
          helper: `全部卡片 ${formatNumber(cardAssets.totalCardCount)}`,
          icon: 'solar:card-check-bold-duotone',
          tone: 'success' as const,
        },
        {
          label: '失败交易',
          value: formatNumber(kpis.todayFailTradeCount),
          helper: formatAmount(kpis.todayFailTradeAmount),
          icon: 'solar:danger-triangle-bold-duotone',
          tone: 'error' as const,
        },
        {
          label: '风险卡片',
          value: formatNumber(alerts.riskCardCount || cardAssets.riskCardCount),
          helper: `负余额 ${formatAmount(cardAssets.negativeBalanceTotal)}`,
          icon: 'solar:shield-warning-bold-duotone',
          tone: 'warning' as const,
        },
      ],
      tradeCategories: tradeTrend.map((item) => String(item.date || '')),
      tradeSeries: [
        {
          name: '交易金额',
          type: 'area',
          data: tradeTrend.map((item) => numberValue(item.tradeAmount)),
        },
        {
          name: '交易笔数',
          type: 'line',
          data: tradeTrend.map((item) => numberValue(item.tradeCount)),
        },
      ],
      alerts: alertList,
      fallbackAlerts: [
        { key: 'failed', title: '失败交易', count: kpis.todayFailTradeCount, route: '/transactions?status=2' },
        { key: 'risk', title: '风险卡片', count: alerts.riskCardCount, route: '/risk?tab=cards' },
        { key: 'otp', title: 'OTP 异常', count: alerts.otpAlertCount, route: '/cards/otp' },
        { key: 'pending', title: '待处理交易', count: kpis.todayPendingTradeCount, route: '/transactions?status=0' },
      ],
    };
  }, [cardOverview, data]);

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="运营工作台"
        description="围绕卡片、交易和风险的今日状态，优先展示需要关注的异常。"
        action={
          <Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>
            重新读取
          </Button>
        }
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {model.metrics.map((metric) => (
          <Grid item xs={12} sm={6} lg={3} key={metric.label}>
            <MetricCard {...metric} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <ChartCard
            title="卡交易趋势"
            subheader="交易金额与交易笔数"
            type="line"
            categories={model.tradeCategories}
            series={model.tradeSeries}
            height={350}
          />
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card sx={{ height: '100%' }}>
            <CardHeader title="异常队列" subheader="按业务影响优先处理" />
            <Divider />
            <List sx={{ p: 1.5 }}>
              {(model.alerts.length ? model.alerts : model.fallbackAlerts).map((item, index) => {
                const route = String(item.route || '/risk');
                const count = formatNumber(item.count);
                return (
                  <ListItemButton
                    key={String(item.key || item.title || index)}
                    onClick={() => navigate(route)}
                    sx={{ py: 1.5, borderRadius: 1.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 42, color: index < 2 ? 'error.main' : 'warning.main' }}>
                      <Icon icon="solar:danger-circle-bold-duotone" width={25} />
                    </ListItemIcon>
                    <ListItemText
                      primary={String(item.title || '待关注事项')}
                      secondary={String(('description' in item && item.description) || '查看相关业务数据')}
                      primaryTypographyProps={{ variant: 'subtitle2' }}
                      secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                    />
                    <Typography variant="h6">{count}</Typography>
                  </ListItemButton>
                );
              })}
            </List>
            <Box sx={{ px: 3, pb: 3 }}>
              <Button fullWidth color="inherit" onClick={() => navigate('/risk')}>
                查看风险中心
              </Button>
            </Box>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}

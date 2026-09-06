import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardHeader,
  Chip,
  Divider,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getCardOverview } from '../api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { ChartCard } from '../components/ChartCard';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { asRecord, formatAmount, formatNumber, formatPercent, maskCard, numberValue, pickValue, toRows } from '../utils/format';

type QueueConfig = {
  key: string;
  title: string;
  description: string;
  icon: string;
  tone: 'error' | 'warning' | 'info' | 'secondary';
};

const queueConfigs: QueueConfig[] = [
  { key: 'failTrades', title: '连续失败交易', description: '优先查看失败次数与账户关联', icon: 'solar:close-circle-bold-duotone', tone: 'error' },
  { key: 'otpHighFreq', title: '高频 OTP', description: '短时收到多次验证请求', icon: 'solar:lock-password-bold-duotone', tone: 'warning' },
  { key: 'lowBalance', title: '低余额卡片', description: '可能影响后续广告扣款', icon: 'solar:wallet-money-bold-duotone', tone: 'info' },
  { key: 'recentFrozen', title: '最近冻结', description: '追踪卡片冻结后的交易影响', icon: 'solar:snowflake-bold-duotone', tone: 'secondary' },
];

const toneColor = { error: 'error.main', warning: 'warning.main', info: 'info.main', secondary: 'secondary.main' } as const;

export function CardsOverviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getCardOverview());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '卡片总览读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = asRecord(data.summary);
  const tradeTrend = toRows(data.tradeTrend);
  const statusStats = toRows(data.statusStats);
  const binStats = toRows(data.binStats).slice(0, 8);
  const riskCards = asRecord(data.riskCards);
  const activeRate = formatPercent(summary.activeCardCount, summary.totalCardCount);
  const freezeRate = formatPercent(summary.freezeCardCount, summary.totalCardCount);
  const averageBalance = numberValue(summary.totalCardCount)
    ? numberValue(summary.totalCardBalance) / numberValue(summary.totalCardCount)
    : 0;

  const trendSeries = useMemo(() => [
    { name: '交易金额', data: tradeTrend.map((row) => numberValue(row.tradeAmount)) },
    { name: '交易笔数', data: tradeTrend.map((row) => numberValue(row.tradeCount)) },
  ], [tradeTrend]);

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="卡片运营总览"
        description="先看卡片规模、活跃度与异常队列，再进入单卡和账户组追溯。"
        action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新实时数据</Button>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period="当前卡片快照 + 接口近期趋势" scope="全平台卡片" />
      <InsightSummary insights={[
        { label: '卡片供给', detail: `活跃率 ${activeRate}，冻结率 ${freezeRate}`, tone: numberValue(summary.freezeCardCount) > 0 ? 'warning' : 'success' },
        { label: '资产效率', detail: `单卡平均余额 ${formatAmount(averageBalance)}`, tone: 'info' },
        { label: '今日信号', detail: `${formatNumber(summary.todayFailTradeCount)} 笔失败交易，${formatNumber(summary.todayOtpCount)} 次 OTP`, tone: numberValue(summary.todayFailTradeCount) > 0 ? 'warning' : 'info' },
      ]} />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="活跃卡片率" value={activeRate} helper={`${formatNumber(summary.activeCardCount)} / ${formatNumber(summary.totalCardCount)} 张`} icon="solar:card-check-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="卡片总余额" value={formatAmount(summary.totalCardBalance)} helper={`单卡平均 ${formatAmount(averageBalance)}`} icon="solar:wallet-money-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="今日交易" value={formatAmount(summary.todayTradeAmount)} helper={`${formatNumber(summary.todayTradeCount)} 笔`} icon="solar:transfer-horizontal-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="今日异常信号" value={formatNumber(numberValue(summary.todayFailTradeCount) + numberValue(summary.todayOtpCount))} helper={`${formatNumber(summary.todayFailTradeCount)} 失败 · ${formatNumber(summary.todayOtpCount)} OTP`} icon="solar:danger-triangle-bold-duotone" tone="warning" /></Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={7}>
          <ChartCard
            title="近期待卡交易趋势"
            subheader="金额与笔数使用相同时间轴，观察活跃度变化"
            type="area"
            series={trendSeries}
            categories={tradeTrend.map((row) => String(row.date || ''))}
            height={310}
          />
        </Grid>
        <Grid item xs={12} md={6} lg={2.5}>
          <ChartCard
            title="卡片状态"
            subheader="当前结构"
            type="donut"
            series={statusStats.map((row) => numberValue(row.count))}
            height={310}
            options={{ labels: statusStats.map((row) => ({ 1: '活跃', 2: '冻结', 3: '注销', 999: '待开卡' }[String(row.cardStatus)] || `状态 ${row.cardStatus}`)), legend: { position: 'bottom' } }}
          />
        </Grid>
        <Grid item xs={12} md={6} lg={2.5}>
          <ChartCard
            title="主要 BIN"
            subheader="前 8 个卡段"
            type="bar"
            series={[{ name: '卡片数', data: binStats.map((row) => numberValue(row.count)) }]}
            categories={binStats.map((row) => String(row.cardBin || '-'))}
            height={310}
            options={{ plotOptions: { bar: { horizontal: true, borderRadius: 3 } }, legend: { show: false } }}
          />
        </Grid>
      </Grid>

      <Stack id="queues" direction="row" justifyContent="space-between" alignItems="end" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="h6">运营智能队列</Typography>
          <Typography variant="body2" color="text.secondary">按异常类型切分，无需在全部卡片里反复筛选。</Typography>
        </Box>
        <Button onClick={() => navigate('/cards')} endIcon={<Icon icon="solar:arrow-right-linear" />}>进入全部卡片</Button>
      </Stack>
      <Grid container spacing={2.5}>
        {queueConfigs.map((queue) => {
          const rows = toRows(riskCards[queue.key]);
          return (
            <Grid item xs={12} md={6} key={queue.key}>
              <Card sx={{ height: '100%' }}>
                <CardHeader
                  avatar={<Box sx={{ width: 42, height: 42, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: 'grey.100', color: toneColor[queue.tone] }}><Icon icon={queue.icon} width={25} /></Box>}
                  title={queue.title}
                  subheader={queue.description}
                  action={<Chip label={`${rows.length} 条`} size="small" />}
                />
                <Divider />
                {rows.length ? (
                  <List disablePadding>
                    {rows.slice(0, 5).map((row, index) => {
                      const cardId = String(pickValue(row, ['cardId', 'id'], ''));
                      const primary = queue.key === 'otpHighFreq'
                        ? `卡片 ${cardId}`
                        : maskCard(pickValue(row, ['cardNo', 'cardNoMasked', 'cardId']));
                      const detail = queue.key === 'failTrades'
                        ? `${formatNumber(row.failCount)} 次失败 · ${pickValue(row, ['userEmail', 'userId'])}`
                        : queue.key === 'otpHighFreq'
                          ? `${formatNumber(row.otpCount)} 次 OTP`
                          : queue.key === 'lowBalance'
                            ? `${formatAmount(row.cardBalance)} · ${pickValue(row, ['userEmail', 'userId'])}`
                            : String(pickValue(row, ['userEmail', 'userId'], '冻结卡片'));
                      return (
                        <ListItemButton key={`${cardId}-${index}`} onClick={() => navigate(`/analytics/topics/cards/${queue.key === 'recentFrozen' ? 'frozen' : queue.key === 'lowBalance' ? 'low-balance' : 'all'}`)} sx={{ px: 2.5, py: 1.25 }}>
                          <ListItemText primary={primary} secondary={detail} primaryTypographyProps={{ variant: 'subtitle2' }} secondaryTypographyProps={{ noWrap: true }} />
                          <Icon icon="solar:alt-arrow-right-linear" width={18} />
                        </ListItemButton>
                      );
                    })}
                  </List>
                ) : <Typography variant="body2" color="text.secondary" sx={{ p: 3 }}>当前没有这类异常。</Typography>}
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}

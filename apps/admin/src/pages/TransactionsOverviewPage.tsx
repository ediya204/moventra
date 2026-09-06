import { useCallback, useEffect, useState } from 'react';
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
import { getTradeOverview } from '../../../../packages/shared/src/api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { ChartCard } from '../../../../packages/shared/src/components/ChartCard';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, formatPercent, numberValue, pickValue, toRows } from '../utils/format';

const billTypeLabel: Record<string, string> = { '1': '消费', '2': '退款', '3': '撤销', '4': '充值', '5': '手续费' };
const statusLabel: Record<string, string> = { '0': '待处理', '1': '成功', '2': '失败' };

export function TransactionsOverviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getTradeOverview());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '交易总览读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PageSkeleton />;

  const summary = asRecord(data.summary);
  const amountTrend = toRows(data.tradeAmountTrend);
  const typeDistribution = toRows(data.typeDistribution);
  const statusDistribution = toRows(data.statusDistribution);
  const quickAccess = asRecord(data.quickAccess);
  const totalTrades = numberValue(summary.todayTradeCount);
  const successTrades = numberValue(summary.todaySuccessTradeCount);
  const failedTrades = numberValue(summary.todayFailTradeCount);
  const pendingTrades = numberValue(summary.todayPendingTradeCount);
  const averageTrade = totalTrades ? numberValue(summary.todayTradeAmount) / totalTrades : 0;
  const queues = [
    { key: 'recentFailedTrades', title: '最近失败', caption: '优先核对商户、卡片状态与账户资金', icon: 'solar:close-circle-bold-duotone', color: 'error.main' },
    { key: 'recentPendingTrades', title: '待处理交易', caption: '持续停留在处理中状态的交易', icon: 'solar:clock-circle-bold-duotone', color: 'warning.main' },
    { key: 'todayLargeTrades', title: '今日大额', caption: '快速识别资金影响较大的交易', icon: 'solar:graph-up-bold-duotone', color: 'info.main' },
  ];

  return (
    <>
      <PageHeader
        title="交易运营总览"
        description="用金额趋势、状态分布和异常队列组织交易调查路径。"
        action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新实时数据</Button>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period="今日汇总 + 接口近期趋势" scope="全平台卡交易" />
      <InsightSummary insights={[
        { label: '交易结果', detail: `成功率 ${formatPercent(successTrades, totalTrades)}，失败率 ${formatPercent(failedTrades, totalTrades)}`, tone: failedTrades > 0 ? 'warning' : 'success' },
        { label: '处理积压', detail: `${formatNumber(pendingTrades)} 笔待处理，占比 ${formatPercent(pendingTrades, totalTrades)}`, tone: pendingTrades > 0 ? 'warning' : 'info' },
        { label: '交易强度', detail: `今日均笔金额 ${formatAmount(averageTrade)}`, tone: 'info' },
      ]} />
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="今日交易金额" value={formatAmount(summary.todayTradeAmount)} helper={`${formatNumber(summary.todayTradeCount)} 笔`} icon="solar:wallet-money-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="交易成功率" value={formatPercent(successTrades, totalTrades)} helper={`${formatNumber(successTrades)} 笔完成`} icon="solar:check-circle-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="交易失败率" value={formatPercent(failedTrades, totalTrades)} helper={`${formatNumber(failedTrades)} 笔需调查`} icon="solar:close-circle-bold-duotone" tone="error" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="待处理占比" value={formatPercent(pendingTrades, totalTrades)} helper={`${formatNumber(pendingTrades)} 笔持续跟踪`} icon="solar:clock-circle-bold-duotone" tone="warning" /></Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={7}>
          <ChartCard
            title="交易金额趋势"
            subheader="按通道拆分，便于定位单一通道波动"
            type="area"
            series={[
              { name: '全部', data: amountTrend.map((row) => numberValue(row.tradeAmount)) },
              { name: 'Interlace', data: amountTrend.map((row) => numberValue(row.interlaceTradeAmount)) },
              { name: 'Slash', data: amountTrend.map((row) => numberValue(row.slashTradeAmount)) },
              { name: 'Wasabi', data: amountTrend.map((row) => numberValue(row.wasabiTradeAmount)) },
            ]}
            categories={amountTrend.map((row) => String(row.date || ''))}
            height={320}
          />
        </Grid>
        <Grid item xs={12} md={6} lg={2.5}>
          <ChartCard
            title="交易类型"
            subheader="按笔数"
            type="donut"
            series={typeDistribution.map((row) => numberValue(row.tradeCount))}
            height={320}
            options={{ labels: typeDistribution.map((row) => billTypeLabel[String(row.billType)] || `类型 ${row.billType}`), legend: { position: 'bottom' } }}
          />
        </Grid>
        <Grid item xs={12} md={6} lg={2.5}>
          <ChartCard
            title="处理状态"
            subheader="按笔数"
            type="donut"
            series={statusDistribution.map((row) => numberValue(row.tradeCount))}
            height={320}
            options={{ labels: statusDistribution.map((row) => statusLabel[String(row.tradeStatus)] || `状态 ${row.tradeStatus}`), legend: { position: 'bottom' } }}
          />
        </Grid>
      </Grid>

      <Stack id="queues" direction="row" justifyContent="space-between" alignItems="end" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="h6">快速调查队列</Typography>
          <Typography variant="body2" color="text.secondary">从异常集合直接进入交易详情，再关联卡片与账户。</Typography>
        </Box>
        <Button onClick={() => navigate('/transactions')} endIcon={<Icon icon="solar:arrow-right-linear" />}>查看全部流水</Button>
      </Stack>
      <Grid container spacing={2.5}>
        {queues.map((queue) => {
          const rows = toRows(quickAccess[queue.key]);
          return (
            <Grid item xs={12} lg={4} key={queue.key}>
              <Card sx={{ height: '100%' }}>
                <CardHeader
                  avatar={<Box sx={{ width: 42, height: 42, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: 'grey.100', color: queue.color }}><Icon icon={queue.icon} width={24} /></Box>}
                  title={queue.title}
                  subheader={queue.caption}
                  action={<Chip label={rows.length} size="small" />}
                />
                <Divider />
                <List disablePadding>
                  {rows.slice(0, 6).map((row, index) => {
                    const billId = String(pickValue(row, ['billId', 'id'], ''));
                    return (
                      <ListItemButton key={`${billId}-${index}`} onClick={() => navigate(`/analytics/topics/transactions/${queue.key === 'recentFailedTrades' ? 'failed' : queue.key === 'recentPendingTrades' ? 'pending' : 'large'}`)} sx={{ px: 2.5, py: 1.2 }}>
                        <ListItemText
                          primary={<Stack direction="row" alignItems="center" gap={1}><Typography variant="subtitle2" noWrap>{billId}</Typography><StatusChip value={statusLabel[String(row.tradeStatus)] || row.tradeStatus} /></Stack>}
                          secondary={`${formatAmount(row.amount, String(row.currency || 'USD'))} · ${formatDateTime(row.finishTime)}`}
                          secondaryTypographyProps={{ noWrap: true }}
                        />
                        <Icon icon="solar:alt-arrow-right-linear" width={18} />
                      </ListItemButton>
                    );
                  })}
                  {!rows.length ? <Typography variant="body2" color="text.secondary" sx={{ p: 3 }}>当前没有记录。</Typography> : null}
                </List>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}

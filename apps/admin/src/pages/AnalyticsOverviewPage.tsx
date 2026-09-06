import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Button, Card, CardHeader, Divider, Grid, Stack, Typography } from '@mui/material';
import {
  getCardOverview,
  getPlatformFundsReport,
  getRiskData,
  getTradeOverview,
} from '../../../../packages/shared/src/api/queries';
import {
  AnalyticsContextBar,
  InsightSummary,
  ScenarioGrid,
  SectionHeading,
} from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { ChartCard } from '../../../../packages/shared/src/components/ChartCard';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import {
  asRecord,
  formatAmount,
  formatDateTime,
  formatNumber,
  formatPercent,
  numberValue,
  pickValue,
  toRows,
} from '../utils/format';

type OverviewState = {
  cards: Record<string, unknown>;
  trades: Record<string, unknown>;
  risk: Awaited<ReturnType<typeof getRiskData>>;
  funds: Awaited<ReturnType<typeof getPlatformFundsReport>>;
};

export function AnalyticsOverviewPage() {
  const [data, setData] = useState<OverviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cards, trades, risk, funds] = await Promise.all([
        getCardOverview(),
        getTradeOverview(),
        getRiskData(),
        getPlatformFundsReport(),
      ]);
      setData({ cards, trades, risk, funds });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '业务全景读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    const cardSummary = asRecord(data?.cards.summary);
    const tradeSummary = asRecord(data?.trades.summary);
    const warningStats = asRecord(data?.risk.warningStats);
    const fundSummary = asRecord(data?.funds.summary);
    const batch = asRecord(fundSummary.batch);
    const remaining = asRecord(fundSummary.remaining);
    const reconciliation = asRecord(fundSummary.reconciliation);
    const amountTrend = toRows(data?.trades.tradeAmountTrend);
    const channelRows = toRows(data?.funds.channels.list);
    const totalTrades = numberValue(tradeSummary.todayTradeCount);
    const successTrades = numberValue(tradeSummary.todaySuccessTradeCount);
    const failedTrades = numberValue(tradeSummary.todayFailTradeCount);
    const pendingTrades = numberValue(tradeSummary.todayPendingTradeCount);
    const totalCards = numberValue(cardSummary.totalCardCount);
    const activeCards = numberValue(cardSummary.activeCardCount);
    const warningUsers = numberValue(warningStats.warningUserCount);
    const highRiskUsers = numberValue(pickValue(warningStats, ['highRiskCount', 'highRiskUserCount', 'highCount'], 0));
    const negativeUsers = numberValue(pickValue(warningStats, ['negativeRemainingCount'], 0));
    const unhealthyChannels = channelRows.filter((row) => {
      const status = String(pickValue(row, ['fetchStatus'], '')).toLowerCase();
      return status && !['1', 'success', 'succeeded', 'ok', '正常', '成功'].includes(status);
    }).length;

    return {
      cardSummary,
      tradeSummary,
      warningStats,
      batch,
      remaining,
      reconciliation,
      amountTrend,
      totalTrades,
      successTrades,
      failedTrades,
      pendingTrades,
      totalCards,
      activeCards,
      warningUsers,
      highRiskUsers,
      negativeUsers,
      unhealthyChannels,
      channelRows,
    };
  }, [data]);

  if (loading) return <PageSkeleton />;

  const snapshot = String(pickValue(model.batch, ['snapshotTimeText', 'generatedAt'], '接口当前返回'));
  const successRate = formatPercent(model.successTrades, model.totalTrades);
  const activeRate = formatPercent(model.activeCards, model.totalCards);
  const failureRate = formatPercent(model.failedTrades, model.totalTrades);

  return (
    <>
      <PageHeader
        title="业务分析全景"
        description="把交易结果、卡片供给、账户风险和平台资金放在同一决策视图中。"
        breadcrumbs={[{ label: '分析中心' }, { label: '业务全景' }]}
        action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新全部分析</Button>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period="今日经营 + 资金批次快照" scope="全平台 · USD 默认口径" freshness={snapshot} />
      <InsightSummary
        insights={[
          { label: '交易健康', detail: `成功率 ${successRate}，失败 ${formatNumber(model.failedTrades)} 笔、待处理 ${formatNumber(model.pendingTrades)} 笔`, tone: model.failedTrades > 0 ? 'warning' : 'success' },
          { label: '卡片供给', detail: `${formatNumber(model.activeCards)} 张活跃，活跃率 ${activeRate}`, tone: 'info' },
          { label: '风险敞口', detail: `${formatNumber(model.warningUsers)} 个预警账户，其中负余额 ${formatNumber(model.negativeUsers)} 个`, tone: model.negativeUsers > 0 ? 'error' : 'info' },
        ]}
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="今日交易金额" value={formatAmount(model.tradeSummary.todayTradeAmount)} helper={`${formatNumber(model.totalTrades)} 笔 · 均笔 ${formatAmount(model.totalTrades ? numberValue(model.tradeSummary.todayTradeAmount) / model.totalTrades : 0)}`} icon="solar:wallet-money-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="交易成功率" value={successRate} helper={`失败率 ${failureRate}`} icon="solar:check-circle-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="活跃卡片率" value={activeRate} helper={`${formatNumber(model.activeCards)} / ${formatNumber(model.totalCards)} 张`} icon="solar:card-check-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="高风险账户" value={formatNumber(model.highRiskUsers)} helper={`全部预警 ${formatNumber(model.warningUsers)}`} icon="solar:danger-triangle-bold-duotone" tone="error" /></Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid item xs={12} lg={8}>
          <ChartCard
            title="业务交易趋势"
            subheader="按通道拆分金额，识别整体波动和单一通道异常"
            type="area"
            series={[
              { name: '全部', data: model.amountTrend.map((row) => numberValue(row.tradeAmount)) },
              { name: 'Interlace', data: model.amountTrend.map((row) => numberValue(row.interlaceTradeAmount)) },
              { name: 'Slash', data: model.amountTrend.map((row) => numberValue(row.slashTradeAmount)) },
              { name: 'Wasabi', data: model.amountTrend.map((row) => numberValue(row.wasabiTradeAmount)) },
            ]}
            categories={model.amountTrend.map((row) => String(row.date || ''))}
            height={355}
          />
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card sx={{ height: '100%' }}>
            <CardHeader title="经营护栏" subheader="影响日常运营决策的关键状态" />
            <Divider />
            <Stack divider={<Divider flexItem />}>
              {[
                { label: '失败交易', value: `${formatNumber(model.failedTrades)} 笔`, status: model.failedTrades > 0 ? '需要关注' : '正常' },
                { label: '待处理交易', value: `${formatNumber(model.pendingTrades)} 笔`, status: model.pendingTrades > 0 ? '跟踪中' : '正常' },
                { label: '负余额账户', value: `${formatNumber(model.negativeUsers)} 个`, status: model.negativeUsers > 0 ? '高风险' : '正常' },
                { label: '渠道快照异常', value: `${formatNumber(model.unhealthyChannels)} 个`, status: model.unhealthyChannels > 0 ? '拉取异常' : '正常' },
                { label: '资金对账', value: String(pickValue(model.reconciliation, ['confirmedText', 'expectedText'], '-')), status: pickValue(model.batch, ['status'], '-') },
              ].map((item) => (
                <Stack key={item.label} direction="row" alignItems="center" justifyContent="space-between" gap={2} sx={{ px: 3, py: 2 }}>
                  <div>
                    <Typography variant="subtitle2">{item.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.value}</Typography>
                  </div>
                  <StatusChip value={item.status} />
                </Stack>
              ))}
            </Stack>
          </Card>
        </Grid>
      </Grid>

      <SectionHeading title="按运营场景进入" description="每个入口都保留同一指标口径，并落到可调查的明细队列。" />
      <ScenarioGrid scenarios={[
        { title: '早间运营巡检', description: '从全部交易样本进入状态、金额与对象的连续分析。', route: '/analytics/topics/transactions/all', icon: 'solar:sun-2-bold-duotone', metric: successRate },
        { title: '交易异常调查', description: '先分析失败交易集合，再逐笔下钻卡片与账户。', route: '/analytics/topics/transactions/failed', icon: 'solar:transfer-horizontal-bold-duotone', metric: `${formatNumber(model.failedTrades)} 失败` },
        { title: '卡片供给运营', description: '从卡片样本切换活跃、冻结和低余额专题。', route: '/analytics/topics/cards/all', icon: 'solar:card-2-bold-duotone', metric: activeRate },
        { title: '重点账户复盘', description: '按活跃、卡资产和风险筛选账户，再进入实体分析。', route: '/analytics/topics/accounts/high-activity', icon: 'solar:users-group-rounded-bold-duotone', metric: '账户组' },
        { title: '风险专题审查', description: '在风险集合内连续进入账户、卡片与关联交易。', route: '/analytics/topics/risk/accounts', icon: 'solar:shield-warning-bold-duotone', metric: `${formatNumber(model.warningUsers)} 预警` },
        { title: '资金与渠道核对', description: '按用户、授信、渠道和快照异常逐级核对。', route: '/analytics/topics/funds/users', icon: 'solar:safe-square-bold-duotone', metric: formatDateTime(snapshot) },
      ]} />
    </>
  );
}

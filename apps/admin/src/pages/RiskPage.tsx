import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Button, Grid, Tab, Tabs, Card } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getRiskData } from '../../../../packages/shared/src/api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ChartCard } from '../../../../packages/shared/src/components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { formatAmount, formatDateTime, formatNumber, maskCard, numberValue, pickValue, toRows } from '../utils/format';

type RiskState = Awaited<ReturnType<typeof getRiskData>>;

export function RiskPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<RiskState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tab = searchParams.get('tab') || 'accounts';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getRiskData());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '风险数据读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const accountColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'email', headerName: '账户', minWidth: 230, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['email', 'userId'])) },
      { field: 'accountType', headerName: '类型', width: 110, valueGetter: (_, row) => String(pickValue(row, ['accountTypeLabel', 'accountType'])) },
      { field: 'risk', headerName: '风险等级', width: 120, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['riskLevelLabel', 'riskLevel'])} /> },
      { field: 'usage', headerName: '资金使用率', width: 135, align: 'right', headerAlign: 'right', valueGetter: (_, row) => `${pickValue(row, ['fundUsagePercent'], 0)}%` },
      { field: 'remaining', headerName: '实际剩余', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.actualRemainingAvailableAmount) },
      { field: 'ownFunds', headerName: '自有资金', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.ownFundsTotalAmount) },
      { field: 'credit', headerName: '授信额度', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['realCreditLimit', 'creditLimit'], 0)) },
      { field: 'rules', headerName: '命中规则', minWidth: 220, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['matchedRules'])) },
    ],
    [],
  );

  const cardColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'card', headerName: '卡片', minWidth: 210, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNo', 'cardNoMasked', 'cardId'])) },
      { field: 'customer', headerName: '所属账户', minWidth: 220, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'userId'])) },
      { field: 'risk', headerName: '风险等级', width: 120, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['riskLevelLabel', 'riskLevel'])} /> },
      { field: 'balance', headerName: '可用余额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.availableBalance) },
      { field: 'deposit', headerName: '累计充值', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.totalDepositAmount) },
      { field: 'spent', headerName: '累计消费', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.totalConsumptionAmount) },
      { field: 'refund', headerName: '累计退款', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.totalRefundAmount) },
    ],
    [],
  );

  if (loading) return <PageSkeleton />;
  const warningStats = data?.warningStats || {};
  const cardStats = data?.riskCardStats || {};
  const warningRows = toRows(data?.warnings.list);
  const cardRows = toRows(data?.riskCards.list);
  const riskLevels = [
    { label: '高风险', value: numberValue(pickValue(warningStats, ['highRiskCount', 'highRiskUserCount'], 0)) },
    { label: '中风险', value: numberValue(pickValue(warningStats, ['mediumRiskCount', 'mediumRiskUserCount'], 0)) },
    { label: '低风险', value: numberValue(pickValue(warningStats, ['lowRiskCount', 'lowRiskUserCount'], 0)) },
    { label: '正常', value: numberValue(pickValue(warningStats, ['normalCount', 'normalUserCount'], 0)) },
    { label: '缺少基线', value: numberValue(pickValue(warningStats, ['noBaseCount', 'noBaseUserCount'], 0)) },
  ];
  const ruleCount = new Map<string, number>();
  warningRows.forEach((row) => {
    const raw = row.matchedRules;
    const rules = Array.isArray(raw) ? raw.map(String) : String(raw || '').split(/[,，;；|]/);
    rules.map((rule) => rule.trim()).filter(Boolean).forEach((rule) => ruleCount.set(rule, (ruleCount.get(rule) || 0) + 1));
  });
  const topRules = [...ruleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topUsage = [...warningRows].sort((a, b) => numberValue(b.fundUsagePercent) - numberValue(a.fundUsagePercent)).slice(0, 10);
  const latestGeneratedAt = warningRows.reduce<unknown>((latest, row) => row.generatedAt || latest, '-');
  const negativeRemaining = numberValue(pickValue(warningStats, ['negativeRemainingCount'], 0));

  return (
    <>
      <PageHeader title="风险与资金分析" description="从风险结构和命中规则进入账户、卡片与关联交易，形成完整调查路径。" breadcrumbs={[{ label: '分析中心' }, { label: '风险' }]} action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新风险快照</Button>} />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period="服务端当前风险快照" scope="全平台汇总 + 前50条高风险队列" freshness={formatDateTime(latestGeneratedAt)} />
      <InsightSummary insights={[
        { label: '风险结构', detail: `${formatNumber(riskLevels[0].value)} 个高风险账户、${formatNumber(riskLevels[1].value)} 个中风险账户`, tone: riskLevels[0].value > 0 ? 'error' : 'info' },
        { label: '资金护栏', detail: `${formatNumber(negativeRemaining)} 个账户实际剩余为负`, tone: negativeRemaining > 0 ? 'error' : 'success' },
        { label: '主要规则', detail: topRules.length ? `${topRules[0][0]}（当前加载队列命中 ${topRules[0][1]} 次）` : '当前加载队列没有命中规则', tone: topRules.length ? 'warning' : 'info' },
      ]} />
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="预警账户" value={formatNumber(warningStats.warningUserCount)} icon="solar:user-block-bold-duotone" tone="warning" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="高风险账户" value={formatNumber(warningStats.highRiskCount)} icon="solar:danger-triangle-bold-duotone" tone="error" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="风险卡片" value={formatNumber(cardStats.riskCardCount)} icon="solar:card-search-bold-duotone" tone="secondary" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="负余额账户" value={formatNumber(negativeRemaining)} helper={`风险卡负余额 ${formatAmount(cardStats.negativeBalanceTotal)}`} icon="solar:wallet-money-bold-duotone" tone="info" /></Grid>
      </Grid>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={4}>
          <ChartCard title="账户风险等级" subheader="服务端全量统计" type="donut" series={riskLevels.map((item) => item.value)} height={330} options={{ labels: riskLevels.map((item) => item.label), legend: { position: 'bottom' } }} />
        </Grid>
        <Grid item xs={12} lg={4}>
          <ChartCard title="主要命中规则" subheader="当前加载50条账户预警样本" type="bar" series={[{ name: '命中账户', data: topRules.map((item) => item[1]) }]} categories={topRules.map((item) => item[0])} height={330} options={{ plotOptions: { bar: { horizontal: true, borderRadius: 3 } }, legend: { show: false } }} />
        </Grid>
        <Grid item xs={12} lg={4}>
          <ChartCard title="高资金使用率账户" subheader="当前加载队列前10名" type="bar" series={[{ name: '资金使用率 %', data: topUsage.map((row) => numberValue(row.fundUsagePercent)) }]} categories={topUsage.map((row) => String(pickValue(row, ['email', 'userId'])).slice(0, 26))} height={330} options={{ plotOptions: { bar: { horizontal: true, borderRadius: 3 } }, legend: { show: false }, xaxis: { max: 100 } }} />
        </Grid>
      </Grid>
      <Card sx={{ mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, value) => setSearchParams({ tab: value })}>
          <Tab value="accounts" label={`账户预警 ${warningRows.length}`} />
          <Tab value="cards" label={`风险卡片 ${cardRows.length}`} />
        </Tabs>
      </Card>
      {tab === 'cards' ? (
        <DataTableCard
          title="风险卡片"
          rows={cardRows}
          columns={cardColumns}
          getRowId={(row) => String(pickValue(row, ['cardId', 'id']))}
          onRowClick={(row) => navigate(`/analytics/entities/card/${pickValue(row, ['cardId', 'id'])}?from=risk/cards`)}
        />
      ) : (
        <DataTableCard
          title="账户资金预警"
          rows={warningRows}
          columns={accountColumns}
          getRowId={(row) => String(pickValue(row, ['userId', 'email']))}
          onRowClick={(row) => navigate(`/risk/account-groups/${pickValue(row, ['mainAccountId', 'userId'])}?account=${pickValue(row, ['userId'])}`)}
        />
      )}
    </>
  );
}

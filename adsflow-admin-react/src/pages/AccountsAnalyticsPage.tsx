import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Button, Grid } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import { getCustomers, getUserCardAssets } from '../api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { ChartCard } from '../components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import {
  formatAmount,
  formatDateTime,
  formatNumber,
  formatPercent,
  numberValue,
  pickValue,
  toRows,
} from '../utils/format';

type AccountsState = {
  assets: Awaited<ReturnType<typeof getUserCardAssets>>;
  groups: Awaited<ReturnType<typeof getCustomers>>;
};

export function AccountsAnalyticsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AccountsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [assets, groups] = await Promise.all([
        getUserCardAssets({ page: 1, pageSize: 50 }),
        getCustomers({ main_account: 1, currentPage: 1, pageSize: 50 }),
      ]);
      setData({ assets, groups });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户分析读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    const assets = toRows(data?.assets.list);
    const groups = toRows(data?.groups.list);
    const totalBalance = assets.reduce((sum, row) => sum + numberValue(row.totalCardBalance), 0);
    const totalTrade30d = assets.reduce((sum, row) => sum + numberValue(row.tradeAmount30d), 0);
    const totalCards = assets.reduce((sum, row) => sum + numberValue(row.cardCount), 0);
    const activeCards = assets.reduce((sum, row) => sum + numberValue(row.activeCardCount), 0);
    const riskCounts = new Map<string, number>();
    assets.forEach((row) => {
      const label = String(pickValue(row, ['riskTag'], '正常'));
      riskCounts.set(label, (riskCounts.get(label) || 0) + 1);
    });
    const ranked = [...assets].sort((a, b) => numberValue(b.tradeAmount30d) - numberValue(a.tradeAmount30d));
    const top5Trade = ranked.slice(0, 5).reduce((sum, row) => sum + numberValue(row.tradeAmount30d), 0);
    const subAccounts = groups.reduce((sum, row) => sum + numberValue(row.subAccountCount), 0);
    return { assets, groups, totalBalance, totalTrade30d, totalCards, activeCards, riskCounts, ranked, top5Trade, subAccounts };
  }, [data]);

  const columns = useMemo<GridColDef[]>(() => [
    { field: 'account', headerName: '账户', minWidth: 230, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'userId'])) },
    { field: 'cards', headerName: '卡片', width: 90, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatNumber(row.cardCount) },
    { field: 'active', headerName: '活跃率', width: 105, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatPercent(row.activeCardCount, row.cardCount) },
    { field: 'balance', headerName: '卡余额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.totalCardBalance) },
    { field: 'trade', headerName: '近30日交易', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.tradeAmount30d) },
    { field: 'risk', headerName: '风险标签', width: 120, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['riskTag'], '正常')} /> },
    { field: 'lastTrade', headerName: '最近交易', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.lastTradeTime) },
  ], []);

  if (loading) return <PageSkeleton />;

  const topAccount = model.ranked[0];
  return (
    <>
      <PageHeader
        title="账户组经营分析"
        description="从主子账户结构、卡片使用和近30日交易识别重点客户与资产集中度。"
        breadcrumbs={[{ label: '分析中心' }, { label: '账户组' }]}
        action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新样本</Button>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period="卡交易近30日 · 资产当前值" scope={`前 ${formatNumber(model.assets.length)} 个账户资产 + 前 ${formatNumber(model.groups.length)} 个主账户组`} sample />
      <InsightSummary insights={[
        { label: '样本集中度', detail: `交易额前5个账户占当前样本 ${formatPercent(model.top5Trade, model.totalTrade30d)}`, tone: 'info' },
        { label: '重点账户', detail: topAccount ? `${String(pickValue(topAccount, ['userEmail', 'userId']))} 的近30日交易为 ${formatAmount(topAccount.tradeAmount30d)}` : '暂无账户数据', tone: 'info' },
        { label: '账户结构', detail: `当前加载 ${formatNumber(model.groups.length)} 个主账户组，关联 ${formatNumber(model.subAccounts)} 个子账户`, tone: 'info' },
      ]} />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="样本近30日交易" value={formatAmount(model.totalTrade30d)} helper="仅当前加载账户求和" icon="solar:graph-up-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="样本卡片余额" value={formatAmount(model.totalBalance)} helper={`${formatNumber(model.totalCards)} 张卡`} icon="solar:wallet-money-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="样本活跃卡率" value={formatPercent(model.activeCards, model.totalCards)} helper={`${formatNumber(model.activeCards)} 张活跃`} icon="solar:card-check-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="主子账户关系" value={`${formatNumber(model.groups.length)} / ${formatNumber(model.subAccounts)}`} helper="主账户组 / 子账户" icon="solar:hierarchy-2-bold-duotone" tone="secondary" /></Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={8}>
          <ChartCard
            title="高交易账户排行"
            subheader="当前加载样本 · 近30日交易金额前10名"
            type="bar"
            series={[{ name: '近30日交易', data: model.ranked.slice(0, 10).map((row) => numberValue(row.tradeAmount30d)) }]}
            categories={model.ranked.slice(0, 10).map((row) => String(pickValue(row, ['userEmail', 'userId'])).slice(0, 28))}
            height={360}
            options={{ plotOptions: { bar: { horizontal: true, borderRadius: 4 } }, legend: { show: false } }}
          />
        </Grid>
        <Grid item xs={12} lg={4}>
          <ChartCard
            title="账户风险标签"
            subheader="当前加载资产账户分布"
            type="donut"
            series={[...model.riskCounts.values()]}
            height={360}
            options={{ labels: [...model.riskCounts.keys()], legend: { position: 'bottom' } }}
          />
        </Grid>
      </Grid>

      <DataTableCard
        title="账户资产调查队列"
        subheader="按近30日交易排序；点击进入账户组详情继续查看子账户和卡片"
        rows={model.ranked}
        columns={columns}
        getRowId={(row) => String(pickValue(row, ['userId', 'userEmail']))}
        onRowClick={(row) => navigate(`/analytics/entities/account/${pickValue(row, ['userId'])}?from=accounts/high-activity`)}
        minHeight={520}
      />
    </>
  );
}

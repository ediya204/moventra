import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Button, ButtonGroup, Card, CardHeader, Chip, Divider, Grid, Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import { getPlatformFundsReport } from '../api/queries';
import { AnalyticsContextBar, InsightSummary, SectionHeading } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { ChartCard } from '../components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { asRecord, formatAmount, formatDateTime, formatNumber, formatPercent, maskCard, numberValue, pickValue, toRows } from '../utils/format';
import { buildRevenueModel } from '../utils/revenueAnalytics';

type State = Awaited<ReturnType<typeof getPlatformFundsReport>>;
type Period = 7 | 30 | 90 | 180;

function RevenueStatus({ value }: { value: string }) {
  const color = value.includes('确认') && !value.includes('待') ? 'success' : value.includes('待') ? 'warning' : 'error';
  return <Chip size="small" variant="outlined" color={color} label={value} />;
}

export function RevenuePage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State | null>(null);
  const [period, setPeriod] = useState<Period>(180);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setState(await getPlatformFundsReport({ pageSize: 1000 })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '收入数据读取失败。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => state ? buildRevenueModel(asRecord(state.summary), toRows(state.users.list), { days: period }) : null, [period, state]);
  const eventColumns = useMemo<GridColDef[]>(() => [
    { field: 'time', headerName: '收入发生时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.occurredAt) },
    { field: 'type', headerName: '收入项目', width: 135, valueGetter: (_, row) => String(row.revenueTypeLabel) },
    { field: 'amount', headerName: '收入金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'status', headerName: '确认状态', width: 115, renderCell: ({ row }) => <RevenueStatus value={String(row.statusLabel)} /> },
    { field: 'account', headerName: '归属账户', minWidth: 235, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'userId'])) },
    { field: 'card', headerName: '关联卡片', minWidth: 185, valueGetter: (_, row) => row.cardId ? maskCard(pickValue(row, ['cardNoMasked', 'cardId'])) : '-' },
    { field: 'reference', headerName: '来源单号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(row.sourceRef || '-') },
    { field: 'granularity', headerName: '数据粒度', width: 110, valueGetter: (_, row) => row.granularity === 'event' ? '逐笔' : '账户汇总' },
  ], []);
  const accountColumns = useMemo<GridColDef[]>(() => [
    { field: 'account', headerName: '账户', minWidth: 250, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['email', 'userId'])) },
    { field: 'otc', headerName: 'OTC手续费', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.otcRevenue) },
    { field: 'card', headerName: '开卡费', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.cardIssuanceRevenue) },
    { field: 'total', headerName: '已确认收入', width: 160, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.totalRevenue) },
    { field: 'share', headerName: '收入贡献', width: 125, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatPercent(row.totalRevenue, model?.recognized.total || 0) },
    { field: 'count', headerName: '确认笔数', width: 110, align: 'right', headerAlign: 'right', valueGetter: (_, row) => model?.quality.granularity === '逐笔' ? formatNumber(row.recognizedCount) : '不可用' },
  ], [model?.quality.granularity, model?.recognized.total]);

  if (loading || !model) return <PageSkeleton />;
  const batch = asRecord(asRecord(state?.summary).batch);
  const trend = model.trendRows;
  const topAccounts = model.accountRows.slice(0, 10);
  const comparableToBatch = period === 180;
  const incomeReconciles = comparableToBatch && Math.abs(model.reconciliation.variance) < 0.01;

  return <>
    <PageHeader
      title="收入分析"
      description="当前确认范围只有 OTC 手续费和开卡费；返佣不纳入收入。"
      breadcrumbs={[{ label: '资金经营报表', to: '/reports' }, { label: '收入分析' }]}
      action={<Stack direction="row" gap={1}><ButtonGroup size="small" aria-label="收入周期">{([7, 30, 90, 180] as Period[]).map((days) => <Button key={days} variant={period === days ? 'contained' : 'outlined'} onClick={() => setPeriod(days)}>近{days}日</Button>)}</ButtonGroup><Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>重新读取</Button></Stack>}
    />
    {error ? <ErrorState message={error} onRetry={load} /> : null}
    <AnalyticsContextBar period={`最近 ${period} 日`} scope="OTC手续费 + 开卡费" freshness={String(pickValue(batch, ['snapshotTimeText'], formatDateTime(model.asOf)))} sample={model.quality.granularity !== '逐笔'} />
    <InsightSummary title="收入判断" insights={[
      { label: '已确认收入', detail: `${formatAmount(model.recognized.total)}，只计算状态已确认的收费事件`, tone: 'success' },
      { label: '待确认', detail: `${formatNumber(model.pending.count)} 笔、${formatAmount(model.pending.total)}，尚未计入收入`, tone: model.pending.total ? 'warning' : 'success' },
      { label: '旧汇总核对', detail: !comparableToBatch ? '短周期收入不与180日资金批次强行比较' : incomeReconciles ? '两类收入合计与资金报表毛收入一致' : `相差 ${formatAmount(model.reconciliation.variance)}，需确认旧报表是否包含其他项目`, tone: !comparableToBatch ? 'info' : incomeReconciles ? 'success' : 'error' },
    ]} />
    <Alert severity="info" sx={{ mb: 3 }}>收入确认口径：OTC订单手续费或开卡收费事件达到“已确认”状态才计入。交易本金、入金、出金、授信、渠道余额和返佣均不属于当前收入。</Alert>

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="已确认收入" value={formatAmount(model.recognized.total)} helper={`${model.quality.granularity} · ${model.version}`} icon="solar:wallet-money-bold-duotone" tone="success" /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="OTC手续费" value={formatAmount(model.recognized.otc)} helper={`收入占比 ${formatPercent(model.recognized.otc, model.recognized.total)}`} icon="solar:transfer-horizontal-bold-duotone" tone="info" /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="开卡费" value={formatAmount(model.recognized.cardIssuance)} helper={`收入占比 ${formatPercent(model.recognized.cardIssuance, model.recognized.total)}`} icon="solar:card-2-bold-duotone" /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="待确认收入" value={formatAmount(model.pending.total)} helper={`${formatNumber(model.pending.count)} 笔不进入已确认收入`} icon="solar:clock-circle-bold-duotone" tone="warning" /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="已冲回金额" value={formatAmount(model.reversed.total)} helper={`${formatNumber(model.reversed.count)} 笔单独披露`} icon="solar:restart-bold-duotone" tone="error" /></Grid>
    </Grid>

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} lg={8}><ChartCard title="两类收入趋势" subheader="按收入发生时间统计；待确认和冲回不进入曲线" type="area" series={[
        { name: 'OTC手续费', data: trend.map((row) => numberValue(row.otcRecognized)) },
        { name: '开卡费', data: trend.map((row) => numberValue(row.cardIssuanceRecognized)) },
      ]} categories={trend.map((row) => String(row.date))} height={340} /></Grid>
      <Grid item xs={12} lg={4}><ChartCard title="收入构成" subheader="已确认收入" type="donut" series={[model.recognized.otc, model.recognized.cardIssuance]} height={340} options={{ labels: ['OTC手续费', '开卡费'] }} /></Grid>
    </Grid>

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} lg={7}><ChartCard title="账户收入贡献" subheader="前10个账户，识别收入集中度" type="bar" series={[
        { name: 'OTC手续费', data: topAccounts.map((row) => numberValue(row.otcRevenue)) },
        { name: '开卡费', data: topAccounts.map((row) => numberValue(row.cardIssuanceRevenue)) },
      ]} categories={topAccounts.map((row) => String(pickValue(row, ['email', 'userId'])).slice(0, 24))} height={340} options={{ plotOptions: { bar: { horizontal: true } } }} /></Grid>
      <Grid item xs={12} lg={5}>
        <Card sx={{ height: '100%' }}><CardHeader title="收入质量与单位经济" subheader="用于解释收入，而不是增加收入项目" /><Divider /><Stack gap={2.2} sx={{ p: 3 }}>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2">OTC账面交易量（180日批次）</Typography><Typography variant="subtitle2">{formatAmount(model.economics.otcVolume)}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2">OTC手续费率</Typography><Typography variant="subtitle2">{comparableToBatch ? formatPercent(model.recognized.otc, model.economics.otcVolume, 3) : '周期分母缺失'}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2">平均开卡费</Typography><Typography variant="subtitle2">{model.economics.issuanceCount ? formatAmount(model.economics.averageIssuanceFee) : '逐笔数据不足'}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2">账户收入集中度 HHI</Typography><Typography variant="subtitle2">{model.economics.accountHhi.toFixed(3)}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2">数据可信度</Typography><RevenueStatus value={model.quality.confidence === '高' ? '已确认' : `${model.quality.confidence}置信度`} /></Stack>
          <Divider />
          <Typography variant="caption" color="text.secondary">时间覆盖 {formatPercent(Math.round(model.quality.timeCoverage * 100), 100)} · 账户归属覆盖 {formatPercent(Math.round(model.quality.accountCoverage * 100), 100)} · 重复事件 {formatNumber(model.quality.duplicateCount)}</Typography>
        </Stack></Card>
      </Grid>
    </Grid>

    <SectionHeading title="收入证据" description="先看逐笔收费事件，再汇总到归属账户；点击事件查看确认状态和来源单号。" />
    <Stack gap={3}>
      <DataTableCard title="收入事件明细" subheader="已确认、待确认和已冲回全部保留，只有已确认进入收入" rows={model.events} columns={eventColumns} getRowId={(row) => String(row.id)} onRowClick={(row) => navigate(`/revenue/events/${encodeURIComponent(String(row.id))}`)} minHeight={520} />
      <DataTableCard title="账户收入贡献" subheader="点击账户进入账户实体分析，继续查看卡片与交易关系" rows={model.accountRows} columns={accountColumns} getRowId={(row) => String(row.id)} onRowClick={(row) => navigate(`/analytics/entities/account/${row.userId}?from=revenue`)} minHeight={430} />
    </Stack>
    <Alert severity="warning" sx={{ mt: 3 }}>返佣当前明确排除。未来启用返佣时必须作为独立收入类型、独立确认规则和独立冲回记录接入，不能直接并入 OTC 手续费。</Alert>
  </>;
}

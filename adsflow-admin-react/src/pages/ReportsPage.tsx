import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Button, Card, CardHeader, Divider, Grid, Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import { getPlatformFundsReport } from '../api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { ChartCard } from '../components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, numberValue, pickValue, toRows } from '../utils/format';

type ReportState = Awaited<ReturnType<typeof getPlatformFundsReport>>;

export function ReportsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ReportState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await getPlatformFundsReport()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '平台资金报表读取失败。'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const userColumns = useMemo<GridColDef[]>(() => [
    { field: 'account', headerName: '账户', minWidth: 240, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['email', 'userId'])) },
    { field: 'type', headerName: '类型', width: 105, valueGetter: (_, row) => String(pickValue(row, ['accountTypeLabel', 'accountType'])) },
    { field: 'fiat', headerName: '法币可用', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.fiatAvailableAmount) },
    { field: 'digital', headerName: '数字资产', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.digitalAvailableAmount) },
    { field: 'card', headerName: '卡片余额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.cardAvailableAmount) },
    { field: 'book', headerName: '账面剩余', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.bookRemainingAmount) },
    { field: 'consumption', headerName: '卡实际消费', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.cardActualConsumptionAmount) },
    { field: 'credit', headerName: '实际授信', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.realCreditLimitAmount) },
  ], []);

  const channelColumns = useMemo<GridColDef[]>(() => [
    { field: 'channel', headerName: '通道', minWidth: 140, valueGetter: (_, row) => String(pickValue(row, ['channelName'])) },
    { field: 'name', headerName: '通道账户', minWidth: 200, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['accountName', 'accountId', 'apiAccountId'])) },
    { field: 'currency', headerName: '币种', width: 90, valueGetter: (_, row) => String(pickValue(row, ['currency'])) },
    { field: 'available', headerName: '可用余额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.availableBalance, String(row.currency || 'USD')) },
    { field: 'frozen', headerName: '冻结余额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.frozenBalance, String(row.currency || 'USD')) },
    { field: 'spend', headerName: '累计消费', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.totalSpend, String(row.currency || 'USD')) },
    { field: 'status', headerName: '拉取状态', width: 120, renderCell: ({ row }) => <StatusChip value={row.fetchStatus} /> },
    { field: 'snapshot', headerName: '快照时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.snapshotTimeText) },
  ], []);

  if (loading) return <PageSkeleton />;

  const summary = asRecord(data?.summary);
  const batch = asRecord(summary.batch);
  const totals = asRecord(summary.totals);
  const remaining = asRecord(summary.remaining);
  const income = asRecord(summary.income);
  const reconciliation = asRecord(summary.reconciliation);
  const consumption = asRecord(summary.consumption);
  const credit = asRecord(summary.credit);
  const internalTransfers = asRecord(summary.internalTransfers);
  const channelRows = toRows(data?.channels.list);
  const userRows = toRows(data?.users.list);
  const failedChannels = channelRows.filter((row) => String(row.fetchStatus || '').toLowerCase() === 'failed');
  const totalChannelAvailable = channelRows.reduce((sum, row) => sum + numberValue(row.availableBalance), 0);
  const totalChannelFrozen = channelRows.reduce((sum, row) => sum + numberValue(row.frozenBalance), 0);

  return (
    <>
      <PageHeader
        title="平台资金经营报表"
        description={`统计区间 ${String(pickValue(batch, ['startTimeText']))} 至 ${String(pickValue(batch, ['endTimeText']))} · 快照 ${String(pickValue(batch, ['snapshotTimeText']))}`}
        action={<Stack direction="row" gap={1}><Button variant="contained" onClick={() => navigate('/revenue')} startIcon={<Icon icon="solar:wallet-money-bold-duotone" />}>收入分析</Button><Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>重新读取</Button></Stack>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period={`${String(pickValue(batch, ['startTimeText']))} 至 ${String(pickValue(batch, ['endTimeText']))}`} scope="全平台资金批次" freshness={String(pickValue(batch, ['snapshotTimeText'], '接口当前返回'))} />
      <InsightSummary insights={[
        { label: '对账状态', detail: String(pickValue(reconciliation, ['confirmedText', 'expectedText'], '尚无对账结论')), tone: 'info' },
        { label: '授信敞口', detail: `${formatNumber(credit.creditAccountCount)} 个授信主账户，实际垫资 ${formatAmount(credit.realCreditLimitAmount)}`, tone: numberValue(credit.realCreditLimitAmount) > 0 ? 'warning' : 'info' },
        { label: '渠道快照', detail: `${formatNumber(channelRows.length)} 个账户已读取，${formatNumber(failedChannels.length)} 个拉取失败`, tone: failedChannels.length ? 'error' : 'success' },
      ]} />
      <Alert severity="info" sx={{ mb: 3 }}>本页只读取已有资金快照，不触发“手动刷新快照”写操作；对账结论仍以服务端批次为准。</Alert>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="资金来源" value={formatAmount(totals.fundsSourceAmount)} helper="外部入金 + 后台流入" icon="solar:wallet-money-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="当前剩余" value={formatAmount(pickValue(remaining, ['bookRemainingAmount', 'totalAmount']))} helper="法币 + 数字资产 + 卡余额" icon="solar:safe-square-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="已确认收入" value={formatAmount(pickValue(income, ['grossIncomeAmount', 'totalAmount']))} helper="OTC手续费 + 开卡费" icon="solar:graph-up-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="当前资金对账" value={String(pickValue(reconciliation, ['confirmedText', 'expectedText']))} helper={`批次 ${String(pickValue(batch, ['batchNo']))}`} icon="solar:checklist-minimalistic-bold-duotone" tone="warning" /></Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={4}>
          <ChartCard title="资产结构" subheader="平台当前账面剩余" type="donut" series={['fiatAvailableAmount', 'digitalAvailableAmount', 'cardAvailableAmount'].map((key) => numberValue(remaining[key]))} height={330} options={{ labels: ['法币可用', '数字资产', '卡片余额'], legend: { position: 'bottom' } }} />
        </Grid>
        <Grid item xs={12} lg={4}>
          <ChartCard
            title="外部与后台资金流"
            subheader="流入为正，流出为负"
            type="bar"
            series={[{ name: '金额', data: [numberValue(totals.externalInAmount), numberValue(totals.backendInAmount), -numberValue(totals.externalOutAmount), -numberValue(totals.backendOutAmount)] }]}
            categories={['外部入金', '后台流入', '外部出金', '后台流出']}
            height={330}
            options={{ legend: { show: false } }}
          />
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card sx={{ height: '100%' }}>
            <CardHeader title="报表状态" subheader="批次、消费与授信护栏" />
            <Divider />
            <Grid container spacing={3} sx={{ p: 3 }}>
              <Grid item xs={6}><Typography variant="caption" color="text.secondary">批次状态</Typography><Stack direction="row" sx={{ mt: 0.8 }}><StatusChip value={pickValue(batch, ['status'])} /></Stack></Grid>
              <Grid item xs={6}><Typography variant="caption" color="text.secondary">处理中消费</Typography><Typography variant="h6" sx={{ mt: 0.5 }}>{formatAmount(consumption.cardPendingConsumptionAmount)}</Typography></Grid>
              <Grid item xs={6}><Typography variant="caption" color="text.secondary">实际卡消费</Typography><Typography variant="h6" sx={{ mt: 0.5 }}>{formatAmount(consumption.cardActualConsumptionAmount)}</Typography></Grid>
              <Grid item xs={6}><Typography variant="caption" color="text.secondary">授信总额</Typography><Typography variant="h6" sx={{ mt: 0.5 }}>{formatAmount(credit.creditTotalAmount)}</Typography></Grid>
              <Grid item xs={6}><Typography variant="caption" color="text.secondary">内部转账差异</Typography><Typography variant="h6" sx={{ mt: 0.5 }}>{formatAmount(internalTransfers.internalDiffAmount)}</Typography></Grid>
              <Grid item xs={6}><Typography variant="caption" color="text.secondary">用户明细</Typography><Typography variant="h6" sx={{ mt: 0.5 }}>{formatNumber(data?.users.total)}</Typography></Grid>
            </Grid>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={8}>
          <ChartCard
            title="渠道账户余额比较"
            subheader="每个渠道账户的可用与冻结余额"
            type="bar"
            series={[
              { name: '可用余额', data: channelRows.map((row) => numberValue(row.availableBalance)) },
              { name: '冻结余额', data: channelRows.map((row) => numberValue(row.frozenBalance)) },
            ]}
            categories={channelRows.map((row) => `${String(row.channelName || '-')}:${String(pickValue(row, ['accountName', 'accountId'], '-')).slice(0, 16)}`)}
            height={330}
          />
        </Grid>
        <Grid item xs={12} lg={4}>
          <ChartCard title="渠道资金状态" subheader={`可用 ${formatAmount(totalChannelAvailable)} · 冻结 ${formatAmount(totalChannelFrozen)}`} type="donut" series={[totalChannelAvailable, totalChannelFrozen]} height={330} options={{ labels: ['可用', '冻结'], legend: { position: 'bottom' } }} />
        </Grid>
      </Grid>

      <Stack gap={3}>
        <DataTableCard title="渠道账户余额" subheader="每个卡通道账户的余额与快照状态" rows={channelRows} columns={channelColumns} getRowId={(row) => String(pickValue(row, ['id', 'apiAccountId']))} minHeight={360} />
        <DataTableCard title="用户资金明细" subheader="点击账户进入资金与交易实体分析，再选择原始账户详情" rows={userRows} columns={userColumns} getRowId={(row) => String(pickValue(row, ['userId', 'email']))} onRowClick={(row) => navigate(`/analytics/entities/account/${pickValue(row, ['userId'])}?from=funds/users`)} minHeight={500} />
      </Stack>
    </>
  );
}

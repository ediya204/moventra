import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Box, Button, ButtonGroup, Card, CardHeader, Chip, Divider, Grid, Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import { getReconciliationData } from '../api/queries';
import { AnalyticsContextBar, InsightSummary, SectionHeading } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { ChartCard } from '../components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { asRecord, formatAmount, formatDateTime, formatNumber, formatPercent, maskCard, numberValue, pickValue, toRows } from '../utils/format';
import { buildReconciliationModel, type ReconciliationSeverity, type ReconciliationStatus } from '../utils/reconciliationEngine';

type State = Awaited<ReturnType<typeof getReconciliationData>>;
type ReviewMode = '即时核对' | '日终核对' | '周期核对';

function Status({ value }: { value: ReconciliationStatus | ReconciliationSeverity | string }) {
  const color = value === '已核对' ? 'success' : value === '严重' || value === '高' || value === '有差异' ? 'error' : value === '中' || value === '数据不完整' ? 'warning' : 'default';
  return <Chip size="small" variant="outlined" color={color} label={value} />;
}

export function ReconciliationPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State | null>(null);
  const [mode, setMode] = useState<ReviewMode>('即时核对');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setState(await getReconciliationData()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '资金对账数据读取失败。'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    if (!state) return null;
    return buildReconciliationModel({
      summary: asRecord(state.funds.summary), users: toRows(state.funds.users.list), channels: toRows(state.funds.channels.list),
      transactions: toRows(state.transactions.list), cards: toRows(state.cards.list), transactionReportedTotal: Number(state.transactions.total || 0),
    });
  }, [state]);

  const checkpointColumns = useMemo<GridColDef[]>(() => [
    { field: 'name', headerName: '核对关口', minWidth: 190, flex: 1 },
    { field: 'source', headerName: '数据源', minWidth: 150 },
    { field: 'expected', headerName: '应有金额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.expected) },
    { field: 'actual', headerName: '实有/合计', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.actual) },
    { field: 'variance', headerName: '差异', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.variance) },
    { field: 'coverage', headerName: '覆盖率', width: 110, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatPercent(Math.round(numberValue(row.coverage) * 100), 100) },
    { field: 'status', headerName: '结论', width: 125, renderCell: ({ row }) => <Status value={String(row.status)} /> },
  ], []);

  const channelColumns = useMemo<GridColDef[]>(() => [
    { field: 'channel', headerName: '通道', minWidth: 130, valueGetter: (_, row) => String(row.channelName || '-') },
    { field: 'account', headerName: '资金池账户', minWidth: 200, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['accountName', 'accountId', 'apiAccountId'])) },
    { field: 'expected', headerName: '账面应有', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => row.mapped ? formatAmount(row.expectedBalance, String(row.currency || 'USD')) : '未映射' },
    { field: 'actual', headerName: '渠道实有', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.actualBalance, String(row.currency || 'USD')) },
    { field: 'variance', headerName: '差异', width: 140, align: 'right', headerAlign: 'right', valueGetter: (_, row) => row.mapped ? formatAmount(row.variance, String(row.currency || 'USD')) : '-' },
    { field: 'snapshot', headerName: '快照时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.snapshotAt) },
    { field: 'status', headerName: '核对状态', width: 125, renderCell: ({ row }) => <Status value={String(row.status)} /> },
  ], []);

  const caseColumns = useMemo<GridColDef[]>(() => [
    { field: 'severity', headerName: '等级', width: 95, renderCell: ({ row }) => <Status value={String(row.severity)} /> },
    { field: 'title', headerName: '调查事项', minWidth: 260, flex: 1 },
    { field: 'kind', headerName: '类型', width: 125, valueGetter: (_, row) => ({ balance: '账实差异', channel: '渠道差异', 'data-quality': '数据缺口', transaction: '可疑交易' }[String(row.kind)] || row.kind) },
    { field: 'variance', headerName: '账实差异', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => numberValue(row.variance) ? formatAmount(row.variance) : '-' },
    { field: 'suspiciousAmount', headerName: '可疑金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => numberValue(row.suspiciousAmount) ? formatAmount(row.suspiciousAmount) : '-' },
    { field: 'confidence', headerName: '证据置信度', width: 115 },
    { field: 'nextStep', headerName: '下一步', minWidth: 280, flex: 1 },
  ], []);

  const fraudColumns = useMemo<GridColDef[]>(() => [
    { field: 'severity', headerName: '等级', width: 95, renderCell: ({ row }) => <Status value={String(row.severity)} /> },
    { field: 'billId', headerName: '交易号', minWidth: 190, flex: 1 },
    { field: 'card', headerName: '卡片', minWidth: 185, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardId'])) },
    { field: 'merchant', headerName: '商户', minWidth: 190, flex: 1 },
    { field: 'amount', headerName: '金额', width: 140, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'score', headerName: '调查分', width: 100, align: 'right', headerAlign: 'right' },
    { field: 'signals', headerName: '命中证据', minWidth: 340, flex: 1, valueGetter: (_, row) => Array.isArray(row.signals) ? row.signals.join('；') : '-' },
    { field: 'time', headerName: '发生时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.occurredAt) },
  ], []);

  if (loading || !model) return <PageSkeleton />;
  const summary = asRecord(state?.funds.summary);
  const batch = asRecord(summary.batch);
  const modeHistory = mode === '即时核对' ? model.history.slice(-7) : mode === '日终核对' ? model.history.filter((row) => String(row.stage) === '日终核对').slice(-14) : model.history;
  const balanceCases = model.cases.filter((item) => item.kind !== 'transaction');
  const criticalFraud = model.fraudSignals.filter((item) => item.severity === '严重' || item.severity === '高');

  return <>
    <PageHeader
      title="资金对账与盗刷监控"
      description="把平台总账、用户分户账、渠道真实资金池和成功交易放在同一截止时间核对。"
      breadcrumbs={[{ label: '分析中心', to: '/analytics/overview' }, { label: '资金对账' }]}
      action={<Stack direction="row" gap={1}><ButtonGroup size="small" aria-label="核对周期">{(['即时核对', '日终核对', '周期核对'] as ReviewMode[]).map((item) => <Button key={item} variant={mode === item ? 'contained' : 'outlined'} onClick={() => setMode(item)}>{item}</Button>)}</ButtonGroup><Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>重新读取</Button></Stack>}
    />
    {error ? <ErrorState message={error} onRetry={load} /> : null}
    <AnalyticsContextBar period={`${mode} · 最近30日交易行为`} scope="平台总账、用户分户账、渠道资金池、卡交易" freshness={String(pickValue(batch, ['snapshotTimeText'], formatDateTime(model.asOf)))} sample={model.quality.transactionCoverage < 1} />
    <InsightSummary title="当前资金判断" insights={[
      { label: '是否对得上', detail: model.status === '已核对' ? `全部可比关口在 ±${formatAmount(model.tolerance)} 内` : `最大可比差异 ${formatAmount(model.maxUnexplainedVariance)}`, tone: model.status === '已核对' ? 'success' : 'error' },
      { label: '是否可能少钱', detail: balanceCases.some((item) => item.variance < -model.tolerance) ? '存在负向账实差异，必须调查；尚不能仅凭汇总认定损失' : '当前未发现超过容差的负向确认差异', tone: balanceCases.some((item) => item.variance < -model.tolerance) ? 'error' : 'success' },
      { label: '盗刷信号', detail: `${criticalFraud.length} 笔高等级成功交易需核验授权`, tone: criticalFraud.length ? 'warning' : 'success' },
    ]} />
    {model.status === '数据不完整' ? <Alert severity="warning" sx={{ mb: 3 }}>存在渠道拉取失败、快照过期或账面映射缺失。缺数据和少钱是两回事：先补齐同一截止时间的真实资金池，再形成最终对账结论。</Alert> : null}

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="对账结论" value={model.status} helper={`策略 ${model.policyVersion}`} icon="solar:checklist-minimalistic-bold-duotone" tone={model.status === '已核对' ? 'success' : 'error'} /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="最大未解释差异" value={formatAmount(model.maxUnexplainedVariance)} helper={`允许误差 ±${formatAmount(model.tolerance)}`} icon="solar:danger-triangle-bold-duotone" tone="error" /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="渠道账面 / 实有" value={formatAmount(model.totals.channelActual)} helper={`账面应有 ${formatAmount(model.totals.channelExpected)}`} icon="solar:safe-square-bold-duotone" tone="info" /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="高等级可疑交易" value={formatNumber(criticalFraud.length)} helper={`全部信号金额 ${formatAmount(model.totals.suspiciousAmount)}`} icon="solar:shield-warning-bold-duotone" tone="warning" /></Grid>
      <Grid item xs={12} sm={6} lg={2.4}><MetricCard label="数据可信度" value={model.quality.confidence} helper={`交易覆盖 ${formatPercent(Math.round(model.quality.transactionCoverage * 100), 100)}`} icon="solar:verified-check-bold-duotone" tone={model.quality.confidence === '高' ? 'success' : 'warning'} /></Grid>
    </Grid>

    <Card sx={{ mb: 3, overflow: 'hidden' }}>
      <CardHeader title="四道核对关口" subheader="任何一道不平，都必须定位到原始账户、渠道或交易；多道差异不能直接相加，避免重复计算同一笔钱。" />
      <Divider />
      <Grid container>
        {model.checkpoints.map((item, index) => <Grid item xs={12} md={3} key={item.id} sx={{ p: 2.5, borderRight: { md: index < 3 ? 1 : 0 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Typography variant="subtitle2">{index + 1}. {item.name}</Typography><Status value={item.status} /></Stack>
          <Typography variant="h5" sx={{ mt: 2, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(item.variance)}</Typography>
          <Typography variant="caption" color="text.secondary">实有 − 应有 · 覆盖 {formatPercent(Math.round(item.coverage * 100), 100)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{item.formula}</Typography>
        </Grid>)}
      </Grid>
    </Card>

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} lg={8}><ChartCard title={`${mode}差异趋势`} subheader="应有与实有必须使用同一截止时间；持续偏离比单点波动更需要调查" type="line" series={[
        { name: '应有金额', data: modeHistory.map((row) => numberValue(row.expectedAmount)) },
        { name: '实有金额', data: modeHistory.map((row) => numberValue(row.actualAmount)) },
      ]} categories={modeHistory.map((row) => formatDateTime(row.checkpointAt).slice(0, 10))} height={330} /></Grid>
      <Grid item xs={12} lg={4}><ChartCard title="对账关口差异" subheader="绝对值用于比较，方向请在明细查看" type="bar" series={[{ name: '差异绝对值', data: model.checkpoints.map((item) => Math.abs(item.variance)) }]} categories={model.checkpoints.map((item) => item.name)} height={330} options={{ legend: { show: false } }} /></Grid>
    </Grid>

    <SectionHeading title="差异定位" description="先确认数据完整，再从平台恒等式定位到渠道资金池和具体交易。" />
    <Stack gap={3}>
      <DataTableCard title="三方账实核对矩阵" subheader="应有、实有、差异、覆盖率和截止时间都在同一行" rows={model.checkpoints} columns={checkpointColumns} getRowId={(row) => String(row.id)} onRowClick={(row) => navigate(`/reconciliation/cases/${encodeURIComponent(`balance-${row.id}`)}`)} minHeight={330} />
      <DataTableCard title="渠道真实资金池" subheader="渠道未映射或拉取失败时，不把余额差异当成资金损失" rows={model.channelRows} columns={channelColumns} getRowId={(row) => String(pickValue(row, ['id', 'apiAccountId']))} onRowClick={(row) => navigate(`/reconciliation/cases/${encodeURIComponent(`channel-${pickValue(row, ['id', 'apiAccountId'])}`)}`)} minHeight={390} />
      <DataTableCard title="调查事项队列" subheader="同时容纳账实差异、数据缺口和可疑交易；点击进入证据页" rows={model.cases} columns={caseColumns} getRowId={(row) => String(row.id)} onRowClick={(row) => navigate(`/reconciliation/cases/${encodeURIComponent(String(row.id))}`)} minHeight={470} />
      <DataTableCard title="成功交易盗刷信号" subheader="使用重复扣款、速度、稳健金额异常、新商户和冻结卡状态；信号不是盗刷结论" rows={model.fraudSignals} columns={fraudColumns} getRowId={(row) => String(row.billId)} onRowClick={(row) => navigate(`/reconciliation/cases/${encodeURIComponent(String(row.caseId))}`)} minHeight={470} />
    </Stack>

    <Box sx={{ mt: 3 }}><Alert severity="info" icon={<Icon icon="solar:document-text-bold-duotone" />}>最终确认“不会少钱”需要三项同时成立：所有资金源同一截止时间、全部渠道账户已映射并成功拉取、差异在版本化容差内。当前界面只读，不会触发渠道刷新、冻结或退款。</Alert></Box>
  </>;
}

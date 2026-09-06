import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Box, Button, Card, CardHeader, Divider, Grid, Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams } from 'react-router-dom';
import { getReconciliationData } from '../api/queries';
import { AnalyticsContextBar, InsightSummary, SectionHeading } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { DataTableCard } from '../components/DataTableCard';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { asRecord, formatAmount, formatDateTime, maskCard, numberValue, pickValue, toRows } from '../utils/format';
import { buildReconciliationModel, type ReconciliationCase } from '../utils/reconciliationEngine';

type State = Awaited<ReturnType<typeof getReconciliationData>>;

export function ReconciliationCasePage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setState(await getReconciliationData()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '调查证据读取失败。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => state ? buildReconciliationModel({
    summary: asRecord(state.funds.summary), users: toRows(state.funds.users.list), channels: toRows(state.funds.channels.list),
    transactions: toRows(state.transactions.list), cards: toRows(state.cards.list), transactionReportedTotal: Number(state.transactions.total || 0),
  }) : null, [state]);
  const currentCase = useMemo<ReconciliationCase | undefined>(() => {
    const existing = model?.cases.find((item) => item.id === caseId);
    if (existing) return existing;
    const checkpoint = model?.checkpoints.find((item) => `balance-${item.id}` === caseId);
    if (!checkpoint) return undefined;
    return {
      id: caseId, kind: 'balance', title: checkpoint.name, entityType: 'platform', entityId: checkpoint.id,
      severity: '低', confidence: checkpoint.coverage >= 0.9 ? '高' : '中', expected: checkpoint.expected,
      actual: checkpoint.actual, variance: checkpoint.variance, suspiciousAmount: 0,
      evidence: [checkpoint.formula, `数据覆盖率 ${(checkpoint.coverage * 100).toFixed(1)}%`, `当前结论 ${checkpoint.status}`],
      nextStep: '当前关口已在容差内；保留本批次证据并继续监控后续快照。',
    };
  }, [caseId, model]);
  const transactions = toRows(state?.transactions.list);
  const relatedRows = useMemo(() => {
    if (!currentCase) return [];
    if (currentCase.entityType === 'transaction') {
      const target = transactions.find((row) => String(pickValue(row, ['billId', 'id'])) === currentCase.entityId);
      const cardId = String(target?.cardId || '');
      return transactions.filter((row) => String(row.cardId) === cardId).sort((a, b) => numberValue(pickValue(b, ['createTime'], 0)) - numberValue(pickValue(a, ['createTime'], 0)));
    }
    if (currentCase.entityType === 'channel') {
      const channel = model?.channelRows.find((row) => String(pickValue(row, ['id', 'apiAccountId'])) === currentCase.entityId);
      const channelKey = String(pickValue(channel || {}, ['channelName', 'apiAccountId'], ''));
      return transactions.filter((row) => String(pickValue(row, ['channelName', 'apiAccountId'], '')) === channelKey);
    }
    return transactions.filter((row) => Math.abs(numberValue(row.amount)) >= 500).slice(0, 50);
  }, [currentCase, model?.channelRows, transactions]);

  const columns = useMemo<GridColDef[]>(() => [
    { field: 'bill', headerName: '交易号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
    { field: 'card', headerName: '卡片', minWidth: 185, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardId'])) },
    { field: 'merchant', headerName: '商户', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail'])) },
    { field: 'amount', headerName: '金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'status', headerName: '结果', width: 105, valueGetter: (_, row) => String(pickValue(row, ['tradeStatusLabel', 'tradeStatus'])) },
    { field: 'time', headerName: '时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
  ], []);

  if (loading || !model) return <PageSkeleton />;
  if (!currentCase) return <ErrorState message="该调查事项不在当前快照中，可能已核对完成或数据范围已变化。" onRetry={() => navigate('/reconciliation')} />;
  const formula = model.checkpoints.find((item) => `balance-${item.id}` === currentCase.id)?.formula;

  return <>
    <PageHeader title={currentCase.title} description="调查事项证据页：保留金额口径、数据置信度、原始关联交易和下一步核验路径。" breadcrumbs={[{ label: '资金对账', to: '/reconciliation' }, { label: '调查事项' }, { label: currentCase.id }]} action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>重新读取证据</Button>} />
    {error ? <ErrorState message={error} onRetry={load} /> : null}
    <AnalyticsContextBar period="当前快照 + 最近30日交易样本" scope={`${currentCase.kind} · ${currentCase.entityType}`} freshness={formatDateTime(model.asOf)} sample={model.quality.transactionCoverage < 1} />
    <InsightSummary title="调查结论边界" insights={[
      { label: '当前发现', detail: currentCase.variance ? `实有减应有为 ${formatAmount(currentCase.variance)}` : `可疑成功交易金额 ${formatAmount(currentCase.suspiciousAmount)}`, tone: currentCase.severity === '严重' || currentCase.severity === '高' ? 'error' : 'warning' },
      { label: '证据强度', detail: `${currentCase.confidence}置信度 · ${currentCase.evidence.length} 条可解释证据`, tone: currentCase.confidence === '低' ? 'warning' : 'info' },
      { label: '不能直接断言', detail: currentCase.kind === 'transaction' ? '行为信号不能单独证明盗刷，必须取得授权与订单证据' : '汇总差异不能单独证明资金损失，必须排除在途与截止时间差', tone: 'info' },
    ]} />

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="严重程度" value={currentCase.severity} helper={`${currentCase.confidence}置信度`} icon="solar:danger-triangle-bold-duotone" tone="error" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="账面应有" value={currentCase.kind === 'transaction' ? '-' : formatAmount(currentCase.expected)} helper="同一截止时间口径" icon="solar:document-text-bold-duotone" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label={currentCase.kind === 'transaction' ? '交易金额' : '实际读取'} value={formatAmount(currentCase.kind === 'transaction' ? currentCase.suspiciousAmount : currentCase.actual)} helper={currentCase.entityType} icon="solar:safe-square-bold-duotone" tone="info" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="未解释差异" value={currentCase.kind === 'transaction' ? '待核验' : formatAmount(currentCase.variance)} helper={`容差 ±${formatAmount(model.tolerance)}`} icon="solar:scale-bold-duotone" tone="warning" /></Grid>
    </Grid>

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} lg={7}>
        <Card sx={{ height: '100%' }}><CardHeader title="证据链" subheader="每条信号都能回到原始字段或明确公式" /><Divider /><Stack gap={1.5} sx={{ p: 3 }}>
          {formula ? <Alert severity="info"><strong>核对公式：</strong>{formula}</Alert> : null}
          {currentCase.evidence.map((item, index) => <Stack key={item} direction="row" gap={1.2} alignItems="flex-start"><Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: 'warning.lighter', color: 'warning.dark', display: 'grid', placeItems: 'center', flex: '0 0 auto', fontSize: 12, fontWeight: 700 }}>{index + 1}</Box><Typography variant="body2" sx={{ pt: 0.35 }}>{item}</Typography></Stack>)}
        </Stack></Card>
      </Grid>
      <Grid item xs={12} lg={5}>
        <Card sx={{ height: '100%' }}><CardHeader title="处置路径" subheader="当前后台只读，不代替人工授权确认" /><Divider /><Stack gap={2} sx={{ p: 3 }}>
          <Typography variant="body1">{currentCase.nextStep}</Typography>
          <Divider />
          <Typography variant="caption" color="text.secondary">建议核对顺序</Typography>
          {['冻结统计截止时间', '补齐失败与未映射数据源', '核对原始流水和在途清算', '向持卡人/商户确认授权', '形成带证据的最终结论'].map((item, index) => <Stack key={item} direction="row" gap={1}><Typography variant="caption" color="primary.main" fontWeight={700}>{index + 1}</Typography><Typography variant="body2">{item}</Typography></Stack>)}
          {currentCase.entityType === 'transaction' ? <Button variant="outlined" onClick={() => navigate(`/analytics/entities/transaction/${currentCase.entityId}?from=reconciliation`)}>打开完整交易分析</Button> : null}
        </Stack></Card>
      </Grid>
    </Grid>

    <SectionHeading title="关联原始交易" description="用于核对时间、商户、金额、卡片和交易结果；点击继续进入交易分析。" />
    <DataTableCard title="同卡 / 同渠道 / 大额关联交易" rows={relatedRows} columns={columns} getRowId={(row) => String(pickValue(row, ['billId', 'id']))} onRowClick={(row) => navigate(`/analytics/entities/transaction/${pickValue(row, ['billId', 'id'])}?from=reconciliation`)} minHeight={480} />
    <Alert severity="warning" sx={{ mt: 3 }}>不要自动冻结、退款或冲正：本页只形成调查优先级。生产处置需要经过授权证据、双人复核和可审计审批。</Alert>
  </>;
}

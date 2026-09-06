import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Button, Card, Grid, Tab, Tabs } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getUserCardAssetDetail, getUserRiskWarnings } from '../../../../packages/shared/src/api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { DataTableCard } from '../components/DataTableCard';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, formatPercent, maskCard, pickValue, toRows } from '../utils/format';

export function UserCardAssetDetailPage() {
  const { userId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Record<string, unknown>>({});
  const [riskRows, setRiskRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tab = searchParams.get('tab') || 'cards';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [asset, risk] = await Promise.all([
        getUserCardAssetDetail(userId, { cardsPage: 1, cardsPageSize: 50 }),
        getUserRiskWarnings({ userId }),
      ]);
      setDetail(asset);
      setRiskRows(toRows(risk.list));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户卡资产详情读取失败。');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const cardColumns = useMemo<GridColDef[]>(() => [
    { field: 'card', headerName: '卡片', minWidth: 210, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
    { field: 'name', headerName: '名称', minWidth: 150, valueGetter: (_, row) => String(pickValue(row, ['cardName', 'note'])) },
    { field: 'bin', headerName: 'BIN', width: 105, valueGetter: (_, row) => String(pickValue(row, ['cardBin'])) },
    { field: 'channel', headerName: '通道', width: 130, valueGetter: (_, row) => String(pickValue(row, ['apiAccountLabel', 'apiAccountId'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['cardStatusLabel', 'cardStatus'])} /> },
    { field: 'balance', headerName: '余额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['cardBalance', 'availableBalance'], 0)) },
    { field: 'created', headerName: '创建时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.createTime) },
  ], []);

  const billColumns = useMemo<GridColDef[]>(() => [
    { field: 'bill', headerName: '交易号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
    { field: 'card', headerName: '卡片', minWidth: 190, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
    { field: 'merchant', headerName: '商户/说明', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['tradeStatusLabel', 'tradeStatus'])} /> },
    { field: 'amount', headerName: '金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'time', headerName: '完成时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
  ], []);

  const otpColumns = useMemo<GridColDef[]>(() => [
    { field: 'id', headerName: '记录ID', minWidth: 140, valueGetter: (_, row) => String(pickValue(row, ['otpRecordId', 'id'])) },
    { field: 'card', headerName: '卡片', minWidth: 210, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} /> },
    { field: 'time', headerName: '接收时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.createTime) },
  ], []);

  if (loading) return <PageSkeleton />;
  const summary = asRecord(detail.summary);
  const cardsPage = asRecord(detail.cards);
  const cards = toRows(cardsPage.list);
  const bills = toRows(detail.recentBills);
  const otps = toRows(detail.recentOtpRecords);
  const email = String(pickValue(summary, ['userEmail', 'email'], userId));
  const risk = riskRows[0] || {};

  return (
    <>
      <PageHeader
        title={email}
        description={`账户 ${userId} 的卡片资产、近期交易、OTP 与风险上下文。`}
        breadcrumbs={[{ label: '账户卡资产', to: '/cards/assets' }, { label: email }]}
        action={<Button variant="contained" onClick={() => navigate(`/analytics/entities/account/${userId}?from=accounts/all`)} startIcon={<Icon icon="solar:chart-bold-duotone" />}>进入账户分析</Button>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period="资产当前值 · 交易与 OTP 近期记录" scope={`账户 ${userId}`} />
      <InsightSummary insights={[
        { label: '卡片使用', detail: `活跃率 ${formatPercent(summary.activeCardCount, summary.cardCount)}，共 ${formatNumber(summary.cardCount)} 张卡`, tone: 'info' },
        { label: '交易活跃', detail: `近30日交易 ${formatAmount(summary.tradeAmount30d)}，最近交易 ${formatDateTime(summary.lastTradeTime)}`, tone: 'info' },
        { label: '资金风险', detail: riskRows.length ? `${String(pickValue(risk, ['riskLevelLabel', 'riskLevel']))} · 使用率 ${String(pickValue(risk, ['fundUsagePercent'], 0))}%` : '当前没有账户资金预警', tone: riskRows.length ? 'warning' : 'success' },
      ]} />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="卡片数量" value={formatNumber(summary.cardCount)} helper={`${formatNumber(summary.activeCardCount)} 张活跃`} icon="solar:card-2-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="卡片总余额" value={formatAmount(summary.totalCardBalance)} icon="solar:wallet-money-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="近30日交易" value={formatAmount(summary.tradeAmount30d)} icon="solar:graph-up-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="风险等级" value={String(pickValue(risk, ['riskLevelLabel', 'riskLevel'], '正常'))} helper={riskRows.length ? String(risk.matchedRules || '已进入预警') : '无预警记录'} icon="solar:shield-warning-bold-duotone" tone={riskRows.length ? 'warning' : 'success'} /></Grid>
      </Grid>

      <Card sx={{ mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, value) => setSearchParams({ tab: value })} variant="scrollable" scrollButtons="auto">
          <Tab value="cards" label={`卡片 ${Number(cardsPage.total || cards.length)}`} />
          <Tab value="transactions" label={`近期交易 ${bills.length}`} />
          <Tab value="otp" label={`近期 OTP ${otps.length}`} />
          <Tab value="risk" label={`资金风险 ${riskRows.length}`} />
        </Tabs>
      </Card>

      {tab === 'cards' ? (
        <DataTableCard title="账户卡片" subheader="点击进入单卡分析；分析页再提供原始详情入口" rows={cards} columns={cardColumns} getRowId={(row) => String(pickValue(row, ['cardId', 'id']))} onRowClick={(row) => navigate(`/analytics/entities/card/${pickValue(row, ['cardId', 'id'])}?from=accounts/all`)} minHeight={470} />
      ) : tab === 'transactions' ? (
        <DataTableCard title="近期交易" subheader="点击进入单笔与同卡交易对比分析" rows={bills} columns={billColumns} getRowId={(row) => String(pickValue(row, ['billId', 'id']))} onRowClick={(row) => navigate(`/analytics/entities/transaction/${pickValue(row, ['billId', 'id'])}?from=accounts/all`)} minHeight={470} />
      ) : tab === 'otp' ? (
        <><Alert severity="warning" sx={{ mb: 2 }}>OTP 只在当前内存会话中读取；Demo 快照不会保存原始 OTP。</Alert><DataTableCard title="近期 OTP" rows={otps} columns={otpColumns} getRowId={(row) => String(pickValue(row, ['otpRecordId', 'id']))} onRowClick={(row) => navigate(`/cards/${pickValue(row, ['cardId'])}?tab=otp`)} minHeight={430} /></>
      ) : (
        <Card sx={{ p: 3 }}>
          {riskRows.length ? <Grid container spacing={3}>
            <Grid item xs={12} sm={6}><MetricCard label="资金使用率" value={`${String(pickValue(risk, ['fundUsagePercent'], 0))}%`} icon="solar:chart-bold-duotone" tone="warning" /></Grid>
            <Grid item xs={12} sm={6}><MetricCard label="实际剩余" value={formatAmount(risk.actualRemainingAvailableAmount)} helper={String(risk.matchedRules || '')} icon="solar:wallet-money-bold-duotone" tone="error" /></Grid>
          </Grid> : <Alert severity="success">当前风险接口未返回该账户预警。</Alert>}
        </Card>
      )}
    </>
  );
}

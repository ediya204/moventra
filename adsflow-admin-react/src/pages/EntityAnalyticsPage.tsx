import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Button, Card, CardHeader, Divider, Grid, Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getCardBills,
  getCardDetail,
  getCardOtps,
  getCustomerDetail,
  getTransactionDetail,
  getTransactions,
  getUserCardAssetDetail,
  getUserRiskWarnings,
} from '../api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { ChartCard } from '../components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { DrilldownNavigation } from '../components/DrilldownNavigation';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, formatPercent, maskCard, numberValue, pickValue, toRows } from '../utils/format';

type EntityType = 'account' | 'card' | 'transaction';
type EntityState = {
  base: Record<string, unknown>;
  rows: Record<string, unknown>[];
  cards: Record<string, unknown>[];
  risks: Record<string, unknown>[];
  otps: Record<string, unknown>[];
};

export function EntityAnalyticsPage() {
  const { entityType: rawType, entityId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const entityType: EntityType = rawType === 'card' || rawType === 'transaction' ? rawType : 'account';
  const from = searchParams.get('from') || `${entityType === 'transaction' ? 'transactions/all' : entityType === 'card' ? 'cards/all' : 'accounts/all'}`;
  const [state, setState] = useState<EntityState>({ base: {}, rows: [], cards: [], risks: [], otps: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (entityType === 'account') {
        const [asset, risk, customer, transactions] = await Promise.all([
          getUserCardAssetDetail(entityId, { cardsPage: 1, cardsPageSize: 100 }),
          getUserRiskWarnings({ userId: entityId, pageSize: 50 }),
          getCustomerDetail(entityId),
          getTransactions({ userId: entityId, page: 1, pageSize: 100 }),
        ]);
        setState({ base: { ...asRecord(customer.baseInfo), ...asRecord(asset.summary) }, rows: toRows(transactions.list), cards: toRows(asRecord(asset.cards).list), risks: toRows(risk.list), otps: toRows(asset.recentOtpRecords) });
      } else if (entityType === 'card') {
        const [detail, bills, otps] = await Promise.all([getCardDetail(entityId), getCardBills(entityId, { page: 1, pageSize: 100 }), getCardOtps(entityId)]);
        setState({ base: { ...asRecord(detail.baseInfo), ...asRecord(detail.balanceInfo) }, rows: toRows(bills.list), cards: [], risks: [], otps: toRows(otps.list) });
      } else {
        const transaction = await getTransactionDetail(entityId);
        const cardId = String(pickValue(transaction, ['cardId'], ''));
        const userId = String(pickValue(transaction, ['userId'], ''));
        const [related, risks] = await Promise.all([
          cardId ? getTransactions({ cardId, page: 1, pageSize: 100 }) : Promise.resolve({ list: [] }),
          userId ? getUserRiskWarnings({ userId, pageSize: 50 }) : Promise.resolve({ list: [] }),
        ]);
        setState({ base: transaction, rows: toRows(related.list), cards: [], risks: toRows(risks.list), otps: [] });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '实体分析读取失败。');
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    const amount = state.rows.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const succeeded = state.rows.filter((row) => ['1', 'success', '成功'].includes(String(pickValue(row, ['tradeStatus', 'tradeStatusLabel'])).toLowerCase())).length;
    const failed = state.rows.filter((row) => ['2', 'failed', '失败'].includes(String(pickValue(row, ['tradeStatus', 'tradeStatusLabel'])).toLowerCase())).length;
    const pending = state.rows.length - succeeded - failed;
    const merchantMap = new Map<string, number>();
    state.rows.forEach((row) => {
      const merchant = String(pickValue(row, ['merchantName', 'tradeDetail'], '其他'));
      merchantMap.set(merchant, (merchantMap.get(merchant) || 0) + numberValue(row.amount));
    });
    const merchants = [...merchantMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { amount, succeeded, failed, pending, merchants };
  }, [state.rows]);

  const columns = useMemo<GridColDef[]>(() => [
    { field: 'id', headerName: '交易号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
    { field: 'merchant', headerName: '商户/说明', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail'])) },
    { field: 'card', headerName: '卡片', minWidth: 190, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
    { field: 'status', headerName: '状态', width: 105, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['tradeStatusLabel', 'tradeStatus'])} /> },
    { field: 'amount', headerName: '金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'time', headerName: '完成时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
  ], []);

  if (loading) return <PageSkeleton />;
  const base = state.base;
  const userId = String(pickValue(base, ['userId'], entityType === 'account' ? entityId : ''));
  const cardId = String(pickValue(base, ['cardId'], entityType === 'card' ? entityId : ''));
  const title = entityType === 'account'
    ? String(pickValue(base, ['userEmail', 'email'], `账户 ${entityId}`))
    : entityType === 'card'
      ? maskCard(pickValue(base, ['cardNoMasked', 'cardNo'], entityId))
      : `交易 ${entityId}`;
  const topicRoute = `/analytics/topics/${from}`;
  const sourceLabel = entityType === 'account' ? '账户分析' : entityType === 'card' ? '单卡分析' : '单笔交易分析';
  const rawRoute = entityType === 'account' ? `/customers/${entityId}` : entityType === 'card' ? `/cards/${entityId}` : `/transactions/${entityId}`;

  const openTransaction = (row: Record<string, unknown>) => navigate(`/analytics/entities/transaction/${pickValue(row, ['billId', 'id'])}?from=${from}`);

  return (
    <>
      <PageHeader title={title} description={`${sourceLabel}：交易表现、对象构成、风险信号和关联记录在同一页连续调查。`} breadcrumbs={[{ label: '分析中心', to: '/analytics/overview' }, { label: '专题', to: topicRoute }, { label: title }]} action={<Stack direction="row" gap={1}><Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新分析</Button><Button variant="contained" onClick={() => navigate(rawRoute)} startIcon={<Icon icon="solar:document-text-linear" />}>查看原始详情</Button></Stack>} />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <DrilldownNavigation steps={[{ label: '业务全景', route: '/analytics/overview' }, { label: '专题分析', route: topicRoute }, { label: sourceLabel }, { label: title }]} />
      <AnalyticsContextBar period="当前实体 + 最多100条关联交易" scope={`${sourceLabel} · ${entityId}`} sample />
      <InsightSummary title="实体判断" insights={[
        { label: '交易表现', detail: `${formatNumber(state.rows.length)} 笔、${formatAmount(model.amount)}，成功率 ${formatPercent(model.succeeded, state.rows.length)}`, tone: model.failed ? 'warning' : 'success' },
        { label: '异常信号', detail: `${formatNumber(model.failed)} 笔失败、${formatNumber(model.pending)} 笔待处理`, tone: model.failed + model.pending ? 'warning' : 'success' },
        { label: '关系范围', detail: `${formatNumber(state.cards.length)} 张卡、${formatNumber(state.risks.length)} 条资金风险、${formatNumber(state.otps.length)} 条 OTP 元数据`, tone: state.risks.length ? 'warning' : 'info' },
      ]} />
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="关联交易" value={formatNumber(state.rows.length)} helper={`成功 ${formatNumber(model.succeeded)} 笔`} icon="solar:bill-list-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="交易金额" value={formatAmount(model.amount)} helper={`均笔 ${formatAmount(state.rows.length ? model.amount / state.rows.length : 0)}`} icon="solar:wallet-money-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="交易成功率" value={formatPercent(model.succeeded, state.rows.length)} helper={`${formatNumber(model.failed)} 笔失败`} icon="solar:check-circle-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="风险记录" value={formatNumber(state.risks.length)} helper={state.risks.length ? String(pickValue(state.risks[0], ['riskLevelLabel', 'matchedRules'])) : '当前无预警'} icon="solar:shield-warning-bold-duotone" tone={state.risks.length ? 'warning' : 'success'} /></Grid>
      </Grid>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={7}><ChartCard title="商户金额构成" subheader="当前实体关联交易的前8个商户" type="bar" series={[{ name: '交易金额', data: model.merchants.map((item) => item[1]) }]} categories={model.merchants.map((item) => item[0])} height={340} options={{ plotOptions: { bar: { horizontal: true, borderRadius: 4 } }, legend: { show: false } }} /></Grid>
        <Grid item xs={12} lg={5}><ChartCard title="处理结果结构" subheader="成功、失败与待处理" type="donut" series={[model.succeeded, model.failed, model.pending]} height={340} options={{ labels: ['成功', '失败', '待处理'], legend: { position: 'bottom' } }} /></Grid>
      </Grid>

      {entityType === 'account' ? (
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid item xs={12} lg={8}><ChartCard title="卡片余额分布" subheader="该账户全部当前加载卡片" type="bar" series={[{ name: '卡片余额', data: state.cards.map((row) => numberValue(pickValue(row, ['cardBalance', 'availableBalance']))) }]} categories={state.cards.map((row) => maskCard(pickValue(row, ['cardNoMasked', 'cardId'])))} height={300} options={{ legend: { show: false } }} /></Grid>
          <Grid item xs={12} lg={4}><Card sx={{ height: '100%' }}><CardHeader title="继续下钻" subheader="保持账户关系语境" /><Divider /><Stack gap={1.2} sx={{ p: 3 }}>{state.cards.slice(0, 5).map((row) => <Button key={String(row.cardId)} variant="outlined" sx={{ justifyContent: 'space-between' }} onClick={() => navigate(`/analytics/entities/card/${row.cardId}?from=${from}`)}>{maskCard(pickValue(row, ['cardNoMasked', 'cardId']))}<Icon icon="solar:alt-arrow-right-linear" /></Button>)}{!state.cards.length ? <Typography variant="body2" color="text.secondary">当前接口未返回卡片。</Typography> : null}</Stack></Card></Grid>
        </Grid>
      ) : null}

      {entityType === 'transaction' ? <Alert severity="info" sx={{ mb: 3 }}>当前单笔交易作为锚点；下表是同卡交易，可继续切换交易对象。账户和卡片分析入口保留在本页底部。</Alert> : null}
      <DataTableCard title={entityType === 'transaction' ? '同卡交易对比' : '关联交易明细'} subheader="点击交易继续进入单笔分析；需要字段证据时再进入原始详情" rows={state.rows} columns={columns} getRowId={(row) => String(pickValue(row, ['billId', 'id']))} onRowClick={openTransaction} minHeight={500} />
      <Card sx={{ mt: 3 }}><CardHeader title="关系路径" subheader="分析页之间连续下钻，原始查询详情作为证据终点" /><Divider /><Stack direction={{ xs: 'column', sm: 'row' }} gap={1.2} sx={{ p: 3 }}>
        {userId ? <Button variant="outlined" onClick={() => navigate(`/analytics/entities/account/${userId}?from=${from}`)} startIcon={<Icon icon="solar:user-id-linear" />}>账户分析</Button> : null}
        {cardId ? <Button variant="outlined" onClick={() => navigate(`/analytics/entities/card/${cardId}?from=${from}`)} startIcon={<Icon icon="solar:card-search-linear" />}>卡片分析</Button> : null}
        <Button variant="outlined" onClick={() => navigate(rawRoute)} startIcon={<Icon icon="solar:document-text-linear" />}>原始查询详情</Button>
      </Stack></Card>
    </>
  );
}


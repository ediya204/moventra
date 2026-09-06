import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Button, Grid } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getCards,
  getPlatformFundsReport,
  getRiskData,
  getTransactions,
  getUserCardAssets,
} from '../../../../packages/shared/src/api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { ChartCard } from '../../../../packages/shared/src/components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { DrilldownNavigation } from '../components/DrilldownNavigation';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { formatAmount, formatDateTime, formatNumber, formatPercent, maskCard, numberValue, pickValue, toRows } from '../utils/format';

type Topic = 'transactions' | 'cards' | 'accounts' | 'risk' | 'funds';
type TopicState = { rows: Record<string, unknown>[]; total: number; meta?: Record<string, unknown> };

const topicMeta: Record<Topic, { title: string; description: string; icon: string; segments: { key: string; label: string }[] }> = {
  transactions: { title: '交易专题分析', description: '在同一分析语境内比较状态、金额和交易对象，再下钻到单笔交易。', icon: 'solar:transfer-horizontal-bold-duotone', segments: [{ key: 'all', label: '全部样本' }, { key: 'failed', label: '失败' }, { key: 'pending', label: '待处理' }, { key: 'large', label: '大额' }] },
  cards: { title: '卡片专题分析', description: '按卡状态、余额和卡段拆分运营供给，再下钻到单卡。', icon: 'solar:card-2-bold-duotone', segments: [{ key: 'all', label: '全部样本' }, { key: 'active', label: '活跃' }, { key: 'frozen', label: '冻结' }, { key: 'low-balance', label: '低余额' }] },
  accounts: { title: '账户群组专题', description: '按交易活跃、卡资产和风险结构筛选账户，再进入账户级分析。', icon: 'solar:users-group-rounded-bold-duotone', segments: [{ key: 'all', label: '全部样本' }, { key: 'high-activity', label: '高活跃' }, { key: 'high-balance', label: '高卡余额' }, { key: 'risk', label: '有风险' }] },
  risk: { title: '风险专题分析', description: '分别审查高风险、负余额和风险卡片，并保留账户/卡片关联。', icon: 'solar:shield-warning-bold-duotone', segments: [{ key: 'accounts', label: '预警账户' }, { key: 'high', label: '高风险' }, { key: 'negative', label: '负余额' }, { key: 'cards', label: '风险卡片' }] },
  funds: { title: '资金与渠道专题', description: '从用户资金、授信敞口和渠道余额逐层核对当前快照。', icon: 'solar:safe-square-bold-duotone', segments: [{ key: 'users', label: '用户资金' }, { key: 'credit', label: '授信账户' }, { key: 'channels', label: '渠道账户' }, { key: 'exceptions', label: '快照异常' }] },
};

function validTopic(value: string | undefined): Topic {
  return value && value in topicMeta ? value as Topic : 'transactions';
}

export function AnalysisTopicPage() {
  const params = useParams();
  const navigate = useNavigate();
  const topic = validTopic(params.topic);
  const config = topicMeta[topic];
  const segment = config.segments.some((item) => item.key === params.segment) ? String(params.segment) : config.segments[0].key;
  const [state, setState] = useState<TopicState>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (topic === 'transactions') {
        const tradeStatus = segment === 'failed' ? 2 : segment === 'pending' ? 0 : undefined;
        const result = await getTransactions({ page: 1, pageSize: 100, ...(tradeStatus === undefined ? {} : { tradeStatus }) });
        let rows = toRows(result.list);
        if (segment === 'large') rows = [...rows].sort((a, b) => numberValue(b.amount) - numberValue(a.amount)).slice(0, 30);
        setState({ rows, total: Number(result.total || rows.length), meta: result.statistics as Record<string, unknown> });
      } else if (topic === 'cards') {
        const status = segment === 'active' ? 1 : segment === 'frozen' ? 2 : undefined;
        const result = await getCards({ page: 1, pageSize: 100, ...(status === undefined ? {} : { cardStatus: status }) });
        let rows = toRows(result.list);
        if (segment === 'low-balance') rows = rows.filter((row) => numberValue(pickValue(row, ['cardBalance', 'availableBalance'])) < 300).sort((a, b) => numberValue(a.cardBalance) - numberValue(b.cardBalance));
        setState({ rows, total: Number(result.total || rows.length) });
      } else if (topic === 'accounts') {
        const result = await getUserCardAssets({ page: 1, pageSize: 100 });
        let rows = toRows(result.list);
        if (segment === 'high-activity') rows = [...rows].sort((a, b) => numberValue(b.tradeAmount30d) - numberValue(a.tradeAmount30d)).slice(0, 30);
        if (segment === 'high-balance') rows = [...rows].sort((a, b) => numberValue(b.totalCardBalance) - numberValue(a.totalCardBalance)).slice(0, 30);
        if (segment === 'risk') rows = rows.filter((row) => !['正常', 'normal', ''].includes(String(row.riskTag || '').toLowerCase()));
        setState({ rows, total: Number(result.total || rows.length) });
      } else if (topic === 'risk') {
        const result = await getRiskData();
        let rows = segment === 'cards' ? toRows(result.riskCards.list) : toRows(result.warnings.list);
        if (segment === 'high') rows = rows.filter((row) => ['high', '高风险'].includes(String(pickValue(row, ['riskLevel', 'riskLevelLabel'])).toLowerCase()));
        if (segment === 'negative') rows = rows.filter((row) => numberValue(row.actualRemainingAvailableAmount) < 0);
        setState({ rows, total: rows.length, meta: segment === 'cards' ? result.riskCardStats : result.warningStats });
      } else {
        const result = await getPlatformFundsReport();
        let rows = segment === 'channels' || segment === 'exceptions' ? toRows(result.channels.list) : toRows(result.users.list);
        if (segment === 'credit') rows = rows.filter((row) => numberValue(pickValue(row, ['realCreditLimitAmount', 'creditTotalAmount'])) > 0);
        if (segment === 'exceptions') rows = rows.filter((row) => !['success', 'ok', '正常', '成功'].includes(String(row.fetchStatus || '').toLowerCase()));
        setState({ rows, total: rows.length, meta: result.summary });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '专题分析读取失败。');
    } finally {
      setLoading(false);
    }
  }, [segment, topic]);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => {
    const rows = state.rows;
    const amount = rows.reduce((sum, row) => sum + numberValue(pickValue(row, ['amount', 'tradeAmount30d', 'totalCardBalance', 'bookRemainingAmount', 'availableBalance'])), 0);
    const failures = rows.filter((row) => ['2', 'failed', '失败'].includes(String(pickValue(row, ['tradeStatus', 'tradeStatusLabel'])).toLowerCase())).length;
    const risky = rows.filter((row) => ['high', 'medium', '高风险', '中风险', '冻结'].includes(String(pickValue(row, ['riskLevel', 'riskLevelLabel', 'riskTag', 'cardStatusLabel'])).toLowerCase())).length;
    const average = rows.length ? amount / rows.length : 0;
    return { amount, failures, risky, average };
  }, [state.rows]);

  const columns = useMemo<GridColDef[]>(() => {
    if (topic === 'transactions') return [
      { field: 'id', headerName: '交易号', minWidth: 185, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
      { field: 'account', headerName: '账户', minWidth: 210, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'userId'])) },
      { field: 'merchant', headerName: '商户', minWidth: 170, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail'])) },
      { field: 'status', headerName: '状态', width: 105, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['tradeStatusLabel', 'tradeStatus'])} /> },
      { field: 'amount', headerName: '金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
      { field: 'time', headerName: '完成时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
    ];
    if (topic === 'cards' || (topic === 'risk' && segment === 'cards')) return [
      { field: 'card', headerName: '卡片', minWidth: 200, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
      { field: 'account', headerName: '账户', minWidth: 220, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'userId'])) },
      { field: 'bin', headerName: 'BIN', width: 100, valueGetter: (_, row) => String(pickValue(row, ['cardBin'])) },
      { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['riskLevelLabel', 'cardStatusLabel', 'cardStatus'])} /> },
      { field: 'balance', headerName: '可用余额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['cardBalance', 'availableBalance'])) },
      { field: 'time', headerName: '最近交易', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.lastTradeTime) },
    ];
    if (topic === 'funds' && (segment === 'channels' || segment === 'exceptions')) return [
      { field: 'channel', headerName: '通道', minWidth: 130, valueGetter: (_, row) => String(pickValue(row, ['channelName'])) },
      { field: 'account', headerName: '通道账户', minWidth: 220, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['accountName', 'accountId'])) },
      { field: 'available', headerName: '可用余额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.availableBalance, String(row.currency || 'USD')) },
      { field: 'frozen', headerName: '冻结余额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.frozenBalance, String(row.currency || 'USD')) },
      { field: 'status', headerName: '快照状态', width: 120, renderCell: ({ row }) => <StatusChip value={row.fetchStatus} /> },
      { field: 'time', headerName: '快照时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.snapshotTimeText) },
    ];
    return [
      { field: 'account', headerName: '账户', minWidth: 240, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'email', 'userId'])) },
      { field: 'type', headerName: '类型', width: 110, valueGetter: (_, row) => String(pickValue(row, ['accountTypeLabel', 'accountType'], '-')) },
      { field: 'cards', headerName: '卡片', width: 90, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatNumber(row.cardCount) },
      { field: 'trade', headerName: '近30日交易', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['tradeAmount30d', 'cardActualConsumptionAmount'])) },
      { field: 'balance', headerName: '资产/剩余', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['totalCardBalance', 'bookRemainingAmount', 'actualRemainingAvailableAmount'])) },
      { field: 'risk', headerName: '风险', width: 115, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['riskTag', 'riskLevelLabel', 'riskLevel'], '正常')} /> },
      { field: 'time', headerName: '最近活动', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['lastTradeTime', 'generatedAt'])) },
    ];
  }, [segment, topic]);

  const chartRows = state.rows.slice(0, 12);
  const segmentLabel = config.segments.find((item) => item.key === segment)?.label || segment;
  if (loading) return <PageSkeleton />;

  const openEntity = (row: Record<string, unknown>) => {
    if (topic === 'transactions') navigate(`/analytics/entities/transaction/${pickValue(row, ['billId', 'id'])}?from=${topic}/${segment}`);
    else if (topic === 'cards' || (topic === 'risk' && segment === 'cards')) navigate(`/analytics/entities/card/${pickValue(row, ['cardId', 'id'])}?from=${topic}/${segment}`);
    else if (topic !== 'funds' || !['channels', 'exceptions'].includes(segment)) navigate(`/analytics/entities/account/${pickValue(row, ['userId'])}?from=${topic}/${segment}`);
  };

  return (
    <>
      <PageHeader title={`${config.title} · ${segmentLabel}`} description={config.description} breadcrumbs={[{ label: '分析中心', to: '/analytics/overview' }, { label: config.title }, { label: segmentLabel }]} action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新专题</Button>} />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <DrilldownNavigation
        steps={[{ label: '业务全景', route: '/analytics/overview' }, { label: config.title }, { label: segmentLabel }]}
        siblings={config.segments.map((item) => ({ label: item.label, route: `/analytics/topics/${topic}/${item.key}`, active: item.key === segment }))}
      />
      <AnalyticsContextBar period="当前接口快照 / 最近可用周期" scope={`${segmentLabel} · 当前加载 ${formatNumber(state.rows.length)} 条`} sample />
      <InsightSummary title="专题判断" insights={[
        { label: '样本规模', detail: `${formatNumber(state.rows.length)} 条当前记录，可继续进入实体分析`, tone: 'info' },
        { label: '金额体量', detail: `${formatAmount(metrics.amount)}，均值 ${formatAmount(metrics.average)}`, tone: 'info' },
        { label: '异常信号', detail: `${formatNumber(metrics.failures)} 条失败、${formatNumber(metrics.risky)} 条风险/冻结记录`, tone: metrics.failures + metrics.risky ? 'warning' : 'success' },
      ]} />
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="当前专题记录" value={formatNumber(state.rows.length)} helper={`接口总量 ${formatNumber(state.total)}`} icon={config.icon} /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="当前样本金额" value={formatAmount(metrics.amount)} helper="按页面可用金额字段计算" icon="solar:wallet-money-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="样本均值" value={formatAmount(metrics.average)} icon="solar:calculator-minimalistic-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="异常占比" value={formatPercent(metrics.failures + metrics.risky, state.rows.length)} helper={`${formatNumber(metrics.failures + metrics.risky)} 条信号`} icon="solar:danger-triangle-bold-duotone" tone="warning" /></Grid>
      </Grid>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={8}><ChartCard title="专题对象金额排行" subheader="当前加载样本前12项；点击下方记录继续下钻" type="bar" series={[{ name: '金额', data: chartRows.map((row) => numberValue(pickValue(row, ['amount', 'tradeAmount30d', 'totalCardBalance', 'bookRemainingAmount', 'availableBalance']))) }]} categories={chartRows.map((row) => String(pickValue(row, ['merchantName', 'userEmail', 'email', 'cardId', 'accountName', 'billId'])).slice(0, 26))} height={340} options={{ plotOptions: { bar: { horizontal: true, borderRadius: 4 } }, legend: { show: false } }} /></Grid>
        <Grid item xs={12} lg={4}><ChartCard title="正常与异常结构" subheader="基于当前加载样本" type="donut" series={[Math.max(0, state.rows.length - metrics.failures - metrics.risky), metrics.failures, metrics.risky]} height={340} options={{ labels: ['普通记录', '失败交易', '风险/冻结'], legend: { position: 'bottom' } }} /></Grid>
      </Grid>
      <DataTableCard title={`${segmentLabel}明细队列`} subheader={topic === 'funds' && ['channels', 'exceptions'].includes(segment) ? '渠道为末级快照对象；可在表内筛选和比较' : '点击记录进入实体分析页，原始查询详情仍作为下一步证据入口'} rows={state.rows} columns={columns} getRowId={(row) => String(pickValue(row, ['billId', 'cardId', 'userId', 'id', 'accountId']))} onRowClick={topic === 'funds' && ['channels', 'exceptions'].includes(segment) ? undefined : openEntity} minHeight={520} />
    </>
  );
}


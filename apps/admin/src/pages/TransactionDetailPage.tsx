import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Box, Button, Card, CardHeader, Divider, Grid, List, ListItem, ListItemIcon, ListItemText, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getTransactionDetail, getTransactions, getUserRiskWarnings } from '../../../../packages/shared/src/api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { DataTableCard } from '../components/DataTableCard';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { InfoField } from '../components/InfoField';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { formatAmount, formatDateTime, formatNumber, maskCard, numberValue, pickValue, toRows } from '../utils/format';

export function TransactionDetailPage() {
  const { billId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Record<string, unknown>>({});
  const [related, setRelated] = useState<Record<string, unknown>[]>([]);
  const [riskRows, setRiskRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tab = searchParams.get('tab') || 'overview';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const transaction = await getTransactionDetail(billId);
      setDetail(transaction);
      const cardId = String(pickValue(transaction, ['cardId'], ''));
      const userId = String(pickValue(transaction, ['userId'], ''));
      const [relatedResult, riskResult] = await Promise.all([
        cardId ? getTransactions({ cardId, page: 1, pageSize: 30 }) : Promise.resolve({ list: [] }),
        userId ? getUserRiskWarnings({ userId }) : Promise.resolve({ list: [] }),
      ]);
      setRelated(toRows(relatedResult.list));
      setRiskRows(toRows(riskResult.list));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '交易详情读取失败。');
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => { void load(); }, [load]);

  const relatedColumns = useMemo<GridColDef[]>(() => [
    { field: 'bill', headerName: '交易号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
    { field: 'merchant', headerName: '商户/说明', minWidth: 200, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail'])) },
    { field: 'type', headerName: '类型', width: 110, valueGetter: (_, row) => String(pickValue(row, ['billTypeLabel', 'billType'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['tradeStatusLabel', 'tradeStatus'])} /> },
    { field: 'amount', headerName: '金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'time', headerName: '完成时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
  ], []);

  if (loading) return <PageSkeleton />;

  const amount = formatAmount(detail.amount, String(detail.currency || 'USD'));
  const cardId = String(pickValue(detail, ['cardId'], ''));
  const userId = String(pickValue(detail, ['userId'], ''));
  const risk = riskRows[0] || {};
  const created = numberValue(detail.createTime);
  const finished = numberValue(detail.finishTime);
  const durationMinutes = created && finished ? Math.max(0, Math.round(((finished > 9_999_999_999 ? finished : finished * 1000) - (created > 9_999_999_999 ? created : created * 1000)) / 60_000)) : null;
  const failedRelated = related.filter((row) => ['2', '失败', 'failed'].includes(String(pickValue(row, ['tradeStatusLabel', 'tradeStatus'])).toLowerCase())).length;

  return (
    <>
      <PageHeader
        title={`交易 ${billId}`}
        description={`${String(pickValue(detail, ['merchantName', 'tradeDetail', 'notes'], '卡交易'))} · ${amount}`}
        breadcrumbs={[{ label: '卡交易', to: '/transactions' }, { label: billId }]}
        action={<Stack direction="row" gap={1}><Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>重新读取</Button><Button variant="contained" onClick={() => navigate(`/analytics/entities/transaction/${billId}?from=transactions/all`)} startIcon={<Icon icon="solar:chart-bold-duotone" />}>单笔分析</Button></Stack>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <AnalyticsContextBar period="单笔交易当前状态 + 同卡近期30笔" scope={`交易 ${billId}`} />
      <InsightSummary insights={[
        { label: '处理结果', detail: `${String(pickValue(detail, ['tradeStatusLabel', 'tradeStatus']))}${durationMinutes === null ? '' : `，处理耗时约 ${durationMinutes} 分钟`}`, tone: String(pickValue(detail, ['tradeStatus'])) === '2' ? 'error' : 'info' },
        { label: '同卡上下文', detail: `当前加载 ${formatNumber(related.length)} 笔关联交易，其中失败 ${formatNumber(failedRelated)} 笔`, tone: failedRelated ? 'warning' : 'success' },
        { label: '账户风险', detail: riskRows.length ? `${String(pickValue(risk, ['riskLevelLabel', 'riskLevel']))} · ${String(risk.matchedRules || '已进入预警')}` : '当前没有账户资金预警', tone: riskRows.length ? 'warning' : 'success' },
      ]} />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="交易金额" value={amount} icon="solar:wallet-money-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="处理状态" value={String(pickValue(detail, ['tradeStatusLabel', 'tradeStatus']))} helper={durationMinutes === null ? '尚无完整耗时' : `${durationMinutes} 分钟`} icon="solar:check-circle-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="同卡近期交易" value={formatNumber(related.length)} helper={`${formatNumber(failedRelated)} 笔失败`} icon="solar:bill-list-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="账户风险" value={String(pickValue(risk, ['riskLevelLabel', 'riskLevel'], '正常'))} helper={riskRows.length ? `${String(pickValue(risk, ['fundUsagePercent'], 0))}% 资金使用率` : '无预警'} icon="solar:shield-warning-bold-duotone" tone={riskRows.length ? 'warning' : 'success'} /></Grid>
      </Grid>

      <Card sx={{ mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, value) => setSearchParams({ tab: value })} variant="scrollable" scrollButtons="auto">
          <Tab value="overview" label="交易详情" />
          <Tab value="related" label={`同卡交易 ${related.length}`} />
          <Tab value="lifecycle" label="生命周期" />
          <Tab value="risk" label={`账户风险 ${riskRows.length}`} />
        </Tabs>
      </Card>

      {tab === 'related' ? (
        <DataTableCard title="同卡近期交易" subheader="点击任意交易继续切换调查对象" rows={related} columns={relatedColumns} getRowId={(row) => String(pickValue(row, ['billId', 'id']))} onRowClick={(row) => navigate(`/transactions/${pickValue(row, ['billId', 'id'])}`)} minHeight={480} />
      ) : tab === 'lifecycle' ? (
        <Card>
          <CardHeader title="交易生命周期" subheader="只展示接口能够确认的时间节点" />
          <Divider />
          <List>
            <ListItem><ListItemIcon sx={{ color: 'info.main' }}><Icon icon="solar:add-circle-bold-duotone" width={26} /></ListItemIcon><ListItemText primary="交易创建" secondary={formatDateTime(detail.createTime)} /></ListItem>
            <ListItem><ListItemIcon sx={{ color: detail.finishTime ? 'success.main' : 'warning.main' }}><Icon icon="solar:flag-2-bold-duotone" width={26} /></ListItemIcon><ListItemText primary={detail.finishTime ? '交易完成' : '等待完成'} secondary={formatDateTime(detail.finishTime)} /><StatusChip value={pickValue(detail, ['tradeStatusLabel', 'tradeStatus'])} /></ListItem>
          </List>
          <Alert severity="info" sx={{ m: 3, mt: 0 }}>授权、清算和失败重试等中间节点，线上接口未返回时不会在前端伪造。</Alert>
        </Card>
      ) : tab === 'risk' ? (
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={8}><Card><CardHeader title="关联账户资金风险" /><Divider />{riskRows.length ? <Grid container spacing={3} sx={{ p: 3 }}><Grid item xs={6}><InfoField label="风险等级" value={pickValue(risk, ['riskLevelLabel', 'riskLevel'])} /></Grid><Grid item xs={6}><InfoField label="资金使用率" value={`${String(pickValue(risk, ['fundUsagePercent'], 0))}%`} /></Grid><Grid item xs={6}><InfoField label="实际剩余" value={formatAmount(risk.actualRemainingAvailableAmount)} /></Grid><Grid item xs={6}><InfoField label="命中规则" value={risk.matchedRules} /></Grid></Grid> : <Alert severity="success" sx={{ m: 3 }}>当前没有账户资金预警。</Alert>}</Card></Grid>
          <Grid item xs={12} lg={4}><Card sx={{ p: 3, height: '100%' }}><Typography variant="h6">关联调查</Typography><Stack gap={1.2} sx={{ mt: 2 }}><Button variant="outlined" disabled={!cardId} onClick={() => navigate(`/cards/${cardId}?tab=risk`)}>查看卡片风险</Button><Button variant="outlined" disabled={!userId} onClick={() => navigate(`/customers/${userId}?tab=risk`)}>查看账户风险</Button><Button variant="outlined" onClick={() => navigate('/risk')}>返回风险分析</Button></Stack></Card></Grid>
        </Grid>
      ) : (
        <Grid container spacing={3}>
          <Grid item xs={12} lg={8}>
            <Card><CardHeader title="交易信息" action={<StatusChip value={pickValue(detail, ['tradeStatusLabel', 'tradeStatus'])} />} /><Divider /><Grid container spacing={3} sx={{ p: 3 }}>
              <Grid item xs={12} sm={6}><InfoField label="交易号" value={pickValue(detail, ['billId', 'id'], billId)} /></Grid><Grid item xs={12} sm={6}><InfoField label="卡交易ID" value={detail.cardTransactionId} /></Grid>
              <Grid item xs={12} sm={6}><InfoField label="金额" value={amount} /></Grid><Grid item xs={12} sm={6}><InfoField label="交易类型" value={pickValue(detail, ['billTypeLabel', 'billType'])} /></Grid>
              <Grid item xs={12} sm={6}><InfoField label="商户" value={detail.merchantName} /></Grid><Grid item xs={12} sm={6}><InfoField label="授权码" value={detail.tradeAuthCode} /></Grid>
              <Grid item xs={12} sm={6}><InfoField label="创建时间" value={formatDateTime(detail.createTime)} /></Grid><Grid item xs={12} sm={6}><InfoField label="完成时间" value={formatDateTime(detail.finishTime)} /></Grid>
              <Grid item xs={12}><InfoField label="交易说明" value={pickValue(detail, ['tradeDetail', 'notes'])} /></Grid>
            </Grid></Card>
          </Grid>
          <Grid item xs={12} lg={4}>
            <Card><CardHeader title="关联对象" /><Divider /><Stack spacing={2} sx={{ p: 3 }}>
              <Box><InfoField label="卡片" value={maskCard(pickValue(detail, ['cardNoMasked', 'cardNo'], cardId))} />{cardId ? <Button size="small" sx={{ mt: 1 }} onClick={() => navigate(`/cards/${cardId}`)} startIcon={<Icon icon="solar:card-search-linear" />}>查看卡片完整上下文</Button> : null}</Box>
              <Divider /><Box><InfoField label="客户账户" value={pickValue(detail, ['userEmail', 'email', 'userId'])} />{userId ? <Button size="small" sx={{ mt: 1 }} onClick={() => navigate(`/customers/${userId}`)} startIcon={<Icon icon="solar:user-id-linear" />}>查看账户组关系</Button> : null}</Box>
            </Stack></Card>
          </Grid>
        </Grid>
      )}
    </>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Button, Card, CardHeader, Divider, Grid, Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams } from 'react-router-dom';
import { getPlatformFundsReport } from '../../../../packages/shared/src/api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { DataTableCard } from '../components/DataTableCard';
import { InfoField } from '../components/InfoField';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { asRecord, formatAmount, formatDateTime, maskCard, pickValue, toRows } from '../utils/format';
import { buildRevenueModel } from '../utils/revenueAnalytics';

type State = Awaited<ReturnType<typeof getPlatformFundsReport>>;

export function RevenueEventPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setState(await getPlatformFundsReport({ pageSize: 1000 })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '收入事件读取失败。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const model = useMemo(() => state ? buildRevenueModel(asRecord(state.summary), toRows(state.users.list), { days: 3650 }) : null, [state]);
  const event = model?.events.find((item) => item.id === eventId);
  const related = model?.events.filter((item) => item.userId === event?.userId && item.id !== event?.id).sort((a, b) => b.occurredAt - a.occurredAt) || [];
  const columns = useMemo<GridColDef[]>(() => [
    { field: 'time', headerName: '发生时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.occurredAt) },
    { field: 'type', headerName: '收入项目', width: 135, valueGetter: (_, row) => String(row.revenueTypeLabel) },
    { field: 'amount', headerName: '金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'status', headerName: '状态', width: 110, valueGetter: (_, row) => String(row.statusLabel) },
    { field: 'source', headerName: '来源单号', minWidth: 220, flex: 1, valueGetter: (_, row) => String(row.sourceRef) },
  ], []);
  if (loading || !model) return <PageSkeleton />;
  if (!event) return <ErrorState message="当前快照中没有该收入事件。" onRetry={() => navigate('/revenue')} />;
  const recognized = event.status === 'recognized';
  return <>
    <PageHeader title={`${event.revenueTypeLabel} · ${event.id}`} description="收入证据页：确认收入类型、金额、状态、归属账户和原始业务来源。" breadcrumbs={[{ label: '收入分析', to: '/revenue' }, { label: '收入事件' }, { label: event.id }]} action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>重新读取</Button>} />
    {error ? <ErrorState message={error} onRetry={load} /> : null}
    <AnalyticsContextBar period="收入事件生命周期" scope={`${event.revenueTypeLabel} · ${event.granularity === 'event' ? '逐笔事件' : '账户汇总'}`} freshness={formatDateTime(model.asOf)} />
    <InsightSummary title="收入确认判断" insights={[
      { label: '是否计入收入', detail: recognized ? '已确认，计入当前收入' : event.status === 'pending' ? '待确认，不计入当前收入' : '已冲回，不计入当前收入', tone: recognized ? 'success' : 'warning' },
      { label: '收入归属', detail: String(pickValue(event, ['userEmail', 'userId'])), tone: 'info' },
      { label: '排除项目', detail: '返佣未纳入本模型', tone: 'info' },
    ]} />
    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="收入金额" value={formatAmount(event.amount, event.currency)} helper={event.revenueTypeLabel} icon="solar:wallet-money-bold-duotone" tone={recognized ? 'success' : 'warning'} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="确认状态" value={event.statusLabel} helper={recognized ? formatDateTime(event.recognizedAt) : '不进入已确认收入'} icon="solar:verified-check-bold-duotone" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="归属账户" value={event.userId || '-'} helper={event.userEmail || '-'} icon="solar:user-id-bold-duotone" tone="info" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="数据粒度" value={event.granularity === 'event' ? '逐笔' : '账户汇总'} helper={event.sourceRef} icon="solar:document-text-bold-duotone" /></Grid>
    </Grid>
    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} lg={7}><Card><CardHeader title="原始收入字段" /><Divider /><Grid container spacing={3} sx={{ p: 3 }}>
        <Grid item xs={12} sm={6}><InfoField label="收入事件ID" value={event.id} /></Grid>
        <Grid item xs={12} sm={6}><InfoField label="来源单号" value={event.sourceRef} /></Grid>
        <Grid item xs={12} sm={6}><InfoField label="发生时间" value={formatDateTime(event.occurredAt)} /></Grid>
        <Grid item xs={12} sm={6}><InfoField label="确认时间" value={formatDateTime(event.recognizedAt)} /></Grid>
        <Grid item xs={12} sm={6}><InfoField label="关联卡片" value={event.cardId ? maskCard(pickValue(event, ['cardNoMasked', 'cardId'])) : '-'} /></Grid>
        <Grid item xs={12} sm={6}><InfoField label="币种" value={event.currency} /></Grid>
      </Grid></Card></Grid>
      <Grid item xs={12} lg={5}><Card sx={{ height: '100%' }}><CardHeader title="继续核验" /><Divider /><Stack gap={1.5} sx={{ p: 3 }}>
        <Button variant="outlined" onClick={() => navigate(`/analytics/entities/account/${event.userId}?from=revenue`)}>查看归属账户分析</Button>
        {event.cardId ? <Button variant="outlined" onClick={() => navigate(`/analytics/entities/card/${event.cardId}?from=revenue`)}>查看关联卡片分析</Button> : null}
        <Alert severity="info">OTC手续费应回到 OTC 订单；开卡费应回到开卡记录。缺少来源单据时，收入证据链不完整。</Alert>
      </Stack></Card></Grid>
    </Grid>
    <DataTableCard title="同账户其他收入事件" subheader="用于核对收入集中、重复收费和状态变化" rows={related} columns={columns} getRowId={(row) => String(row.id)} onRowClick={(row) => navigate(`/revenue/events/${encodeURIComponent(String(row.id))}`)} minHeight={430} />
  </>;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Grid, TextField } from '@mui/material';
import { Icon } from '@iconify/react';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCardOtpRecords } from '../api/queries';
import { AnalyticsContextBar, InsightSummary } from '../components/AnalyticsPrimitives';
import { ChartCard } from '../components/ChartCard';
import { ErrorState } from '../components/AsyncState';
import { DataTableCard } from '../components/DataTableCard';
import { FiltersCard } from '../components/FiltersCard';
import { PageHeader } from '../components/PageHeader';
import { MetricCard } from '../components/MetricCard';
import { StatusChip } from '../components/StatusChip';
import { formatDateTime, formatNumber, maskCard, pickValue, toRows } from '../utils/format';

export function CardOtpPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cardId, setCardId] = useState(searchParams.get('cardId') || '');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getCardOtpRecords({ cardId: searchParams.get('cardId') || undefined, page: pagination.page + 1, pageSize: pagination.pageSize });
      setRows(toRows(result.list));
      setTotal(Number(result.total || 0));
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : 'OTP 活动读取失败。');
    } finally {
      setLoading(false);
    }
  }, [pagination, searchParams]);

  useEffect(() => { void load(); }, [load]);

  const columns = useMemo<GridColDef[]>(() => [
    { field: 'record', headerName: '记录ID', minWidth: 135, valueGetter: (_, row) => String(pickValue(row, ['otpRecordId', 'id'])) },
    { field: 'card', headerName: '卡片', minWidth: 210, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNo', 'cardNoMasked', 'cardId'])) },
    { field: 'customer', headerName: '所属账户', minWidth: 230, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'userId'])) },
    { field: 'bin', headerName: 'BIN', width: 110, valueGetter: (_, row) => String(pickValue(row, ['cardBin'])) },
    { field: 'otp', headerName: 'OTP', width: 135, valueGetter: (_, row) => String(pickValue(row, ['card3dsOtp'])) },
    { field: 'status', headerName: '状态', width: 115, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} /> },
    { field: 'time', headerName: '接收时间', minWidth: 185, valueGetter: (_, row) => formatDateTime(row.createTime) },
  ], []);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const label = String(pickValue(row, ['statusLabel', 'status'], '未知'));
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return counts;
  }, [rows]);

  const binCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const label = String(pickValue(row, ['cardBin'], '未知'));
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [rows]);

  return (
    <>
      <PageHeader title="OTP 活动" description="集中查看 3DS OTP 到达记录，并从卡片反查账户与交易。" />
      <Alert severity="warning" sx={{ mb: 3 }}>OTP 属于敏感运营信息：仅在当前会话读取，不缓存、不导出、不写入本地数据库。</Alert>
      <AnalyticsContextBar period="当前分页快照" scope={searchParams.get('cardId') ? `卡片 ${searchParams.get('cardId')}` : `全部记录 · 第 ${pagination.page + 1} 页`} sample />
      <InsightSummary insights={[
        { label: '记录规模', detail: `接口共 ${formatNumber(total)} 条，当前加载 ${formatNumber(rows.length)} 条`, tone: 'info' },
        { label: '主要 BIN', detail: binCounts.length ? `${binCounts[0][0]} 在当前页出现 ${binCounts[0][1]} 次` : '当前页暂无记录', tone: 'info' },
        { label: '安全边界', detail: 'OTP 只存在于当前内存会话，Demo 快照不会保存原值', tone: 'warning' },
      ]} />
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="全部 OTP 记录" value={formatNumber(total)} helper="服务端分页总数" icon="solar:lock-password-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="当前页记录" value={formatNumber(rows.length)} helper={`第 ${pagination.page + 1} 页`} icon="solar:list-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} md={6} lg={3}><ChartCard title="状态分布" subheader="当前页样本" type="donut" series={[...statusCounts.values()]} height={190} options={{ labels: [...statusCounts.keys()], legend: { position: 'bottom' } }} /></Grid>
        <Grid item xs={12} md={6} lg={3}><ChartCard title="BIN 分布" subheader="当前页前8个" type="bar" series={[{ name: 'OTP', data: binCounts.map((item) => item[1]) }]} categories={binCounts.map((item) => item[0])} height={190} options={{ legend: { show: false } }} /></Grid>
      </Grid>
      <FiltersCard>
        <TextField label="卡片ID" value={cardId} onChange={(event) => setCardId(event.target.value)} />
        <Button variant="contained" startIcon={<Icon icon="solar:magnifer-linear" />} onClick={() => setSearchParams(cardId.trim() ? { cardId: cardId.trim() } : {})}>查询 OTP</Button>
        <Button color="inherit" onClick={() => { setCardId(''); setSearchParams({}); }}>清除筛选</Button>
      </FiltersCard>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <DataTableCard
        title="OTP 到达记录"
        subheader="点击记录进入对应卡片详情"
        rows={rows}
        columns={columns}
        loading={loading}
        total={total}
        pagination={pagination}
        onPagination={setPagination}
        getRowId={(row) => String(pickValue(row, ['otpRecordId', 'id']))}
        onRowClick={(row) => navigate(`/cards/${pickValue(row, ['cardId'])}?tab=otp`)}
      />
    </>
  );
}

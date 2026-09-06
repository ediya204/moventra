import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Box, Button, Card, Chip, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getTransactions } from '../api/queries';
import { DataTableCard } from '../components/DataTableCard';
import { ErrorState } from '../components/AsyncState';
import { FiltersCard } from '../components/FiltersCard';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, maskCard, pickValue, toRows } from '../utils/format';

export function TransactionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [statistics, setStatistics] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getTransactions({
        billId: searchParams.get('keyword') || undefined,
        userEmail: searchParams.get('email') || undefined,
        userId: searchParams.get('userId') || undefined,
        cardId: searchParams.get('cardId') || undefined,
        tradeStatus: searchParams.get('status') || undefined,
        page: pagination.page + 1,
        pageSize: pagination.pageSize,
      });
      setRows(toRows(result.list));
      setTotal(Number(result.total || 0));
      setStatistics(asRecord(result.statistics));
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : '交易数据读取失败。');
    } finally {
      setLoading(false);
    }
  }, [pagination, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'billId', headerName: '交易号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'cardTransactionId', 'id'])) },
      { field: 'card', headerName: '卡片', minWidth: 200, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
      { field: 'customer', headerName: '客户', minWidth: 220, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'email', 'userId'])) },
      { field: 'merchant', headerName: '商户/说明', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail', 'notes'])) },
      { field: 'type', headerName: '类型', width: 115, valueGetter: (_, row) => String(pickValue(row, ['billTypeLabel', 'billType'])) },
      { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['tradeStatusLabel', 'tradeStatus'])} labels={{ '0': '待处理', '1': '成功', '2': '失败' }} /> },
      { field: 'amount', headerName: '金额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
      { field: 'created', headerName: '创建时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.createTime) },
      { field: 'finished', headerName: '完成时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.finishTime) },
    ],
    [],
  );

  const search = () => {
    const next = new URLSearchParams(searchParams);
    keyword.trim() ? next.set('keyword', keyword.trim()) : next.delete('keyword');
    email.trim() ? next.set('email', email.trim()) : next.delete('email');
    status ? next.set('status', status) : next.delete('status');
    setPagination((value) => ({ ...value, page: 0 }));
    setSearchParams(next);
  };

  return (
    <>
      <PageHeader title="卡交易" description="从交易反向查看所属卡片、客户账户和处理状态。" />
      <Card sx={{ mb: 3, p: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} gap={2}>
          <Box sx={{ minWidth: 140 }}><Typography variant="subtitle2">交易视图</Typography><Typography variant="caption" color="text.secondary">按处理状态快速切换</Typography></Box>
          <Stack direction="row" gap={1} flexWrap="wrap" useFlexGap>
            {[
              { label: '全部交易', value: '' },
              { label: '成功', value: '1' },
              { label: '待处理', value: '0' },
              { label: '失败', value: '2' },
            ].map((view) => (
              <Chip key={view.label} clickable color={status === view.value ? 'primary' : 'default'} variant={status === view.value ? 'filled' : 'outlined'} label={view.label} onClick={() => {
                setStatus(view.value);
                const next = new URLSearchParams(searchParams);
                view.value ? next.set('status', view.value) : next.delete('status');
                setSearchParams(next);
              }} />
            ))}
          </Stack>
          <Button sx={{ ml: { md: 'auto' } }} onClick={() => navigate('/transactions/overview')} endIcon={<Icon icon="solar:arrow-right-linear" />}>查看交易总览</Button>
        </Stack>
      </Card>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: '交易总金额', value: formatAmount(statistics.tradeAmount), tone: 'primary.main' },
          { label: '成功', value: `${formatNumber(statistics.successTradeCount)} 笔`, tone: 'success.main' },
          { label: '失败', value: `${formatNumber(statistics.failTradeCount)} 笔`, tone: 'error.main' },
          { label: '待处理', value: `${formatNumber(statistics.pendingTradeCount)} 笔`, tone: 'warning.main' },
        ].map((item) => (
          <Grid item xs={6} lg={3} key={item.label}>
            <Card sx={{ p: 2.25, boxShadow: 'none', border: 1, borderColor: 'divider' }}><Typography variant="caption" color="text.secondary">{item.label}</Typography><Typography variant="h6" sx={{ mt: 0.5, color: item.tone }}>{item.value}</Typography></Card>
          </Grid>
        ))}
      </Grid>
      <FiltersCard>
        <TextField label="交易号" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <TextField label="客户邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField select label="交易状态" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">全部状态</MenuItem>
          <MenuItem value="1">成功</MenuItem>
          <MenuItem value="0">待处理</MenuItem>
          <MenuItem value="2">失败</MenuItem>
        </TextField>
        <Button variant="contained" onClick={search} startIcon={<Icon icon="solar:magnifer-linear" />}>
          查询交易
        </Button>
        <Button color="inherit" onClick={() => { setKeyword(''); setEmail(''); setStatus(''); setSearchParams({}); }}>
          清除筛选
        </Button>
      </FiltersCard>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <DataTableCard
        title="交易流水"
        rows={rows}
        columns={columns}
        loading={loading}
        total={total}
        pagination={pagination}
        onPagination={setPagination}
        getRowId={(row) => String(pickValue(row, ['billId', 'id']))}
        onRowClick={(row) => navigate(`/transactions/${pickValue(row, ['billId', 'id'])}`)}
      />
    </>
  );
}

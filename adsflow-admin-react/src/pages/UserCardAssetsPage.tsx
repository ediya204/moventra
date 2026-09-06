import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Button, TextField } from '@mui/material';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getUserCardAssets } from '../api/queries';
import { ErrorState } from '../components/AsyncState';
import { DataTableCard } from '../components/DataTableCard';
import { FiltersCard } from '../components/FiltersCard';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { formatAmount, formatDateTime, formatNumber, pickValue, toRows } from '../utils/format';

export function UserCardAssetsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getUserCardAssets({ email: searchParams.get('email') || undefined, page: pagination.page + 1, pageSize: pagination.pageSize });
      setRows(toRows(result.list));
      setTotal(Number(result.total || 0));
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : '账户卡资产读取失败。');
    } finally {
      setLoading(false);
    }
  }, [pagination, searchParams]);

  useEffect(() => { void load(); }, [load]);

  const columns = useMemo<GridColDef[]>(() => [
    { field: 'account', headerName: '账户', minWidth: 240, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'userId'])) },
    { field: 'cards', headerName: '卡片数', width: 110, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatNumber(row.cardCount) },
    { field: 'active', headerName: '活跃卡', width: 110, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatNumber(row.activeCardCount) },
    { field: 'balance', headerName: '卡片总余额', width: 155, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.totalCardBalance) },
    { field: 'trade30d', headerName: '近30日交易', width: 155, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.tradeAmount30d) },
    { field: 'lastTrade', headerName: '最近交易', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.lastTradeTime) },
    { field: 'lastOtp', headerName: '最近 OTP', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.lastOtpTime) },
    { field: 'risk', headerName: '风险标签', width: 130, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['riskTag'], '正常')} /> },
  ], []);

  return (
    <>
      <PageHeader title="账户卡资产" description="从账户维度聚合卡片数量、余额、近30日交易与最近 OTP，适合运营巡检。" />
      <FiltersCard>
        <TextField label="客户邮箱" value={email} onChange={(event) => setEmail(event.target.value)} sx={{ minWidth: 280 }} />
        <Button variant="contained" startIcon={<Icon icon="solar:magnifer-linear" />} onClick={() => setSearchParams(email.trim() ? { email: email.trim() } : {})}>查询账户</Button>
        <Button color="inherit" onClick={() => { setEmail(''); setSearchParams({}); }}>清除筛选</Button>
      </FiltersCard>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <DataTableCard
        title="账户资产矩阵"
        subheader="点击账户进入账户组详情；卡片明细仍保持脱敏"
        rows={rows}
        columns={columns}
        loading={loading}
        total={total}
        pagination={pagination}
        onPagination={setPagination}
        getRowId={(row) => String(pickValue(row, ['userId', 'userEmail']))}
        onRowClick={(row) => navigate(`/cards/assets/${pickValue(row, ['userId'])}`)}
      />
    </>
  );
}

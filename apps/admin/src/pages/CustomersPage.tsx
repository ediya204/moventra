import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '@iconify/react';
import { Button, Chip, MenuItem, TextField } from '@mui/material';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCustomers } from '../../../../packages/shared/src/api/queries';
import { DataTableCard } from '../components/DataTableCard';
import { ErrorState } from '../../../../packages/shared/src/components/AsyncState';
import { FiltersCard } from '../components/FiltersCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, pickValue, toRows } from '../utils/format';

export function CustomersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getCustomers({
        keyword: searchParams.get('keyword') || undefined,
        email: searchParams.get('email') || undefined,
        status: searchParams.get('status') || undefined,
        main_account: 1,
        currentPage: pagination.page + 1,
        pageSize: pagination.pageSize,
      });
      setRows(toRows(result.list));
      setTotal(Number(result.total || 0));
    } catch (cause) {
      setRows([]);
      setTotal(0);
      setError(cause instanceof Error ? cause.message : '账户组数据读取失败。');
    } finally {
      setLoading(false);
    }
  }, [pagination, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'account',
        headerName: '主账户',
        minWidth: 240,
        flex: 1.2,
        valueGetter: (_, row) =>
          String(pickValue(row, ['nickname', 'nick_name', 'customerName', 'email', 'id'])),
      },
      {
        field: 'email',
        headerName: '邮箱',
        minWidth: 220,
        flex: 1,
        valueGetter: (_, row) => String(pickValue(row, ['email', 'customerEmail'])),
      },
      {
        field: 'status',
        headerName: '状态',
        width: 110,
        renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} />,
      },
      {
        field: 'subAccounts',
        headerName: '子账户',
        width: 105,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => formatNumber(pickValue(row, ['subAccountCount'], 0)),
      },
      {
        field: 'cards',
        headerName: '卡片',
        width: 95,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => formatNumber(pickValue(row, ['totalCardCount', 'cardCount'], 0)),
      },
      {
        field: 'cardBalance',
        headerName: '卡片余额',
        width: 150,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => formatAmount(pickValue(row, ['totalCardBalance', 'cardBalance'], 0)),
      },
      {
        field: 'credit',
        headerName: '授信',
        width: 95,
        renderCell: ({ row }) => (
          <Chip
            size="small"
            label={Number(pickValue(row, ['isCreditAccount'], 0)) === 1 ? '授信' : '非授信'}
            variant="outlined"
          />
        ),
      },
      {
        field: 'lastActive',
        headerName: '最近活跃',
        minWidth: 180,
        valueGetter: (_, row) => formatDateTime(pickValue(row, ['lastActiveTime'])),
      },
    ],
    [],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (keyword.trim()) next.set('keyword', keyword.trim());
    if (email.trim()) next.set('email', email.trim());
    if (status) next.set('status', status);
    setPagination((value) => ({ ...value, page: 0 }));
    setSearchParams(next);
  };

  return (
    <>
      <PageHeader
        title="客户与账户组"
        description="默认一行代表一个主账户及其子账户关系；进入详情后切换整个账户组或具体账户。"
      />
      <FiltersCard>
        <TextField label="客户名称或ID" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <TextField label="客户邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField select label="状态" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">全部状态</MenuItem>
          <MenuItem value="1">正常</MenuItem>
          <MenuItem value="3">冻结</MenuItem>
        </TextField>
        <Button component="button" type="submit" variant="contained" onClick={submit} startIcon={<Icon icon="solar:magnifer-linear" />}>
          查询账户组
        </Button>
        <Button
          color="inherit"
          onClick={() => {
            setKeyword('');
            setEmail('');
            setStatus('');
            setSearchParams({});
          }}
        >
          清除筛选
        </Button>
      </FiltersCard>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <DataTableCard
        title="账户组"
        subheader="点击一行查看主账户、子账户、卡片和资金关系"
        rows={rows}
        columns={columns}
        loading={loading}
        total={total}
        pagination={pagination}
        onPagination={setPagination}
        getRowId={(row) => String(pickValue(asRecord(row), ['id', 'userId', 'customerId']))}
        onRowClick={(row) => navigate(`/customers/${pickValue(row, ['id', 'userId', 'customerId'])}`)}
      />
    </>
  );
}

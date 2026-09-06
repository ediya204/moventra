import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Box, Button, Card, Chip, Collapse, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCardOverview, getCards } from '../api/queries';
import { DataTableCard } from '../components/DataTableCard';
import { ErrorState } from '../components/AsyncState';
import { FiltersCard } from '../components/FiltersCard';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, maskCard, pickValue, toRows } from '../utils/format';

export function CardsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [bin, setBin] = useState(searchParams.get('bin') || '');
  const [channel, setChannel] = useState(searchParams.get('channel') || '');
  const [advanced, setAdvanced] = useState(Boolean(searchParams.get('bin') || searchParams.get('channel')));
  const [overview, setOverview] = useState<Record<string, unknown>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const keywordValue = searchParams.get('keyword') || '';
      const result = await getCards({
        userId: searchParams.get('userId') || undefined,
        userEmail: searchParams.get('email') || undefined,
        cardNo: keywordValue || undefined,
        keyword: keywordValue || undefined,
        cardStatus: searchParams.get('status') || undefined,
        cardBin: searchParams.get('bin') || undefined,
        apiAccountId: searchParams.get('channel') || undefined,
        page: pagination.page + 1,
        currentPage: pagination.page + 1,
        pageSize: pagination.pageSize,
      });
      setRows(toRows(result.list));
      setTotal(Number(result.total || 0));
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : '卡片数据读取失败。');
    } finally {
      setLoading(false);
    }
  }, [pagination, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void getCardOverview().then((result) => setOverview(asRecord(result.summary))).catch(() => setOverview({}));
  }, []);

  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'cardNo',
        headerName: '卡片',
        minWidth: 210,
        flex: 1,
        valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo'])),
      },
      {
        field: 'name',
        headerName: '卡名称',
        minWidth: 150,
        valueGetter: (_, row) => String(pickValue(row, ['cardName', 'note'])),
      },
      {
        field: 'customer',
        headerName: '所属账户',
        minWidth: 220,
        flex: 1,
        valueGetter: (_, row) => String(pickValue(row, ['userEmail', 'email', 'userId'])),
      },
      {
        field: 'bin',
        headerName: 'BIN',
        width: 105,
        valueGetter: (_, row) => String(pickValue(row, ['cardBin'])),
      },
      {
        field: 'channel',
        headerName: '通道',
        width: 110,
        valueGetter: (_, row) => String(pickValue(row, ['apiAccountLabel', 'apiAccountId'])),
      },
      {
        field: 'status',
        headerName: '状态',
        width: 110,
        renderCell: ({ row }) => <StatusChip value={pickValue(row, ['cardStatusLabel', 'cardStatus'])} labels={{ '1': '已激活', '2': '已冻结', '3': '已注销', '999': '待开卡' }} />,
      },
      {
        field: 'balance',
        headerName: '可用余额',
        width: 150,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => formatAmount(pickValue(row, ['availableBalance', 'cardBalance', 'balance'], 0), String(pickValue(row, ['currency'], 'USD'))),
      },
      {
        field: 'spent',
        headerName: '累计消费',
        width: 150,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => formatAmount(pickValue(row, ['totalConsumptionAmount', 'payMoney'], 0)),
      },
      {
        field: 'created',
        headerName: '创建时间',
        minWidth: 180,
        valueGetter: (_, row) => formatDateTime(pickValue(row, ['createTime', 'createdAt'])),
      },
    ],
    [],
  );

  const search = () => {
    const next = new URLSearchParams(searchParams);
    keyword.trim() ? next.set('keyword', keyword.trim()) : next.delete('keyword');
    email.trim() ? next.set('email', email.trim()) : next.delete('email');
    status ? next.set('status', status) : next.delete('status');
    bin.trim() ? next.set('bin', bin.trim()) : next.delete('bin');
    channel.trim() ? next.set('channel', channel.trim()) : next.delete('channel');
    setPagination((value) => ({ ...value, page: 0 }));
    setSearchParams(next);
  };

  return (
    <>
      <PageHeader title="卡片" description="以卡片为核心查看所属账户、余额、交易、OTP和风险信号。" />
      <Card sx={{ mb: 3, p: 2.5 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} gap={2} alignItems={{ lg: 'center' }}>
          <Box sx={{ minWidth: 140 }}>
            <Typography variant="subtitle2">运营视图</Typography>
            <Typography variant="caption" color="text.secondary">一键进入高频工作集</Typography>
          </Box>
          <Stack direction="row" gap={1} flexWrap="wrap" useFlexGap>
            {[
              { label: `全部 ${formatNumber(overview.totalCardCount)}`, value: '' },
              { label: `活跃 ${formatNumber(overview.activeCardCount)}`, value: '1' },
              { label: `冻结 ${formatNumber(overview.freezeCardCount)}`, value: '2' },
            ].map((view) => (
              <Chip
                key={view.label}
                clickable
                color={status === view.value ? 'primary' : 'default'}
                variant={status === view.value ? 'filled' : 'outlined'}
                label={view.label}
                onClick={() => {
                  setStatus(view.value);
                  const next = new URLSearchParams(searchParams);
                  view.value ? next.set('status', view.value) : next.delete('status');
                  setSearchParams(next);
                }}
              />
            ))}
            <Chip clickable variant="outlined" icon={<Icon icon="solar:danger-triangle-linear" />} label="风险卡片" onClick={() => navigate('/risk?tab=cards')} />
            <Chip clickable variant="outlined" icon={<Icon icon="solar:lock-password-linear" />} label="OTP 活动" onClick={() => navigate('/cards/otp')} />
            <Chip clickable variant="outlined" icon={<Icon icon="solar:wallet-money-linear" />} label="账户资产" onClick={() => navigate('/cards/assets')} />
          </Stack>
          <Button sx={{ ml: { lg: 'auto' } }} onClick={() => navigate('/cards/overview')} endIcon={<Icon icon="solar:arrow-right-linear" />}>查看运营总览</Button>
        </Stack>
      </Card>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: '卡片总量', value: formatNumber(overview.totalCardCount), icon: 'solar:card-2-bold-duotone' },
          { label: '活跃率', value: Number(overview.totalCardCount) ? `${((Number(overview.activeCardCount || 0) / Number(overview.totalCardCount)) * 100).toFixed(1)}%` : '-', icon: 'solar:chart-bold-duotone' },
          { label: '卡片总余额', value: formatAmount(overview.totalCardBalance), icon: 'solar:wallet-money-bold-duotone' },
          { label: '今日交易', value: `${formatNumber(overview.todayTradeCount)} 笔`, icon: 'solar:transfer-horizontal-bold-duotone' },
        ].map((item) => (
          <Grid item xs={6} lg={3} key={item.label}>
            <Card sx={{ p: 2.25, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
              <Stack direction="row" alignItems="center" gap={1.5}>
                <Box sx={{ width: 38, height: 38, borderRadius: 1.25, display: 'grid', placeItems: 'center', bgcolor: 'primary.lighter', color: 'primary.main' }}><Icon icon={item.icon} width={22} /></Box>
                <Box><Typography variant="caption" color="text.secondary">{item.label}</Typography><Typography variant="subtitle1">{item.value}</Typography></Box>
              </Stack>
            </Card>
          </Grid>
        ))}
      </Grid>
      <FiltersCard>
        <TextField label="卡号尾号或卡片ID" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <TextField label="客户邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField select label="卡片状态" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">全部状态</MenuItem>
          <MenuItem value="1">已激活</MenuItem>
          <MenuItem value="2">已冻结</MenuItem>
          <MenuItem value="3">已注销</MenuItem>
          <MenuItem value="999">待开卡</MenuItem>
        </TextField>
        <Button variant="contained" onClick={search} startIcon={<Icon icon="solar:magnifer-linear" />}>
          查询卡片
        </Button>
        <Button
          color="inherit"
          onClick={() => {
            setKeyword('');
            setEmail('');
            setStatus('');
            setBin('');
            setChannel('');
            setSearchParams({});
          }}
        >
          清除筛选
        </Button>
        <Button color="inherit" onClick={() => setAdvanced((value) => !value)} endIcon={<Icon icon={advanced ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'} />}>
          高级筛选
        </Button>
        <Collapse in={advanced} sx={{ width: '100%' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} sx={{ pt: 1 }}>
            <TextField label="BIN 卡段" value={bin} onChange={(event) => setBin(event.target.value)} />
            <TextField label="通道账户ID" value={channel} onChange={(event) => setChannel(event.target.value)} />
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>高级条件会和上方条件组合查询。</Typography>
          </Stack>
        </Collapse>
      </FiltersCard>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <DataTableCard
        title="全部卡片"
        subheader="列表始终使用脱敏卡号；点击进入卡片运营详情"
        rows={rows}
        columns={columns}
        loading={loading}
        total={total}
        pagination={pagination}
        onPagination={setPagination}
        getRowId={(row) => String(pickValue(row, ['cardId', 'id', 'cardBusinessId']))}
        onRowClick={(row) => navigate(`/cards/${pickValue(row, ['cardId', 'id'])}`)}
      />
    </>
  );
}

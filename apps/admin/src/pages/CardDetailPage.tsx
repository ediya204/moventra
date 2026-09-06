import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardHeader,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getCardBills, getCardDetail, getCardOtps } from '../../../../packages/shared/src/api/queries';
import { DataTableCard } from '../components/DataTableCard';
import { ChartCard } from '../../../../packages/shared/src/components/ChartCard';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { InfoField } from '../components/InfoField';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, maskCard, numberValue, pickValue, toRows } from '../utils/format';

export function CardDetailPage() {
  const { cardId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Record<string, unknown>>({});
  const [bills, setBills] = useState<Record<string, unknown>[]>([]);
  const [otps, setOtps] = useState<Record<string, unknown>[]>([]);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tab = searchParams.get('tab') || 'overview';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [card, cardBills, cardOtps] = await Promise.all([
        getCardDetail(cardId),
        getCardBills(cardId, { page: 1, pageSize: 25 }),
        getCardOtps(cardId),
      ]);
      setDetail(card);
      setBills(toRows(cardBills.list));
      setOtps(toRows(cardOtps.list));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '卡片详情读取失败。');
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    setShowCardNumber(false);
    void load();
  }, [load]);

  const base = asRecord(detail.baseInfo);
  const balance = asRecord(detail.balanceInfo);
  const cardLabel = maskCard(pickValue(base, ['cardNoMasked', 'cardNo'], cardId));
  const fullCardNumber = String(pickValue(base, ['cardNo'], '')).replace(/\s/g, '');
  const canRevealCardNumber = /^\d{12,19}$/.test(fullCardNumber);

  const billColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'billId', headerName: '交易号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
      { field: 'merchant', headerName: '商户/说明', minWidth: 200, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail', 'notes'])) },
      { field: 'type', headerName: '类型', width: 120, valueGetter: (_, row) => String(pickValue(row, ['billTypeLabel', 'billType'])) },
      { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['tradeStatusLabel', 'tradeStatus'])} /> },
      { field: 'amount', headerName: '金额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
      { field: 'time', headerName: '完成时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
    ],
    [],
  );

  const otpColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'id', headerName: '记录ID', minWidth: 130, valueGetter: (_, row) => String(pickValue(row, ['otpRecordId', 'id'])) },
      { field: 'card', headerName: '卡片', minWidth: 210, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNo', 'cardNoMasked'], cardLabel)) },
      { field: 'otp', headerName: 'OTP', minWidth: 130, valueGetter: (_, row) => String(pickValue(row, ['card3dsOtp'], '-')) },
      { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} /> },
      { field: 'time', headerName: '接收时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.createTime) },
    ],
    [cardLabel],
  );

  if (loading) return <PageSkeleton />;

  const failedBills = bills.filter((row) => ['2', '失败', 'failed'].includes(String(pickValue(row, ['tradeStatusLabel', 'tradeStatus'])).toLowerCase()));
  const riskChecks = [
    {
      label: '余额健康度',
      description: numberValue(pickValue(balance, ['cardBalance', 'balance'])) < 0 ? '可用余额为负，需要结合账户资金检查' : '当前可用余额未出现负值',
      alert: numberValue(pickValue(balance, ['cardBalance', 'balance'])) < 0,
      icon: 'solar:wallet-money-bold-duotone',
    },
    {
      label: '卡片冻结状态',
      description: String(pickValue(base, ['riskFreezeStatus'], '0')) !== '0' ? '卡片存在风险冻结标记' : '未读取到风险冻结标记',
      alert: String(pickValue(base, ['riskFreezeStatus'], '0')) !== '0',
      icon: 'solar:snowflake-bold-duotone',
    },
    {
      label: '近期失败交易',
      description: failedBills.length ? `当前加载的交易中有 ${failedBills.length} 笔失败` : '当前加载范围内没有失败交易',
      alert: failedBills.length > 0,
      icon: 'solar:close-circle-bold-duotone',
    },
    {
      label: 'OTP 活动',
      description: otps.length >= 5 ? `当前读取到 ${otps.length} 条 OTP，建议关注频率` : `当前读取到 ${otps.length} 条 OTP`,
      alert: otps.length >= 5,
      icon: 'solar:lock-password-bold-duotone',
    },
  ];

  return (
    <>
      <PageHeader
        title={cardLabel}
        description={`卡片ID ${cardId} · ${String(pickValue(base, ['cardName'], '未命名卡片'))}`}
        breadcrumbs={[{ label: '卡片', to: '/cards' }, { label: cardLabel }]}
        action={<Stack direction="row" gap={1}>
          <Button variant="outlined" onClick={() => navigate(`/analytics/entities/card/${cardId}?from=cards/all`)} startIcon={<Icon icon="solar:chart-bold-duotone" />}>单卡分析</Button>
          <Tooltip title={canRevealCardNumber ? '卡号只在当前页面内存中显示，离开页面后自动隐藏。' : '当前卡片详情 API 没有返回完整卡号。'}>
            <span><Button disabled={!canRevealCardNumber} variant="contained" onClick={() => setShowCardNumber((value) => !value)} startIcon={<Icon icon={showCardNumber ? 'solar:eye-closed-bold' : 'solar:eye-bold'} />}>{showCardNumber ? '隐藏卡号' : '查看完整卡号'}</Button></span>
          </Tooltip>
        </Stack>}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      <Alert severity="success" sx={{ mb: 3 }}>
        卡号默认遮罩；仅当详情 API 返回完整卡号时允许当前会话临时查看，不写入浏览器存储或本地数据库。
      </Alert>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="可用余额" value={formatAmount(pickValue(balance, ['cardBalance', 'balance'], 0), String(pickValue(base, ['currency'], 'USD')))} icon="solar:wallet-money-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="累计充值" value={formatAmount(balance.inMoney)} icon="solar:card-recive-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="累计消费" value={formatAmount(balance.payMoney)} icon="solar:cart-large-2-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="累计退款" value={formatAmount(balance.refundMoney)} icon="solar:restart-bold-duotone" tone="warning" /></Grid>
      </Grid>

      <Card sx={{ mb: 3 }}>
        <CardHeader
          title="卡片关系"
          action={<StatusChip value={pickValue(base, ['cardStatusLabel', 'cardStatus'])} labels={{ '1': '已激活', '2': '已冻结', '3': '已注销', '999': '待开卡' }} />}
        />
        <Divider />
        <Grid container spacing={3} sx={{ p: 3 }}>
          <Grid item xs={12} sm={6} md={3}><InfoField label={showCardNumber ? '完整卡号' : '脱敏卡号'} value={showCardNumber ? fullCardNumber : cardLabel} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="卡片ID" value={cardId} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="BIN" value={base.cardBin} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="币种" value={base.currency} /></Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box onClick={() => navigate(`/customers/${base.userId}`)} sx={{ cursor: base.userId ? 'pointer' : 'default' }}>
              <InfoField label="所属账户" value={pickValue(base, ['userEmail', 'userId'])} />
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="通道账户" value={base.apiAccountId} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="风险冻结状态" value={base.riskFreezeStatus} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="创建时间" value={formatDateTime(base.createTime)} /></Grid>
        </Grid>
      </Card>

      <Card sx={{ mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, value) => setSearchParams({ tab: value })} variant="scrollable" scrollButtons="auto">
          <Tab value="overview" label="概览" />
          <Tab value="transactions" label={`交易 ${bills.length}`} />
          <Tab value="funds" label="资金" />
          <Tab value="otp" label={`OTP ${otps.length}`} />
          <Tab value="risk" label="风险" />
          <Tab value="history" label="处理历史" />
        </Tabs>
      </Card>

      {tab === 'transactions' ? (
        <DataTableCard
          title="卡交易"
          rows={bills}
          columns={billColumns}
          getRowId={(row) => String(pickValue(row, ['billId', 'id']))}
          onRowClick={(row) => navigate(`/transactions/${pickValue(row, ['billId', 'id'])}`)}
          minHeight={420}
        />
      ) : tab === 'otp' ? (
        <DataTableCard
          title="OTP记录"
          subheader="OTP属于敏感运营信息，仅在当前会话中展示"
          rows={otps}
          columns={otpColumns}
          getRowId={(row) => String(pickValue(row, ['otpRecordId', 'id']))}
          minHeight={420}
        />
      ) : tab === 'funds' ? (
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={7}>
            <ChartCard
              title="资金构成"
              subheader="基于卡片详情接口返回的累计值，不在本地重算账本"
              type="bar"
              series={[{ name: '金额', data: [balance.inMoney, balance.payMoney, balance.refundMoney, balance.tradeFee].map(numberValue) }]}
              categories={['累计充值', '累计消费', '累计退款', '交易手续费']}
              height={330}
              options={{ legend: { show: false } }}
            />
          </Grid>
          <Grid item xs={12} lg={5}>
            <Card sx={{ height: '100%' }}>
              <CardHeader title="余额核对" subheader="只读接口口径" />
              <Divider />
              <Grid container spacing={2.5} sx={{ p: 3 }}>
                <Grid item xs={6}><InfoField label="可用余额" value={formatAmount(pickValue(balance, ['cardBalance', 'balance']))} /></Grid>
                <Grid item xs={6}><InfoField label="累计转出" value={formatAmount(balance.outMoney)} /></Grid>
                <Grid item xs={6}><InfoField label="交易手续费" value={formatAmount(balance.tradeFee)} /></Grid>
                <Grid item xs={6}><InfoField label="币种" value={pickValue(base, ['currency'], 'USD')} /></Grid>
              </Grid>
              <Alert severity="info" sx={{ m: 2.5, mt: 0 }}>这里是运营观察值，不替代后端账本与清结算结果。</Alert>
            </Card>
          </Grid>
        </Grid>
      ) : tab === 'risk' ? (
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardHeader title="风险信号检查" subheader="把余额、冻结、失败交易和 OTP 合并到一个调查面板" />
              <Divider />
              <List disablePadding>
                {riskChecks.map((check) => (
                  <ListItem key={check.label} divider sx={{ py: 2, px: 3 }}>
                    <ListItemIcon sx={{ minWidth: 44, color: check.alert ? 'warning.main' : 'success.main' }}><Icon icon={check.icon} width={25} /></ListItemIcon>
                    <ListItemText primary={check.label} secondary={check.description} primaryTypographyProps={{ fontWeight: 700 }} />
                    <Chip size="small" label={check.alert ? '需关注' : '正常'} color={check.alert ? 'warning' : 'success'} variant="outlined" />
                  </ListItem>
                ))}
              </List>
            </Card>
          </Grid>
          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3, height: '100%' }}>
              <Typography variant="h6">调查路径</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>风险结论需要结合账户组与交易上下文。</Typography>
              <Stack gap={1.2}>
                <Button variant="outlined" fullWidth onClick={() => navigate(`/transactions?cardId=${cardId}`)} startIcon={<Icon icon="solar:bill-list-linear" />}>查看全部关联交易</Button>
                <Button variant="outlined" fullWidth disabled={!base.userId} onClick={() => navigate(`/customers/${base.userId}?tab=risk`)} startIcon={<Icon icon="solar:users-group-rounded-linear" />}>查看所属账户组</Button>
                <Button variant="outlined" fullWidth onClick={() => navigate(`/risk?tab=cards`)} startIcon={<Icon icon="solar:shield-warning-linear" />}>返回风险队列</Button>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      ) : tab === 'history' ? (
        <Card>
          <CardHeader title="生命周期时间线" subheader="当前接口可确认的卡片节点；写操作历史仍以服务端审计记录为准" />
          <Divider />
          <List sx={{ p: 2 }}>
            <ListItem>
              <ListItemIcon sx={{ color: 'primary.main' }}><Icon icon="solar:add-circle-bold-duotone" width={26} /></ListItemIcon>
              <ListItemText primary="卡片创建" secondary={formatDateTime(base.createTime)} />
            </ListItem>
            <ListItem>
              <ListItemIcon sx={{ color: 'info.main' }}><Icon icon="solar:card-2-bold-duotone" width={26} /></ListItemIcon>
              <ListItemText primary="当前卡片状态" secondary={String(pickValue(base, ['cardStatusLabel', 'cardStatus']))} />
            </ListItem>
            <ListItem>
              <ListItemIcon sx={{ color: 'warning.main' }}><Icon icon="solar:shield-warning-bold-duotone" width={26} /></ListItemIcon>
              <ListItemText primary="风险冻结标记" secondary={String(pickValue(base, ['riskFreezeStatus'], '无'))} />
            </ListItem>
          </List>
          <Alert severity="info" sx={{ m: 3, mt: 0 }}>目前单卡详情接口没有返回完整审计事件，页面不会伪造处理人或操作时间。</Alert>
        </Card>
      ) : (
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={7}>
            <Card>
              <CardHeader title="近期活动" subheader="最近交易与 OTP 组合时间线" />
              <Divider />
              <List disablePadding>
                {bills.slice(0, 5).map((row, index) => (
                  <ListItem key={`bill-${index}`} divider button onClick={() => navigate(`/transactions/${pickValue(row, ['billId', 'id'])}`)} sx={{ px: 3, py: 1.6 }}>
                    <ListItemIcon sx={{ color: 'info.main' }}><Icon icon="solar:transfer-horizontal-bold-duotone" width={24} /></ListItemIcon>
                    <ListItemText primary={String(pickValue(row, ['merchantName', 'tradeDetail', 'billId']))} secondary={formatDateTime(pickValue(row, ['finishTime', 'createTime']))} />
                    <Typography variant="subtitle2">{formatAmount(row.amount, String(row.currency || 'USD'))}</Typography>
                  </ListItem>
                ))}
                {otps.slice(0, 3).map((row, index) => (
                  <ListItem key={`otp-${index}`} divider sx={{ px: 3, py: 1.6 }}>
                    <ListItemIcon sx={{ color: 'warning.main' }}><Icon icon="solar:lock-password-bold-duotone" width={24} /></ListItemIcon>
                    <ListItemText primary="收到 3DS OTP" secondary={formatDateTime(row.createTime)} />
                    <StatusChip value={pickValue(row, ['statusLabel', 'status'])} />
                  </ListItem>
                ))}
                {!bills.length && !otps.length ? <ListItem><ListItemText primary="暂无近期活动" secondary="接口当前未返回交易或 OTP 记录" /></ListItem> : null}
              </List>
            </Card>
          </Grid>
          <Grid item xs={12} lg={5}>
            <Card sx={{ height: '100%' }}>
              <CardHeader title="关联对象" subheader="从单卡继续追溯账户、交易和风险" />
              <Divider />
              <Stack sx={{ p: 3 }} gap={1.4}>
                <Button variant="outlined" sx={{ justifyContent: 'flex-start' }} onClick={() => navigate(`/customers/${base.userId}`)} disabled={!base.userId} startIcon={<Icon icon="solar:user-id-bold-duotone" />}>{String(pickValue(base, ['userEmail', 'userId'], '未知账户'))}</Button>
                <Button variant="outlined" sx={{ justifyContent: 'flex-start' }} onClick={() => setSearchParams({ tab: 'transactions' })} startIcon={<Icon icon="solar:bill-list-bold-duotone" />}>{bills.length} 条近期卡交易</Button>
                <Button variant="outlined" sx={{ justifyContent: 'flex-start' }} onClick={() => setSearchParams({ tab: 'otp' })} startIcon={<Icon icon="solar:lock-password-bold-duotone" />}>{otps.length} 条 OTP 记录</Button>
                <Button variant="outlined" sx={{ justifyContent: 'flex-start' }} onClick={() => setSearchParams({ tab: 'risk' })} startIcon={<Icon icon="solar:shield-warning-bold-duotone" />}>查看风险信号</Button>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      )}
    </>
  );
}

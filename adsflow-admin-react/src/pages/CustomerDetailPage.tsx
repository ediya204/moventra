import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Button, Card, CardHeader, Divider, Grid, MenuItem, Select, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getCards,
  getCustomerCreditRecords,
  getCustomerDetail,
  getCustomerDigitalRecords,
  getCustomerFundFlows,
  getCustomerOtcRecords,
  getSubAccountDetail,
  getSubAccounts,
  getSubAccountTransfers,
  getTransactions,
  getUserRiskWarnings,
} from '../api/queries';
import { AnalyticsContextBar, InsightSummary, SectionHeading } from '../components/AnalyticsPrimitives';
import { DataTableCard } from '../components/DataTableCard';
import { ErrorState, PageSkeleton } from '../components/AsyncState';
import { InfoField } from '../components/InfoField';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, formatPercent, maskCard, pickValue, toRows } from '../utils/format';

type ScopedData = {
  detail: Record<string, unknown>;
  cards: Record<string, unknown>[];
  cardsTotal: number;
  transactions: Record<string, unknown>[];
  transactionsTotal: number;
  fundFlows: Record<string, unknown>[];
  digital: Record<string, unknown>[];
  otc: Record<string, unknown>[];
  credit: Record<string, unknown>[];
  risk: Record<string, unknown>[];
};

const emptyScoped: ScopedData = {
  detail: {}, cards: [], cardsTotal: 0, transactions: [], transactionsTotal: 0,
  fundFlows: [], digital: [], otc: [], credit: [], risk: [],
};

export function CustomerDetailPage() {
  const { customerId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mainDetail, setMainDetail] = useState<Record<string, unknown>>({});
  const [subAccounts, setSubAccounts] = useState<Record<string, unknown>[]>([]);
  const [scoped, setScoped] = useState<ScopedData>(emptyScoped);
  const [loading, setLoading] = useState(true);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [error, setError] = useState('');
  const tab = searchParams.get('tab') || 'overview';
  const scope = searchParams.get('account') || 'group';
  const selectedUserId = scope === 'group' ? customerId : scope;
  const isSubAccount = scope !== 'group' && scope !== customerId;

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    value ? next.set(key, value) : next.delete(key);
    setSearchParams(next);
  };

  const loadIdentity = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [customer, children] = await Promise.all([getCustomerDetail(customerId), getSubAccounts(customerId)]);
      setMainDetail(customer);
      setSubAccounts(toRows(children.list));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户关系读取失败。');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  const loadScope = useCallback(async () => {
    if (!selectedUserId) return;
    setScopeLoading(true);
    setError('');
    try {
      const common = { userId: selectedUserId, currentPage: 1, pageSize: 50 };
      const [accountDetail, cards, transactions, risk, funds, digital, otc, credit] = await Promise.all([
        isSubAccount ? getSubAccountDetail(selectedUserId) : Promise.resolve(mainDetail),
        getCards({ userId: selectedUserId, page: 1, currentPage: 1, pageSize: 50 }),
        getTransactions({ userId: selectedUserId, page: 1, pageSize: 50 }),
        getUserRiskWarnings({ userId: selectedUserId }),
        isSubAccount ? getSubAccountTransfers(common) : getCustomerFundFlows(common),
        isSubAccount ? Promise.resolve({ list: [] }) : getCustomerDigitalRecords(common),
        isSubAccount ? Promise.resolve({ list: [] }) : getCustomerOtcRecords(common),
        isSubAccount ? Promise.resolve({ list: [] }) : getCustomerCreditRecords(common),
      ]);
      setScoped({
        detail: accountDetail,
        cards: toRows(cards.list), cardsTotal: Number(cards.total || 0),
        transactions: toRows(transactions.list), transactionsTotal: Number(transactions.total || 0),
        fundFlows: toRows(funds.list), digital: toRows(digital.list), otc: toRows(otc.list),
        credit: toRows(credit.list), risk: toRows(risk.list),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户业务数据读取失败。');
    } finally {
      setScopeLoading(false);
    }
  }, [isSubAccount, mainDetail, selectedUserId]);

  useEffect(() => { void loadIdentity(); }, [loadIdentity]);
  useEffect(() => { if (!loading) void loadScope(); }, [loadScope, loading]);

  const relationshipColumns = useMemo<GridColDef[]>(() => [
    { field: 'name', headerName: '子账户', minWidth: 210, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['nickname', 'nick_name', 'subAccountName', 'email', 'id'])) },
    { field: 'email', headerName: '邮箱', minWidth: 220, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['email', 'subAccountEmail'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} /> },
    { field: 'cards', headerName: '卡片', width: 100, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatNumber(pickValue(row, ['totalCardCount', 'cardCount'], 0)) },
    { field: 'balance', headerName: '卡片余额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['totalCardBalance', 'cardTotalBalance'], 0)) },
    { field: 'activity', headerName: '最近活跃', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['lastActiveTime', 'lastActionTime'])) },
  ], []);

  const cardColumns = useMemo<GridColDef[]>(() => [
    { field: 'card', headerName: '卡片', minWidth: 210, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
    { field: 'name', headerName: '名称', minWidth: 150, valueGetter: (_, row) => String(pickValue(row, ['cardName', 'note'])) },
    { field: 'bin', headerName: 'BIN', width: 105, valueGetter: (_, row) => String(pickValue(row, ['cardBin'])) },
    { field: 'channel', headerName: '通道', width: 130, valueGetter: (_, row) => String(pickValue(row, ['apiAccountLabel', 'apiAccountId'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['cardStatusLabel', 'cardStatus'])} /> },
    { field: 'balance', headerName: '可用余额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['availableBalance', 'cardBalance'], 0)) },
    { field: 'created', headerName: '创建时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(row.createTime) },
  ], []);

  const transactionColumns = useMemo<GridColDef[]>(() => [
    { field: 'bill', headerName: '交易号', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
    { field: 'card', headerName: '卡片', minWidth: 190, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
    { field: 'merchant', headerName: '商户/说明', minWidth: 190, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail', 'notes'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['tradeStatusLabel', 'tradeStatus'])} /> },
    { field: 'amount', headerName: '金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'time', headerName: '完成时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
  ], []);

  const fundsColumns = useMemo<GridColDef[]>(() => [
    { field: 'id', headerName: '记录', minWidth: 150, valueGetter: (_, row) => String(pickValue(row, ['billNo', 'id'])) },
    { field: 'type', headerName: '类型', minWidth: 150, valueGetter: (_, row) => String(pickValue(row, ['typeLabel', 'operationLabel', 'recordTitle', 'type'])) },
    { field: 'amount', headerName: '金额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'relationship', headerName: '资金关系', minWidth: 220, flex: 1, valueGetter: (_, row) => `${String(pickValue(row, ['fromAccountName'], '-'))} → ${String(pickValue(row, ['toAccountName'], '-'))}` },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'], '已记录')} /> },
    { field: 'remark', headerName: '备注', minWidth: 180, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['remark', 'notes'])) },
    { field: 'time', headerName: '时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['createTimeText', 'createTime', 'createdAtFormatted', 'createdAt'])) },
  ], []);

  const digitalColumns = useMemo<GridColDef[]>(() => [
    { field: 'trade', headerName: '交易号', minWidth: 180, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['tradeId', 'id'])) },
    { field: 'type', headerName: '类型', width: 120, valueGetter: (_, row) => String(pickValue(row, ['typeLabel', 'eventType'])) },
    { field: 'asset', headerName: '资产/网络', minWidth: 150, valueGetter: (_, row) => `${String(pickValue(row, ['coinKey'], '-'))} · ${String(pickValue(row, ['network'], '-'))}` },
    { field: 'amount', headerName: '数量', width: 140, align: 'right', headerAlign: 'right', valueGetter: (_, row) => String(pickValue(row, ['amount'], 0)) },
    { field: 'address', headerName: '地址', minWidth: 230, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['address'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} /> },
    { field: 'time', headerName: '时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['tradeTimeText', 'tradeTime'])) },
  ], []);

  const otcColumns = useMemo<GridColDef[]>(() => [
    { field: 'trade', headerName: '交易号', minWidth: 180, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['tradeId', 'id'])) },
    { field: 'source', headerName: '卖出', minWidth: 150, valueGetter: (_, row) => `${String(pickValue(row, ['sourceAmount'], 0))} ${String(pickValue(row, ['sourceCoin'], '-'))}` },
    { field: 'destination', headerName: '买入', minWidth: 150, valueGetter: (_, row) => `${String(pickValue(row, ['destinationAmount'], 0))} ${String(pickValue(row, ['destinationCoin'], '-'))}` },
    { field: 'fee', headerName: '费用', width: 130, align: 'right', headerAlign: 'right', valueGetter: (_, row) => String(pickValue(row, ['fee'], 0)) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} /> },
    { field: 'time', headerName: '时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['tradeTimeText', 'tradeTime'])) },
  ], []);

  const creditColumns = useMemo<GridColDef[]>(() => [
    { field: 'id', headerName: '记录ID', minWidth: 130, valueGetter: (_, row) => String(pickValue(row, ['id'])) },
    { field: 'type', headerName: '类型', minWidth: 140, valueGetter: (_, row) => String(pickValue(row, ['typeLabel', 'type'])) },
    { field: 'amount', headerName: '金额', width: 150, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount) },
    { field: 'amountType', headerName: '金额类型', width: 130, valueGetter: (_, row) => String(pickValue(row, ['amountTypeLabel', 'amountType'])) },
    { field: 'reference', headerName: '关联编号', minWidth: 180, valueGetter: (_, row) => String(pickValue(row, ['referenceNo'])) },
    { field: 'status', headerName: '状态', width: 110, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['statusLabel', 'status'])} /> },
    { field: 'remark', headerName: '备注', minWidth: 180, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['remark'])) },
    { field: 'time', headerName: '时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['createdAtText', 'createdAt'])) },
  ], []);

  if (loading) return <PageSkeleton />;

  const mainBase = asRecord(mainDetail.baseInfo);
  const currentBase = asRecord(scoped.detail.baseInfo);
  const metrics = asRecord(scoped.detail.metrics);
  const displayedBase = Object.keys(currentBase).length ? currentBase : mainBase;
  const customerName = String(pickValue(mainBase, ['customerName', 'email'], `账户组 ${customerId}`));
  const scopeName = scope === 'group' ? '整个账户组（主账户聚合口径）' : String(pickValue(displayedBase, ['customerName', 'subAccountName', 'email'], selectedUserId));
  const failedTrades = scoped.transactions.filter((row) => ['2', '失败', 'failed'].includes(String(pickValue(row, ['tradeStatusLabel', 'tradeStatus'])).toLowerCase())).length;
  const activeCards = scoped.cards.filter((row) => ['1', '激活', '已激活', 'active'].includes(String(pickValue(row, ['cardStatusLabel', 'cardStatus'])).toLowerCase())).length;
  const risk = scoped.risk[0] || {};

  return (
    <>
      <PageHeader
        title={customerName}
        description="在账户组内切换主账户和子账户，并继续下钻卡片、交易、资金与风险。"
        breadcrumbs={[{ label: '账户组目录', to: '/customers' }, { label: customerName }]}
        action={
          <Select size="small" value={scope} onChange={(event) => updateParam('account', String(event.target.value))} aria-label="数据范围" sx={{ minWidth: 260, bgcolor: 'background.paper' }}>
            <MenuItem value="group">整个账户组 · 聚合口径</MenuItem>
            <MenuItem value={customerId}>主账户 · {customerName}</MenuItem>
            {subAccounts.map((account) => {
              const id = String(pickValue(account, ['id', 'userId', 'subAccountId']));
              return <MenuItem key={id} value={id}>子账户 · {String(pickValue(account, ['nickname', 'nick_name', 'email'], id))}</MenuItem>;
            })}
          </Select>
        }
      />
      {error ? <ErrorState message={error} onRetry={() => { void loadIdentity(); void loadScope(); }} /> : null}
      <AnalyticsContextBar period="资产当前值 · 业务明细前50条" scope={scopeName} sample />
      <InsightSummary insights={[
        { label: '卡片使用', detail: `${formatNumber(activeCards)} / ${formatNumber(scoped.cards.length)} 张当前加载卡片处于活跃状态`, tone: 'info' },
        { label: '交易质量', detail: `当前加载 ${formatNumber(scoped.transactions.length)} 笔交易，其中失败 ${formatNumber(failedTrades)} 笔`, tone: failedTrades ? 'warning' : 'success' },
        { label: '资金风险', detail: scoped.risk.length ? `资金使用率 ${String(pickValue(risk, ['fundUsagePercent'], 0))}%，风险等级 ${String(pickValue(risk, ['riskLevelLabel', 'riskLevel']))}` : '当前风险接口未返回该账户预警', tone: scoped.risk.length ? 'warning' : 'info' },
      ]} />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="法币可用余额" value={formatAmount(metrics.fiatAvailableBalance)} icon="solar:wallet-money-bold-duotone" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="卡片" value={formatNumber(metrics.cardCount || scoped.cardsTotal)} helper={`当前加载活跃率 ${formatPercent(activeCards, scoped.cards.length)}`} icon="solar:card-2-bold-duotone" tone="success" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="卡片余额" value={formatAmount(pickValue(metrics, ['cardAvailableBalance', 'cardTotalBalance'], 0))} icon="solar:card-send-bold-duotone" tone="info" /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="子账户" value={formatNumber(metrics.subAccountCount || subAccounts.length)} helper={isSubAccount ? '当前为子账户' : '账户组关系'} icon="solar:users-group-rounded-bold-duotone" tone="secondary" /></Grid>
      </Grid>

      <Card sx={{ mb: 3 }}>
        <CardHeader title="当前账户身份" action={<StatusChip value={pickValue(displayedBase, ['statusLabel', 'status'])} />} />
        <Divider />
        <Grid container spacing={3} sx={{ p: 3 }}>
          <Grid item xs={12} sm={6} md={3}><InfoField label="账户ID" value={pickValue(displayedBase, ['userId'], selectedUserId)} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="邮箱" value={displayedBase.email} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="账户角色" value={isSubAccount ? '子账户' : '主账户'} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="主账户" value={isSubAccount ? pickValue(displayedBase, ['mainAccountEmail', 'mainAccountId'], customerId) : customerName} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="账户类型" value={displayedBase.isCreditAccount ? '授信账户' : '普通账户'} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="注册时间" value={formatDateTime(displayedBase.registerTime)} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="最近活跃" value={formatDateTime(displayedBase.lastActiveTime)} /></Grid>
          <Grid item xs={12} sm={6} md={3}><InfoField label="OTC费率" value={metrics.otcFeeConfig} /></Grid>
        </Grid>
      </Card>

      <Card sx={{ mb: 3, boxShadow: 'none', border: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, value) => updateParam('tab', value)} variant="scrollable" scrollButtons="auto">
          <Tab value="overview" label={`账户关系 ${subAccounts.length}`} />
          <Tab value="cards" label={`卡片 ${scoped.cardsTotal}`} />
          <Tab value="transactions" label={`交易 ${scoped.transactionsTotal}`} />
          <Tab value="funds" label="资金流水" />
          <Tab value="digital" label="数字资产" disabled={isSubAccount} />
          <Tab value="otc" label="OTC" disabled={isSubAccount} />
          <Tab value="credit" label="授信记录" disabled={isSubAccount} />
          <Tab value="risk" label={`风险 ${scoped.risk.length}`} />
        </Tabs>
      </Card>

      {scopeLoading ? <PageSkeleton /> : tab === 'overview' ? (
        <DataTableCard title="主账户 → 子账户关系" subheader="点击子账户后，页面内所有业务标签会同步切换到该账户" rows={subAccounts} columns={relationshipColumns} getRowId={(row) => String(pickValue(row, ['id', 'userId', 'subAccountId']))} onRowClick={(row) => updateParam('account', String(pickValue(row, ['id', 'userId', 'subAccountId'])))} minHeight={410} />
      ) : tab === 'cards' ? (
        <><SectionHeading title="账户卡片" description="点击卡片进入分析语境；原始卡片字段在更下一级按需查看。" action={<Button onClick={() => navigate(`/analytics/entities/account/${selectedUserId}?from=accounts/all`)}>账户整体分析</Button>} /><DataTableCard title="当前加载卡片" rows={scoped.cards} columns={cardColumns} getRowId={(row) => String(pickValue(row, ['cardId', 'id']))} onRowClick={(row) => navigate(`/analytics/entities/card/${pickValue(row, ['cardId', 'id'])}?from=accounts/all`)} minHeight={460} /></>
      ) : tab === 'transactions' ? (
        <><SectionHeading title="账户交易" description="点击交易进入单笔、同卡、账户风险的连续分析。" action={<Button onClick={() => navigate(`/analytics/topics/transactions/all`)}>交易专题</Button>} /><DataTableCard title="当前加载交易" rows={scoped.transactions} columns={transactionColumns} getRowId={(row) => String(pickValue(row, ['billId', 'id']))} onRowClick={(row) => navigate(`/analytics/entities/transaction/${pickValue(row, ['billId', 'id'])}?from=accounts/all`)} minHeight={460} /></>
      ) : tab === 'funds' ? (
        <DataTableCard title={isSubAccount ? '子账户资金关系流水' : '主账户资金流水'} subheader={isSubAccount ? '展示主子账户之间的后台资金关系记录' : '展示入金、出金及资金变动记录'} rows={scoped.fundFlows} columns={fundsColumns} getRowId={(row) => String(pickValue(row, ['billNo', 'id']))} minHeight={470} />
      ) : tab === 'digital' ? (
        <DataTableCard title="数字资产充值与提现" rows={scoped.digital} columns={digitalColumns} getRowId={(row) => String(pickValue(row, ['tradeId', 'id']))} minHeight={470} />
      ) : tab === 'otc' ? (
        <DataTableCard title="OTC 兑换记录" rows={scoped.otc} columns={otcColumns} getRowId={(row) => String(pickValue(row, ['tradeId', 'id']))} minHeight={470} />
      ) : tab === 'credit' ? (
        <DataTableCard title="授信变动与审批记录" rows={scoped.credit} columns={creditColumns} getRowId={(row) => String(pickValue(row, ['id', 'referenceNo']))} minHeight={470} />
      ) : (
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={8}>
            <Card><CardHeader title="账户资金风险" subheader="来自资金预警接口的当前账户结果" /><Divider />
              {scoped.risk.length ? <Grid container spacing={3} sx={{ p: 3 }}>
                <Grid item xs={12} sm={6}><InfoField label="风险等级" value={pickValue(risk, ['riskLevelLabel', 'riskLevel'])} /></Grid>
                <Grid item xs={12} sm={6}><InfoField label="资金使用率" value={`${String(pickValue(risk, ['fundUsagePercent'], 0))}%`} /></Grid>
                <Grid item xs={12} sm={6}><InfoField label="实际剩余" value={formatAmount(risk.actualRemainingAvailableAmount)} /></Grid>
                <Grid item xs={12} sm={6}><InfoField label="自有资金" value={formatAmount(risk.ownFundsTotalAmount)} /></Grid>
                <Grid item xs={12} sm={6}><InfoField label="真实授信缺口" value={formatAmount(risk.realCreditGapAmount)} /></Grid>
                <Grid item xs={12} sm={6}><InfoField label="命中规则" value={risk.matchedRules} /></Grid>
              </Grid> : <Alert severity="success" sx={{ m: 3 }}>当前风险接口未返回该账户预警记录。</Alert>}
            </Card>
          </Grid>
          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3, height: '100%' }}><Typography variant="h6">继续调查</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>结合资金、卡片和失败交易完成风险判断。</Typography><Stack gap={1.2}>
              <Button variant="outlined" startIcon={<Icon icon="solar:wallet-money-linear" />} onClick={() => updateParam('tab', 'funds')}>查看资金流水</Button>
              <Button variant="outlined" startIcon={<Icon icon="solar:card-2-linear" />} onClick={() => updateParam('tab', 'cards')}>查看账户卡片</Button>
              <Button variant="outlined" startIcon={<Icon icon="solar:close-circle-linear" />} onClick={() => navigate(`/transactions?userId=${selectedUserId}&status=2`)}>查看失败交易</Button>
              <Button variant="outlined" onClick={() => navigate('/risk')}>返回风险分析</Button>
            </Stack></Card>
          </Grid>
        </Grid>
      )}
    </>
  );
}

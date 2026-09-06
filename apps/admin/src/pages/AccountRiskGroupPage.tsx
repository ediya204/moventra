import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { Alert, Box, Button, Card, CardHeader, Chip, Divider, Grid, Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getCards, getCustomerDetail, getSubAccounts, getTransactions, getUserRiskWarnings } from '../../../../packages/shared/src/api/queries';
import { AnalyticsContextBar, InsightSummary, SectionHeading } from '../components/AnalyticsPrimitives';
import { ErrorState, PageSkeleton } from '../../../../packages/shared/src/components/AsyncState';
import { ChartCard } from '../../../../packages/shared/src/components/ChartCard';
import { DataTableCard } from '../components/DataTableCard';
import { MetricCard } from '../../../../packages/shared/src/components/MetricCard';
import { PageHeader } from '../../../../packages/shared/src/components/PageHeader';
import { StatusChip } from '../components/StatusChip';
import { asRecord, formatAmount, formatDateTime, formatNumber, formatPercent, maskCard, numberValue, pickValue, toRows } from '../utils/format';
import { buildOperationalRiskProfile, failedTransactions, RISK_THRESHOLDS, type OperationalRiskProfile } from '../utils/riskSignals';

type MemberRisk = {
  id: string;
  role: '主账户' | '子账户';
  base: Record<string, unknown>;
  cards: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  transactionsTotal: number;
  risk: Record<string, unknown>;
  profile: OperationalRiskProfile;
};

type CardRiskRow = Record<string, unknown> & { profile: OperationalRiskProfile; transactions: Record<string, unknown>[] };

export function AccountRiskGroupPage() {
  const { mainAccountId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState<MemberRisk[]>([]);
  const [mainBase, setMainBase] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selectedId = searchParams.get('account') || mainAccountId;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [mainDetail, subResult] = await Promise.all([getCustomerDetail(mainAccountId), getSubAccounts(mainAccountId)]);
      const main = asRecord(mainDetail.baseInfo);
      const subRows = toRows(subResult.list);
      const identities = [{ ...main, userId: mainAccountId, accountRole: '主账户' }, ...subRows.map((row) => ({ ...row, accountRole: '子账户' }))];
      const results = await Promise.all(identities.map(async (identity) => {
        const id = String(pickValue(identity, ['userId', 'id', 'subAccountId']));
        const [cardResult, transactionResult, riskResult] = await Promise.all([
          getCards({ userId: id, page: 1, pageSize: 100 }),
          getTransactions({ userId: id, page: 1, pageSize: 100 }),
          getUserRiskWarnings({ userId: id, pageSize: 20 }),
        ]);
        const transactions = toRows(transactionResult.list);
        const risk = toRows(riskResult.list)[0] || {};
        return {
          id,
          role: String(identity.accountRole) as MemberRisk['role'],
          base: identity,
          cards: toRows(cardResult.list),
          transactions,
          transactionsTotal: Number(transactionResult.total || transactions.length),
          risk,
          profile: buildOperationalRiskProfile(transactions, risk, { reportedTotal: Number(transactionResult.total || transactions.length) }),
        };
      }));
      setMainBase(main);
      setMembers(results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户组风控数据读取失败。');
    } finally {
      setLoading(false);
    }
  }, [mainAccountId]);

  useEffect(() => { void load(); }, [load]);

  const selected = members.find((member) => member.id === selectedId) || members[0];
  const cardRows = useMemo<CardRiskRow[]>(() => {
    if (!selected) return [];
    return selected.cards.map((card) => {
      const cardId = String(pickValue(card, ['cardId', 'id']));
      const transactions = selected.transactions.filter((row) => String(row.cardId) === cardId);
      return { ...card, transactions, profile: buildOperationalRiskProfile(transactions, {}, { reportedTotal: transactions.length }) };
    }).sort((a, b) => b.profile.failedCount - a.profile.failedCount || numberValue(pickValue(a, ['cardBalance', 'availableBalance'])) - numberValue(pickValue(b, ['cardBalance', 'availableBalance'])));
  }, [selected]);

  const group = useMemo(() => {
    const transactions = members.flatMap((member) => member.transactions);
    const profile = buildOperationalRiskProfile(transactions, {}, { reportedTotal: members.reduce((sum, member) => sum + member.transactionsTotal, 0) });
    return {
      profile,
      overdueAmount: members.reduce((sum, member) => sum + member.profile.overdueAmount, 0),
      continuousCount: members.filter((member) => member.profile.continuousOverdue !== 'none').length,
      largeOverdueCount: members.filter((member) => member.profile.largeOverdue).length,
      highDeclineCount: members.filter((member) => member.profile.highDecline || member.profile.highDeclineCardCount > 0).length,
      highRiskCount: members.filter((member) => member.profile.level === '高风险').length,
      totalCards: members.reduce((sum, member) => sum + member.cards.length, 0),
    };
  }, [members]);

  const memberColumns = useMemo<GridColDef[]>(() => [
    { field: 'account', headerName: '账户', minWidth: 235, flex: 1, valueGetter: (_, row) => String(pickValue(asRecord(row.base), ['email', 'nickname', 'userId'])) },
    { field: 'role', headerName: '层级', width: 105, valueGetter: (_, row) => String(row.role) },
    { field: 'level', headerName: '运营关注', width: 115, renderCell: ({ row }) => <StatusChip value={(row.profile as OperationalRiskProfile).level} /> },
    { field: 'overdue', headerName: '确认欠费/缺口', width: 155, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount((row.profile as OperationalRiskProfile).overdueAmount) },
    { field: 'decline', headerName: '拒绝率', width: 115, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatPercent((row.profile as OperationalRiskProfile).failedCount, (row.profile as OperationalRiskProfile).attempts) },
    { field: 'consecutive', headerName: '最大连续拒绝', width: 130, align: 'right', headerAlign: 'right', valueGetter: (_, row) => `${formatNumber((row.profile as OperationalRiskProfile).maxConsecutiveDeclines)} 笔` },
    { field: 'cards', headerName: '高拒绝率卡', width: 125, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatNumber((row.profile as OperationalRiskProfile).highDeclineCardCount) },
    { field: 'reason', headerName: '主要原因', minWidth: 230, flex: 1, valueGetter: (_, row) => (row.profile as OperationalRiskProfile).reasons.join('、') || '当前未命中关注规则' },
  ], []);

  const cardColumns = useMemo<GridColDef[]>(() => [
    { field: 'card', headerName: '卡片', minWidth: 205, flex: 1, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardNo', 'cardId'])) },
    { field: 'status', headerName: '状态', width: 105, renderCell: ({ row }) => <StatusChip value={pickValue(row, ['cardStatusLabel', 'cardStatus'])} /> },
    { field: 'balance', headerName: '可用余额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(pickValue(row, ['availableBalance', 'cardBalance'])) },
    { field: 'attempts', headerName: '交易尝试', width: 105, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatNumber((row.profile as OperationalRiskProfile).attempts) },
    { field: 'decline', headerName: '拒绝率', width: 110, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatPercent((row.profile as OperationalRiskProfile).failedCount, (row.profile as OperationalRiskProfile).attempts) },
    { field: 'consecutive', headerName: '连续拒绝', width: 110, align: 'right', headerAlign: 'right', valueGetter: (_, row) => `${formatNumber((row.profile as OperationalRiskProfile).maxConsecutiveDeclines)} 笔` },
    { field: 'failedAmount', headerName: '拒绝影响金额', width: 155, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount((row.profile as OperationalRiskProfile).failedAmount) },
    { field: 'signal', headerName: '运营关注', width: 115, renderCell: ({ row }) => <StatusChip value={(row.profile as OperationalRiskProfile).level} /> },
  ], []);

  const rejectedColumns = useMemo<GridColDef[]>(() => [
    { field: 'bill', headerName: '交易号', minWidth: 185, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['billId', 'id'])) },
    { field: 'card', headerName: '卡片', minWidth: 190, valueGetter: (_, row) => maskCard(pickValue(row, ['cardNoMasked', 'cardId'])) },
    { field: 'merchant', headerName: '商户', minWidth: 180, flex: 1, valueGetter: (_, row) => String(pickValue(row, ['merchantName', 'tradeDetail'])) },
    { field: 'amount', headerName: '拒绝金额', width: 145, align: 'right', headerAlign: 'right', valueGetter: (_, row) => formatAmount(row.amount, String(row.currency || 'USD')) },
    { field: 'time', headerName: '发生时间', minWidth: 180, valueGetter: (_, row) => formatDateTime(pickValue(row, ['finishTime', 'createTime'])) },
  ], []);

  if (loading) return <PageSkeleton />;
  const groupName = String(pickValue(mainBase, ['customerName', 'email'], `账户组 ${mainAccountId}`));
  const selectedRejected = failedTransactions(selected?.transactions || []);
  const selectedProfile = selected?.profile || buildOperationalRiskProfile([]);
  const selectedName = String(pickValue(selected?.base || {}, ['email', 'nickname', 'userId'], selectedId));

  return <>
    <PageHeader title={`${groupName} · 风控画像`} description="围绕连续欠费、高拒绝率和大额欠费，从主账户下钻到子账户、卡片和拒绝交易。" breadcrumbs={[{ label: '风险分析', to: '/risk' }, { label: '账户组风控' }, { label: groupName }]} action={<Button variant="outlined" onClick={load} startIcon={<Icon icon="solar:refresh-linear" />}>刷新账户组</Button>} />
    {error ? <ErrorState message={error} onRetry={load} /> : null}
    <AnalyticsContextBar period="账户与卡片当前状态 · 每账户最近100笔交易" scope={`${members.length} 个账户成员 · ${group.totalCards} 张卡`} sample />
    <Alert severity="info" sx={{ mb: 3 }}>欠费金额只采用风险接口返回的负余额或真实授信缺口。失败交易金额仅称为“拒绝影响金额”；缺少历史欠费快照时，连续欠费只标记为疑似。</Alert>
    <InsightSummary title="账户组判断" insights={[
      { label: '连续欠费', detail: `${formatNumber(group.continuousCount)} 个账户命中确认或疑似连续欠费`, tone: group.continuousCount ? 'warning' : 'success' },
      { label: '高拒绝率', detail: `${formatNumber(group.highDeclineCount)} 个账户或其卡片拒绝率达到关注阈值`, tone: group.highDeclineCount ? 'warning' : 'success' },
      { label: '大额欠费', detail: `${formatNumber(group.largeOverdueCount)} 个账户达到 ${formatAmount(RISK_THRESHOLDS.largeOverdueAmount)} 阈值`, tone: group.largeOverdueCount ? 'error' : 'success' },
    ]} />

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="确认欠费/授信缺口" value={formatAmount(group.overdueAmount)} helper={`${formatNumber(group.largeOverdueCount)} 个大额欠费账户`} icon="solar:wallet-money-bold-duotone" tone="error" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="账户组拒绝率" value={formatPercent(group.profile.failedCount, group.profile.attempts)} helper={`${formatNumber(group.profile.failedCount)} / ${formatNumber(group.profile.attempts)} 笔`} icon="solar:close-circle-bold-duotone" tone="warning" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="疑似/确认连续欠费" value={formatNumber(group.continuousCount)} helper="需结合历史快照复核" icon="solar:history-bold-duotone" tone="secondary" /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="高风险成员" value={formatNumber(group.highRiskCount)} helper={`${formatNumber(members.length)} 个账户成员`} icon="solar:shield-warning-bold-duotone" tone="info" /></Grid>
    </Grid>

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} lg={4}>
        <Card sx={{ height: '100%' }}>
          <CardHeader title="账户关系与风险扩散" subheader="选择主账户或子账户，右侧分析同步切换" />
          <Divider />
          <Stack sx={{ p: 2 }} gap={1}>
            {members.map((member, index) => {
              const active = member.id === selected?.id;
              return <Button key={member.id} onClick={() => setSearchParams({ account: member.id })} variant={active ? 'contained' : 'text'} color={active ? 'primary' : 'inherit'} sx={{ justifyContent: 'flex-start', textAlign: 'left', minHeight: 64, px: 1.5 }}>
                <Stack direction="row" alignItems="center" gap={1.2} width="100%">
                  <Box sx={{ width: 34, display: 'grid', placeItems: 'center', color: active ? 'inherit' : member.profile.level === '高风险' ? 'error.main' : member.profile.level === '需关注' ? 'warning.main' : 'success.main' }}><Icon icon={index === 0 ? 'solar:crown-bold-duotone' : 'solar:user-id-bold-duotone'} width={23} /></Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}><Typography variant="subtitle2" noWrap>{String(pickValue(member.base, ['email', 'nickname'], member.id))}</Typography><Typography variant="caption" sx={{ opacity: 0.75 }}>{member.role} · {member.profile.reasons[0] || '当前正常'}</Typography></Box>
                  <Chip size="small" label={member.profile.level} color={member.profile.level === '高风险' ? 'error' : member.profile.level === '需关注' ? 'warning' : 'success'} variant={active ? 'filled' : 'outlined'} />
                </Stack>
              </Button>;
            })}
          </Stack>
        </Card>
      </Grid>
      <Grid item xs={12} lg={8}>
        <Card sx={{ height: '100%' }}>
          <CardHeader title={selectedName} subheader={`${selected?.role || '账户'} · 当前选择范围`} action={<Button size="small" onClick={() => navigate(`/analytics/entities/account/${selected?.id}?from=risk/accounts`)}>完整账户分析</Button>} />
          <Divider />
          <Grid container spacing={0}>
            {[
              { label: '确认欠费/缺口', value: formatAmount(selectedProfile.overdueAmount), detail: selectedProfile.largeOverdue ? '达到大额欠费阈值' : '未达到大额阈值' },
              { label: '交易拒绝率', value: formatPercent(selectedProfile.failedCount, selectedProfile.attempts), detail: `${selectedProfile.failedCount} 笔拒绝` },
              { label: '最大连续拒绝', value: `${selectedProfile.maxConsecutiveDeclines} 笔`, detail: selectedProfile.continuousOverdue === 'confirmed' ? `确认连续欠费 ${selectedProfile.overdueDays} 天` : selectedProfile.continuousOverdue === 'suspected' ? '疑似连续欠费' : '未命中' },
              { label: '拒绝影响金额', value: formatAmount(selectedProfile.failedAmount), detail: '不是确认欠费金额' },
            ].map((item) => <Grid item xs={12} sm={6} key={item.label} sx={{ p: 2.5, borderBottom: 1, borderRight: { sm: 1 }, borderColor: 'divider' }}><Typography variant="caption" color="text.secondary">{item.label}</Typography><Typography variant="h5" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{item.value}</Typography><Typography variant="caption" color="text.secondary">{item.detail}</Typography></Grid>)}
          </Grid>
        </Card>
      </Grid>
    </Grid>

    <SectionHeading title="主子账户风险比较" description="优先看风险是否从单张卡扩散到子账户，再影响主账户组。" />
    <DataTableCard title="账户成员风险" rows={members as unknown as Record<string, unknown>[]} columns={memberColumns} getRowId={(row) => String(row.id)} onRowClick={(row) => setSearchParams({ account: String(row.id) })} minHeight={390} />

    <Grid container spacing={2.5} sx={{ mt: 0.5, mb: 3 }}>
      <Grid item xs={12} lg={7}><ChartCard title="卡片拒绝率比较" subheader={`${selectedName} · 每张卡当前加载交易`} type="bar" series={[{ name: '拒绝率 %', data: cardRows.map((row) => row.profile.declineRate * 100) }]} categories={cardRows.map((row) => maskCard(pickValue(row, ['cardNoMasked', 'cardId'])))} height={320} options={{ plotOptions: { bar: { horizontal: true } }, legend: { show: false } }} /></Grid>
      <Grid item xs={12} lg={5}><ChartCard title="风险信号结构" subheader="当前账户卡片" type="donut" series={[cardRows.filter((row) => row.profile.level === '高风险').length, cardRows.filter((row) => row.profile.level === '需关注').length, cardRows.filter((row) => row.profile.level === '正常').length]} height={320} options={{ labels: ['高风险', '需关注', '正常'] }} /></Grid>
    </Grid>

    <Grid container spacing={2.5} sx={{ mb: 3 }}>
      <Grid item xs={12} lg={7}>
        <ChartCard
          title="多时间窗口拒绝率"
          subheader="短期波动与长期基线分开计算，避免只看单一周期"
          type="bar"
          series={[{ name: '拒绝率 %', data: [1, 7, 30, 90].map((days) => (selectedProfile.windows[`d${days}`]?.declineRate || 0) * 100) }]}
          categories={['1日', '7日', '30日', '90日']}
          height={300}
          options={{ legend: { show: false } }}
        />
      </Grid>
      <Grid item xs={12} lg={5}>
        <Card sx={{ height: '100%' }}>
          <CardHeader title="统计可信度" subheader={`策略版本 ${selectedProfile.dataQuality.policyVersion}`} />
          <Divider />
          <Stack gap={2} sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">样本覆盖率</Typography><Typography variant="subtitle2">{formatPercent(selectedProfile.dataQuality.returnedCount, selectedProfile.dataQuality.reportedTotal)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">拒绝原因覆盖率</Typography><Typography variant="subtitle2">{formatPercent(Math.round(selectedProfile.dataQuality.failureReasonCoverage * 100), 100)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">去重事件 / 重复事件</Typography><Typography variant="subtitle2">{formatNumber(selectedProfile.dataQuality.returnedCount)} / {formatNumber(selectedProfile.dataQuality.duplicateCount)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">统计置信度</Typography><StatusChip value={selectedProfile.dataQuality.confidence === '高' ? '正常' : selectedProfile.dataQuality.confidence === '中' ? '需关注' : '数据不足'} /></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Wilson 拒绝率下界</Typography><Typography variant="subtitle2">{(selectedProfile.wilsonDeclineLowerBound * 100).toFixed(1)}%</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">拒绝金额 P95</Typography><Typography variant="subtitle2">{formatAmount(selectedProfile.failedAmountP95)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">资金不足拒绝 / 最大连续</Typography><Typography variant="subtitle2">{formatNumber(selectedProfile.insufficientFundsCount)} / {formatNumber(selectedProfile.maxConsecutiveFundingDeclines)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">商户集中度 HHI</Typography><Typography variant="subtitle2">{selectedProfile.merchantHhi.toFixed(3)}</Typography></Stack>
            <Alert severity={selectedProfile.dataQuality.confidence === '低' ? 'warning' : 'info'}>
              {selectedProfile.dataQuality.confidence === '低' ? '当前样本不足，页面只展示观察信号，不形成高拒绝率结论。' : '当前规则同时使用样本量、原始拒绝率和 Wilson 置信下界。'}
            </Alert>
          </Stack>
        </Card>
      </Grid>
    </Grid>

    <Stack gap={3}>
      <DataTableCard title="卡片风控明细" subheader="点击卡片继续查看余额、同卡交易和拒绝行为" rows={cardRows} columns={cardColumns} getRowId={(row) => String(pickValue(row, ['cardId', 'id']))} onRowClick={(row) => navigate(`/analytics/entities/card/${pickValue(row, ['cardId', 'id'])}?from=risk/accounts`)} minHeight={390} />
      <DataTableCard title="拒绝交易证据" subheader="失败金额用于衡量影响，不等同于已确认欠费" rows={selectedRejected} columns={rejectedColumns} getRowId={(row) => String(pickValue(row, ['billId', 'id']))} onRowClick={(row) => navigate(`/analytics/entities/transaction/${pickValue(row, ['billId', 'id'])}?from=risk/accounts`)} minHeight={390} />
    </Stack>
  </>;
}

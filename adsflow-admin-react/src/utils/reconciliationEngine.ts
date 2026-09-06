import { RECONCILIATION_POLICY, RECONCILIATION_POLICY_VERSION } from '../config/reconciliationPolicy';
import { asRecord, numberValue, pickValue, toRows } from './format';

export type ReconciliationStatus = '已核对' | '有差异' | '数据不完整' | '未建立映射';
export type ReconciliationSeverity = '严重' | '高' | '中' | '低';

export type ReconciliationCheckpoint = Record<string, unknown> & {
  id: string;
  name: string;
  source: string;
  formula: string;
  expected: number;
  actual: number;
  variance: number;
  coverage: number;
  freshness: number;
  status: ReconciliationStatus;
};

export type FraudSignal = Record<string, unknown> & {
  caseId: string;
  billId: string;
  cardId: string;
  userId: string;
  merchant: string;
  amount: number;
  occurredAt: number;
  score: number;
  severity: ReconciliationSeverity;
  confidence: '高' | '中' | '低';
  signals: string[];
};

export type ReconciliationCase = Record<string, unknown> & {
  id: string;
  kind: 'balance' | 'channel' | 'data-quality' | 'transaction';
  title: string;
  entityType: 'platform' | 'channel' | 'transaction';
  entityId: string;
  severity: ReconciliationSeverity;
  confidence: '高' | '中' | '低';
  expected: number;
  actual: number;
  variance: number;
  suspiciousAmount: number;
  evidence: string[];
  nextStep: string;
};

export type ReconciliationModel = {
  policyVersion: string;
  asOf: number;
  tolerance: number;
  status: ReconciliationStatus;
  maxUnexplainedVariance: number;
  checkpoints: ReconciliationCheckpoint[];
  channelRows: Record<string, unknown>[];
  fraudSignals: FraudSignal[];
  cases: ReconciliationCase[];
  history: Record<string, unknown>[];
  totals: {
    bookClosing: number;
    componentTotal: number;
    userBookTotal: number;
    channelExpected: number;
    channelActual: number;
    suspiciousAmount: number;
  };
  quality: {
    confidence: '高' | '中' | '低';
    transactionCoverage: number;
    channelFetchCoverage: number;
    channelMappingCoverage: number;
    staleChannelCount: number;
    duplicateTransactionCount: number;
  };
};

type ReconciliationInput = {
  summary: Record<string, unknown>;
  users: Record<string, unknown>[];
  channels: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  cards: Record<string, unknown>[];
  transactionReportedTotal?: number;
  asOf?: number;
};

function timeOf(row: Record<string, unknown>) {
  const raw = pickValue(row, ['finishTime', 'createTime', 'occurredAt'], 0);
  const numeric = numberValue(raw);
  if (numeric) return numeric > 9_999_999_999 ? numeric : numeric * 1000;
  const parsed = new Date(String(raw)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusOf(row: Record<string, unknown>) {
  return String(pickValue(row, ['tradeStatus', 'tradeStatusLabel', 'status'], '')).toLowerCase();
}

function isSuccessful(row: Record<string, unknown>) {
  return ['1', 'success', '成功', 'completed', '已完成'].includes(statusOf(row));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function severityForScore(score: number): ReconciliationSeverity {
  if (score >= RECONCILIATION_POLICY.fraudScore.critical) return '严重';
  if (score >= RECONCILIATION_POLICY.fraudScore.high) return '高';
  if (score >= RECONCILIATION_POLICY.fraudScore.review) return '中';
  return '低';
}

function severityForVariance(variance: number, tolerance: number): ReconciliationSeverity {
  const multiple = Math.abs(variance) / Math.max(tolerance, 1);
  if (multiple >= 1000) return '严重';
  if (multiple >= 100) return '高';
  if (multiple >= 10) return '中';
  return '低';
}

function deduplicate(rows: Record<string, unknown>[]) {
  const seen = new Map<string, Record<string, unknown>>();
  let duplicateCount = 0;
  rows.forEach((row, index) => {
    const explicit = pickValue(row, ['billId', 'transactionId', 'id'], '');
    const key = explicit ? `id:${String(explicit)}` : `row:${index}`;
    if (seen.has(key)) duplicateCount += 1;
    else seen.set(key, row);
  });
  return { rows: [...seen.values()], duplicateCount };
}

function fraudAnalysis(
  transactions: Record<string, unknown>[],
  cards: Record<string, unknown>[],
  asOf: number,
  coverage: number,
) {
  const cardMap = new Map(cards.map((card) => [String(pickValue(card, ['cardId', 'id'])), card]));
  const windowStart = asOf - RECONCILIATION_POLICY.transactionWindowDays * 86_400_000;
  const successful = transactions.filter((row) => isSuccessful(row) && timeOf(row) >= windowStart && timeOf(row) <= asOf)
    .sort((a, b) => timeOf(a) - timeOf(b));
  const byCard = new Map<string, Record<string, unknown>[]>();
  successful.forEach((row) => {
    const cardId = String(pickValue(row, ['cardId'], 'unknown'));
    byCard.set(cardId, [...(byCard.get(cardId) || []), row]);
  });

  const results: FraudSignal[] = [];
  byCard.forEach((rows, cardId) => {
    const card = cardMap.get(cardId) || {};
    rows.forEach((row, index) => {
      const occurredAt = timeOf(row);
      const prior = rows.slice(0, index);
      const amount = Math.abs(numberValue(row.amount));
      const merchant = String(pickValue(row, ['merchantName', 'merchantId', 'tradeDetail'], '未知商户'));
      const signals: string[] = [];
      let score = 0;

      const duplicate = prior.some((candidate) => Math.abs(occurredAt - timeOf(candidate)) <= RECONCILIATION_POLICY.duplicateWindowMinutes * 60_000
        && String(pickValue(candidate, ['merchantName', 'merchantId', 'tradeDetail'], '')) === merchant
        && Math.abs(numberValue(candidate.amount) - amount) < 0.01);
      if (duplicate) { signals.push(`${RECONCILIATION_POLICY.duplicateWindowMinutes}分钟内同卡同商户同金额重复扣款`); score += RECONCILIATION_POLICY.weights.duplicate; }

      const lastHour = prior.filter((candidate) => occurredAt - timeOf(candidate) <= 3_600_000).length + 1;
      const lastDay = prior.filter((candidate) => occurredAt - timeOf(candidate) <= 86_400_000).length + 1;
      if (lastHour >= RECONCILIATION_POLICY.velocity.oneHour || lastDay >= RECONCILIATION_POLICY.velocity.twentyFourHours) {
        signals.push(`交易速度异常（1小时 ${lastHour} 笔 / 24小时 ${lastDay} 笔）`);
        score += RECONCILIATION_POLICY.weights.velocity;
      }

      const baseline = prior.map((candidate) => Math.abs(numberValue(candidate.amount)));
      const baselineMedian = median(baseline);
      const mad = median(baseline.map((value) => Math.abs(value - baselineMedian)));
      const robustZ = mad ? Math.abs(amount - baselineMedian) / (1.4826 * mad) : 0;
      if (baseline.length >= RECONCILIATION_POLICY.amountOutlier.minimumBaseline
        && amount >= RECONCILIATION_POLICY.amountOutlier.minimumAmount
        && robustZ >= RECONCILIATION_POLICY.amountOutlier.robustZ) {
        signals.push(`金额偏离同卡历史中位数（稳健Z=${robustZ.toFixed(1)}）`);
        score += RECONCILIATION_POLICY.weights.amountOutlier;
      }

      const priorMerchants = new Set(prior.map((candidate) => String(pickValue(candidate, ['merchantName', 'merchantId', 'tradeDetail'], ''))));
      if (prior.length >= 5 && !priorMerchants.has(merchant)) { signals.push('同卡首次出现的新商户'); score += RECONCILIATION_POLICY.weights.newMerchant; }

      const cardStatus = String(pickValue(card, ['cardStatus', 'cardStatusLabel'], '')).toLowerCase();
      if ((cardStatus === '2' || cardStatus.includes('冻结')) && asOf - occurredAt <= 7 * 86_400_000) {
        signals.push('卡片当前为冻结状态且近期存在成功交易（需核对冻结生效时间）');
        score += RECONCILIATION_POLICY.weights.frozenCard;
      }

      if (score < RECONCILIATION_POLICY.fraudScore.review) return;
      const billId = String(pickValue(row, ['billId', 'transactionId', 'id']));
      const confidence: FraudSignal['confidence'] = coverage >= 0.9 && prior.length >= 30 ? '高' : coverage >= 0.5 && prior.length >= 8 ? '中' : '低';
      results.push({
        caseId: `tx-${encodeURIComponent(billId)}`, billId, cardId,
        userId: String(pickValue(row, ['userId'], '')),
        merchant, amount, occurredAt, score: Math.min(100, score), severity: severityForScore(score), confidence, signals,
        ...row,
      });
    });
  });
  return results.sort((a, b) => b.score - a.score || b.amount - a.amount);
}

export function buildReconciliationModel(input: ReconciliationInput): ReconciliationModel {
  const asOf = input.asOf || Date.now();
  const summary = asRecord(input.summary);
  const batch = asRecord(summary.batch);
  const totals = asRecord(summary.totals);
  const remaining = asRecord(summary.remaining);
  const { rows: transactions, duplicateCount } = deduplicate(input.transactions);
  const reportedTransactions = Math.max(transactions.length, input.transactionReportedTotal || transactions.length);
  const transactionCoverage = reportedTransactions ? transactions.length / reportedTransactions : 1;

  const bookClosing = numberValue(pickValue(remaining, ['bookRemainingAmount', 'totalAmount'], 0));
  const flowExpected = numberValue(totals.externalInAmount) + numberValue(totals.backendInAmount)
    - numberValue(totals.externalOutAmount) - numberValue(totals.backendOutAmount);
  const componentTotal = numberValue(remaining.fiatAvailableAmount) + numberValue(remaining.digitalAvailableAmount) + numberValue(remaining.cardAvailableAmount);
  const userBookTotal = input.users.reduce((sum, row) => sum + numberValue(pickValue(row, ['bookRemainingAmount'], 0)), 0);
  const tolerance = Math.max(RECONCILIATION_POLICY.absoluteTolerance, Math.abs(bookClosing) * RECONCILIATION_POLICY.relativeTolerance);

  const staleBoundary = asOf - RECONCILIATION_POLICY.staleSnapshotMinutes * 60_000;
  const channelRows: Record<string, unknown>[] = input.channels.map((row) => {
    const available = numberValue(row.availableBalance);
    const frozen = numberValue(row.frozenBalance);
    const actualBalance = numberValue(pickValue(row, ['totalBalance'], available + frozen)) || available + frozen;
    const hasExpected = row.ledgerExpectedBalance !== undefined && row.ledgerExpectedBalance !== null && row.ledgerExpectedBalance !== '';
    const expectedBalance = hasExpected ? numberValue(row.ledgerExpectedBalance) : 0;
    const variance = hasExpected ? actualBalance - expectedBalance : 0;
    const snapshotAt = new Date(String(pickValue(row, ['snapshotTimeText', 'snapshotTime'], 0))).getTime();
    const fetchOk = !String(row.fetchStatus || '').toLowerCase().includes('fail');
    const stale = !snapshotAt || snapshotAt < staleBoundary;
    const status: ReconciliationStatus = !fetchOk || stale ? '数据不完整' : !hasExpected ? '未建立映射' : Math.abs(variance) <= tolerance ? '已核对' : '有差异';
    return { ...row, actualBalance, expectedBalance, variance, mapped: hasExpected, snapshotAt, stale, status };
  });
  const successfulChannels = channelRows.filter((row) => String(row['fetchStatus'] || '').toLowerCase() !== 'failed');
  const mappedChannels = successfulChannels.filter((row) => Boolean(row.mapped));
  const channelExpected = mappedChannels.reduce((sum, row) => sum + numberValue(row.expectedBalance), 0);
  const channelActual = mappedChannels.reduce((sum, row) => sum + numberValue(row.actualBalance), 0);
  const channelFetchCoverage = channelRows.length ? successfulChannels.length / channelRows.length : 0;
  const channelMappingCoverage = successfulChannels.length ? mappedChannels.length / successfulChannels.length : 0;
  const staleChannelCount = channelRows.filter((row) => Boolean(row.stale)).length;

  const checkpoint = (id: string, name: string, source: string, formula: string, expected: number, actual: number, coverage = 1, freshness = 0): ReconciliationCheckpoint => {
    const variance = actual - expected;
    const status: ReconciliationStatus = coverage < 1 ? '数据不完整' : Math.abs(variance) <= tolerance ? '已核对' : '有差异';
    return { id, name, source, formula, expected, actual, variance, coverage, freshness, status };
  };
  const batchFreshness = new Date(String(pickValue(batch, ['snapshotTimeText'], 0))).getTime();
  const checkpoints = [
    checkpoint('flow-identity', '总账流量恒等式', '平台资金汇总', '外部流入 + 后台流入 − 外部流出 − 后台流出 = 期末账面', flowExpected, bookClosing, 1, batchFreshness),
    checkpoint('asset-components', '资产分项合计', '平台资产分项', '法币可用 + 数字资产 + 卡片余额 = 期末账面', bookClosing, componentTotal, 1, batchFreshness),
    checkpoint('user-subledger', '用户分户账合计', '用户资金明细', '全部用户账面剩余合计 = 平台期末账面', bookClosing, userBookTotal, input.users.length ? 1 : 0, batchFreshness),
    checkpoint('channel-pool', '渠道真实资金池', '渠道账户快照', '已映射渠道账面应有余额 = 渠道可用 + 冻结余额', channelExpected, channelActual, Math.min(channelFetchCoverage, channelMappingCoverage), Math.min(...channelRows.map((row) => numberValue(row.snapshotAt)).filter(Boolean), batchFreshness || asOf)),
  ];

  const fraudSignals = fraudAnalysis(transactions, input.cards, asOf, transactionCoverage);
  const cases: ReconciliationCase[] = [];
  checkpoints.forEach((item) => {
    if (item.status === '已核对') return;
    cases.push({
      id: `balance-${item.id}`, kind: item.coverage < 1 ? 'data-quality' : 'balance', title: item.name,
      entityType: 'platform', entityId: item.id, severity: item.coverage < 1 ? '高' : severityForVariance(item.variance, tolerance),
      confidence: item.coverage >= 0.9 ? '高' : item.coverage >= 0.5 ? '中' : '低', expected: item.expected, actual: item.actual,
      variance: item.variance, suspiciousAmount: 0,
      evidence: [item.formula, `数据覆盖率 ${(item.coverage * 100).toFixed(1)}%`, `允许误差 ±${tolerance.toFixed(2)}`],
      nextStep: item.coverage < 1 ? '先补齐失败或未映射的数据源，再判断资金差异。' : '按账户和渠道拆解差异，核对同一截止时间的原始流水。',
    });
  });
  channelRows.forEach((row) => {
    if (row.status === '已核对') return;
    const id = String(pickValue(row, ['id', 'apiAccountId', 'accountId']));
    cases.push({
      id: `channel-${encodeURIComponent(id)}`, kind: row.status === '有差异' ? 'channel' : 'data-quality',
      title: `${String(pickValue(row, ['channelName'], '渠道'))} · ${String(pickValue(row, ['accountName', 'accountId'], id))}`,
      entityType: 'channel', entityId: id, severity: row.status === '有差异' ? severityForVariance(numberValue(row.variance), tolerance) : '高',
      confidence: row.status === '有差异' ? '高' : '低', expected: numberValue(row.expectedBalance), actual: numberValue(row.actualBalance),
      variance: numberValue(row.variance), suspiciousAmount: 0,
      evidence: [`拉取状态 ${String(row['fetchStatus'] || '-')}`, `快照 ${String(pickValue(row, ['snapshotTimeText'], '-'))}`, `映射状态 ${row.mapped ? '已映射' : '未映射'}`],
      nextStep: row.status === '有差异' ? '核对渠道原始余额、在途清算和该通道交易清单。' : '补齐渠道快照或账面映射，当前不能判断是否少钱。',
    });
  });
  fraudSignals.forEach((signal) => cases.push({
    id: signal.caseId, kind: 'transaction', title: `${signal.merchant} · ${signal.billId}`,
    entityType: 'transaction', entityId: signal.billId, severity: signal.severity, confidence: signal.confidence,
    expected: 0, actual: signal.amount, variance: 0, suspiciousAmount: signal.amount,
    evidence: signal.signals, nextStep: '核对持卡人授权、商户订单、设备/IP 和渠道授权记录；信号本身不是盗刷结论。',
  }));
  cases.sort((a, b) => ['严重', '高', '中', '低'].indexOf(a.severity) - ['严重', '高', '中', '低'].indexOf(b.severity) || Math.abs(b.variance) - Math.abs(a.variance));

  const comparableVariances = checkpoints.filter((item) => item.coverage >= 0.9).map((item) => Math.abs(item.variance));
  const maxUnexplainedVariance = Math.max(0, ...comparableVariances);
  const status: ReconciliationStatus = channelFetchCoverage < 1 || channelMappingCoverage < 1 || staleChannelCount > 0
    ? '数据不完整'
    : maxUnexplainedVariance > tolerance ? '有差异' : '已核对';
  const qualityScore = Math.min(transactionCoverage, channelFetchCoverage, channelMappingCoverage);
  const quality: ReconciliationModel['quality']['confidence'] = qualityScore >= 0.9 && staleChannelCount === 0 ? '高' : qualityScore >= 0.5 ? '中' : '低';

  return {
    policyVersion: RECONCILIATION_POLICY_VERSION, asOf, tolerance, status, maxUnexplainedVariance,
    checkpoints, channelRows, fraudSignals, cases, history: toRows(summary.reconciliationHistory),
    totals: {
      bookClosing, componentTotal, userBookTotal, channelExpected, channelActual,
      suspiciousAmount: fraudSignals.reduce((sum, signal) => sum + signal.amount, 0),
    },
    quality: { confidence: quality, transactionCoverage, channelFetchCoverage, channelMappingCoverage, staleChannelCount, duplicateTransactionCount: duplicateCount },
  };
}

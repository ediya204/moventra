import { numberValue, pickValue } from './format';
import { RISK_POLICY, RISK_POLICY_VERSION } from '../config/riskPolicy';

export const RISK_THRESHOLDS = {
  highDeclineRate: RISK_POLICY.highDecline.rawRate,
  highDeclineMinAttempts: RISK_POLICY.highDecline.minimumAttempts,
  continuousDeclines: RISK_POLICY.sequence.confirmedContinuousDeclines,
  suspectedContinuousDeclines: RISK_POLICY.sequence.suspectedContinuousDeclines,
  largeOverdueAmount: RISK_POLICY.overdue.largeAmount,
  lowCardBalance: RISK_POLICY.card.lowBalance,
} as const;

export type RiskWindowMetrics = {
  days: number;
  attempts: number;
  failedCount: number;
  pendingCount: number;
  declineRate: number;
  failedAmount: number;
};

export type OperationalRiskProfile = {
  attempts: number;
  failedCount: number;
  pendingCount: number;
  declineRate: number;
  failedAmount: number;
  failedAmountP50: number;
  failedAmountP95: number;
  maxConsecutiveDeclines: number;
  maxConsecutiveFundingDeclines: number;
  maxRolling24hDeclines: number;
  overdueAmount: number;
  overdueDays: number;
  highDecline: boolean;
  continuousOverdue: 'confirmed' | 'suspected' | 'none';
  largeOverdue: boolean;
  highDeclineCardCount: number;
  wilsonDeclineLowerBound: number;
  rejectionRateChange7dVs30d: number;
  merchantHhi: number;
  insufficientFundsCount: number;
  windows: Record<string, RiskWindowMetrics>;
  dataQuality: {
    returnedCount: number;
    reportedTotal: number;
    coverage: number;
    duplicateCount: number;
    failureReasonCoverage: number;
    confidence: '高' | '中' | '低';
    earliestEventAt: number;
    latestEventAt: number;
    policyVersion: string;
  };
  level: '高风险' | '需关注' | '正常';
  reasons: string[];
};

export type RiskProfileOptions = {
  reportedTotal?: number;
  asOf?: number;
};

function statusOf(row: Record<string, unknown>) {
  return String(pickValue(row, ['tradeStatus', 'tradeStatusLabel'], '')).toLowerCase();
}

function isFailed(row: Record<string, unknown>) {
  return ['2', 'failed', '失败', 'declined', '拒绝'].includes(statusOf(row));
}

function isPending(row: Record<string, unknown>) {
  return ['0', 'pending', '待处理', 'processing', '处理中'].includes(statusOf(row));
}

function failureCodeOf(row: Record<string, unknown>) {
  return String(pickValue(row, ['failureCode', 'declineCode', 'errorCode', 'failReason'], '')).toLowerCase().trim();
}

function isFundingFailure(row: Record<string, unknown>) {
  if (!isFailed(row)) return false;
  return /insufficient|balance|fund|余额|资金不足|额度不足/.test(failureCodeOf(row));
}

function transactionTime(row: Record<string, unknown>) {
  const value = pickValue(row, ['createTime', 'finishTime'], 0);
  const numeric = numberValue(value);
  if (numeric) return numeric > 9_999_999_999 ? numeric : numeric * 1000;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxConsecutiveMatches(rows: Record<string, unknown>[], predicate: (row: Record<string, unknown>) => boolean) {
  const ordered = [...rows].sort((a, b) => transactionTime(a) - transactionTime(b));
  let current = 0;
  let maximum = 0;
  ordered.forEach((row) => {
    current = predicate(row) ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  });
  return maximum;
}

function deduplicateTransactions(rows: Record<string, unknown>[]) {
  const unique = new Map<string, Record<string, unknown>>();
  let duplicateCount = 0;
  rows.forEach((row, index) => {
    const explicitId = pickValue(row, ['transactionId', 'billId', 'id'], '');
    const key = explicitId ? `id:${String(explicitId)}` : `row:${index}`;
    if (unique.has(key)) duplicateCount += 1;
    else unique.set(key, row);
  });
  return { events: [...unique.values()], duplicateCount };
}

function maxFailuresInRollingWindow(rows: Record<string, unknown>[], windowMs: number) {
  const timestamps = rows.filter(isFailed).map(transactionTime).filter(Boolean).sort((a, b) => a - b);
  let start = 0;
  let maximum = 0;
  timestamps.forEach((timestamp, end) => {
    while (timestamp - timestamps[start] > windowMs) start += 1;
    maximum = Math.max(maximum, end - start + 1);
  });
  return maximum;
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function wilsonLowerBound(successes: number, total: number, z = 1.96) {
  if (!total) return 0;
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = rate + (z * z) / (2 * total);
  const margin = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denominator);
}

function windowMetrics(rows: Record<string, unknown>[], days: number, asOf: number): RiskWindowMetrics {
  const start = asOf - days * 86_400_000;
  const scoped = rows.filter((row) => transactionTime(row) >= start && transactionTime(row) <= asOf);
  const failed = scoped.filter(isFailed);
  return {
    days,
    attempts: scoped.length,
    failedCount: failed.length,
    pendingCount: scoped.filter(isPending).length,
    declineRate: scoped.length ? failed.length / scoped.length : 0,
    failedAmount: failed.reduce((sum, row) => sum + numberValue(row.amount), 0),
  };
}

function merchantConcentration(rows: Record<string, unknown>[]) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const merchant = String(pickValue(row, ['merchantName', 'merchantId', 'tradeDetail'], 'unknown'));
    totals.set(merchant, (totals.get(merchant) || 0) + Math.abs(numberValue(row.amount)));
  });
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  return [...totals.values()].reduce((sum, value) => sum + (value / total) ** 2, 0);
}

function groupByCard(rows: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>();
  rows.forEach((row) => {
    const cardId = String(pickValue(row, ['cardId', 'cardNoMasked'], 'unknown'));
    groups.set(cardId, [...(groups.get(cardId) || []), row]);
  });
  return [...groups.values()];
}

export function buildOperationalRiskProfile(
  transactions: Record<string, unknown>[],
  risk: Record<string, unknown> = {},
  options: RiskProfileOptions = {},
): OperationalRiskProfile {
  const { events, duplicateCount } = deduplicateTransactions(transactions);
  const attempts = events.length;
  const failedRows = events.filter(isFailed);
  const failedCount = failedRows.length;
  const pendingCount = events.filter(isPending).length;
  const declineRate = attempts ? failedCount / attempts : 0;
  const failedAmount = failedRows.reduce((sum, row) => sum + numberValue(row.amount), 0);
  const failedAmounts = failedRows.map((row) => numberValue(row.amount));
  const cardGroups = groupByCard(events);
  const maxConsecutiveDeclines = Math.max(0, ...cardGroups.map((rows) => maxConsecutiveMatches(rows, isFailed)));
  const maxConsecutiveFundingDeclines = Math.max(0, ...cardGroups.map((rows) => maxConsecutiveMatches(rows, isFundingFailure)));
  const maxRolling24hDeclines = Math.max(0, ...cardGroups.map((rows) => maxFailuresInRollingWindow(rows, RISK_POLICY.sequence.rollingHours * 3_600_000)));
  const highDeclineCardCount = cardGroups.filter((rows) => {
    const failures = rows.filter(isFailed).length;
    return rows.length >= RISK_THRESHOLDS.highDeclineMinAttempts
      && failures / rows.length >= RISK_THRESHOLDS.highDeclineRate
      && wilsonLowerBound(failures, rows.length) >= RISK_POLICY.highDecline.wilsonLowerBound;
  }).length;

  const actualRemaining = numberValue(pickValue(risk, ['actualRemainingAvailableAmount'], 0));
  const creditGap = numberValue(pickValue(risk, ['realCreditGapAmount'], 0));
  const overdueAmount = Math.max(actualRemaining < 0 ? Math.abs(actualRemaining) : 0, creditGap);
  const overdueDays = numberValue(pickValue(risk, ['continuousOverdueDays', 'overdueDays', 'arrearsDays'], 0));
  const wilsonDeclineLowerBound = wilsonLowerBound(failedCount, attempts);
  const highDecline = attempts >= RISK_THRESHOLDS.highDeclineMinAttempts
    && declineRate >= RISK_THRESHOLDS.highDeclineRate
    && wilsonDeclineLowerBound >= RISK_POLICY.highDecline.wilsonLowerBound;
  const largeOverdue = overdueAmount >= RISK_THRESHOLDS.largeOverdueAmount;
  const codedFailureCount = failedRows.filter((row) => Boolean(failureCodeOf(row))).length;
  const failureReasonCoverage = failedCount ? codedFailureCount / failedCount : 1;
  const insufficientFundsCount = failedRows.filter(isFundingFailure).length;
  const suspectedByFundingEvidence = maxConsecutiveFundingDeclines >= RISK_THRESHOLDS.suspectedContinuousDeclines;
  const suspectedByFallback = codedFailureCount === 0 && maxConsecutiveDeclines >= RISK_THRESHOLDS.suspectedContinuousDeclines;
  const continuousOverdue: OperationalRiskProfile['continuousOverdue'] = overdueDays > 0
    ? 'confirmed'
    : overdueAmount > 0 && (suspectedByFundingEvidence || suspectedByFallback)
      ? 'suspected'
      : 'none';

  const reasons: string[] = [];
  if (continuousOverdue === 'confirmed') reasons.push(`连续欠费 ${overdueDays} 天`);
  if (continuousOverdue === 'suspected') reasons.push(suspectedByFundingEvidence ? '疑似连续欠费（资金不足拒绝）' : '疑似连续欠费（缺少拒绝原因）');
  if (highDecline) reasons.push(`拒绝率 ${(declineRate * 100).toFixed(1)}%`);
  if (highDeclineCardCount) reasons.push(`${highDeclineCardCount} 张高拒绝率卡`);
  if (largeOverdue) reasons.push('大额欠费');
  if (maxConsecutiveDeclines >= RISK_THRESHOLDS.continuousDeclines) reasons.push(`连续拒绝 ${maxConsecutiveDeclines} 笔`);
  if (maxRolling24hDeclines >= RISK_POLICY.sequence.rollingDeclines) reasons.push(`24小时内拒绝 ${maxRolling24hDeclines} 笔`);

  const asOf = options.asOf || Date.now();
  const windows = Object.fromEntries(RISK_POLICY.windowsInDays.map((days) => [`d${days}`, windowMetrics(events, days, asOf)])) as Record<string, RiskWindowMetrics>;
  const rejectionRateChange7dVs30d = (windows.d7?.declineRate || 0) - (windows.d30?.declineRate || 0);
  if (windows.d7?.attempts >= RISK_POLICY.trend.minimumRecentAttempts && rejectionRateChange7dVs30d >= RISK_POLICY.trend.rejectionRateIncreasePoints) reasons.push(`7日拒绝率上升 ${(rejectionRateChange7dVs30d * 100).toFixed(1)} 个百分点`);
  const merchantHhi = merchantConcentration(events);
  if (merchantHhi >= RISK_POLICY.concentration.highMerchantHhi) reasons.push('商户交易高度集中');

  const reportedTotal = Math.max(events.length, options.reportedTotal || events.length);
  const coverage = reportedTotal ? Math.min(1, events.length / reportedTotal) : 1;
  const confidence: OperationalRiskProfile['dataQuality']['confidence'] = coverage >= RISK_POLICY.quality.highCoverage && attempts >= RISK_POLICY.quality.highMinimumAttempts
    ? '高'
    : coverage >= RISK_POLICY.quality.mediumCoverage && attempts >= RISK_POLICY.quality.mediumMinimumAttempts
      ? '中'
      : '低';
  const timestamps = events.map(transactionTime).filter(Boolean);

  const level: OperationalRiskProfile['level'] = largeOverdue || continuousOverdue === 'confirmed' || (highDecline && maxConsecutiveDeclines >= RISK_THRESHOLDS.continuousDeclines)
    ? '高风险'
    : reasons.length
      ? '需关注'
      : '正常';

  return {
    attempts, failedCount, pendingCount, declineRate, failedAmount,
    failedAmountP50: percentile(failedAmounts, 0.5), failedAmountP95: percentile(failedAmounts, 0.95),
    maxConsecutiveDeclines, maxConsecutiveFundingDeclines, maxRolling24hDeclines, overdueAmount, overdueDays,
    highDecline, continuousOverdue, largeOverdue, highDeclineCardCount,
    wilsonDeclineLowerBound, rejectionRateChange7dVs30d, merchantHhi, insufficientFundsCount, windows,
    dataQuality: {
      returnedCount: events.length,
      reportedTotal,
      coverage,
      duplicateCount,
      failureReasonCoverage,
      confidence,
      earliestEventAt: timestamps.length ? Math.min(...timestamps) : 0,
      latestEventAt: timestamps.length ? Math.max(...timestamps) : 0,
      policyVersion: RISK_POLICY_VERSION,
    },
    level, reasons,
  };
}

export function failedTransactions(rows: Record<string, unknown>[]) {
  return rows.filter(isFailed);
}

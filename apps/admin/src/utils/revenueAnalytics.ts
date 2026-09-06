import { asRecord, numberValue, pickValue, toRows } from './format';

export const REVENUE_MODEL_VERSION = 'revenue-v1.0.0';
export const INCLUDED_REVENUE_TYPES = ['otc_fee', 'card_issuance_fee'] as const;

export type RevenueType = typeof INCLUDED_REVENUE_TYPES[number];
export type RevenueEvent = Record<string, unknown> & {
  id: string;
  revenueType: RevenueType;
  revenueTypeLabel: string;
  userId: string;
  userEmail: string;
  amount: number;
  currency: string;
  status: 'recognized' | 'pending' | 'reversed';
  statusLabel: string;
  occurredAt: number;
  recognizedAt: number;
  sourceRef: string;
  granularity: 'event' | 'account-aggregate';
};

export type RevenueModel = {
  version: string;
  asOf: number;
  events: RevenueEvent[];
  accountRows: Record<string, unknown>[];
  trendRows: Record<string, unknown>[];
  recognized: { total: number; otc: number; cardIssuance: number; count: number };
  pending: { total: number; count: number };
  reversed: { total: number; count: number };
  economics: { otcVolume: number; otcTakeRate: number; issuanceCount: number; averageIssuanceFee: number; accountHhi: number };
  reconciliation: { legacyGrossIncome: number; selectedIncome: number; variance: number };
  quality: { granularity: '逐笔' | '账户汇总'; timeCoverage: number; statusCoverage: number; accountCoverage: number; duplicateCount: number; confidence: '高' | '中' | '低' };
};

function timestamp(value: unknown) {
  const numeric = numberValue(value);
  if (numeric) return numeric > 9_999_999_999 ? numeric : numeric * 1000;
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value: unknown): RevenueEvent['status'] {
  const text = String(value || '').toLowerCase();
  if (text.includes('pending') || text.includes('待')) return 'pending';
  if (text.includes('reverse') || text.includes('冲回') || text.includes('refund')) return 'reversed';
  return 'recognized';
}

function typeLabel(type: RevenueType) {
  return type === 'otc_fee' ? 'OTC手续费' : '开卡费';
}

function statusLabel(status: RevenueEvent['status']) {
  return status === 'recognized' ? '已确认' : status === 'pending' ? '待确认' : '已冲回';
}

function detailedEvents(summary: Record<string, unknown>) {
  return toRows(summary.revenueEvents).map((row, index): RevenueEvent | null => {
    const type = String(pickValue(row, ['revenueType'], '')) as RevenueType;
    if (!INCLUDED_REVENUE_TYPES.includes(type)) return null;
    const status = normalizeStatus(pickValue(row, ['status', 'statusLabel'], 'recognized'));
    const occurredAt = timestamp(pickValue(row, ['occurredAt', 'createTime'], 0));
    return {
      ...row,
      id: String(pickValue(row, ['id', 'revenueId'], `revenue-${index}`)), revenueType: type,
      revenueTypeLabel: String(pickValue(row, ['revenueTypeLabel'], typeLabel(type))),
      userId: String(pickValue(row, ['userId'], '')), userEmail: String(pickValue(row, ['userEmail', 'email'], '')),
      amount: Math.abs(numberValue(row.amount)), currency: String(row.currency || 'USD'), status,
      statusLabel: String(pickValue(row, ['statusLabel'], statusLabel(status))), occurredAt,
      recognizedAt: timestamp(pickValue(row, ['recognizedAt'], 0)), sourceRef: String(pickValue(row, ['sourceRef', 'referenceNo'], '-')),
      granularity: 'event',
    };
  }).filter((row): row is RevenueEvent => Boolean(row));
}

function aggregateFallback(users: Record<string, unknown>[]) {
  return users.flatMap((row) => {
    const userId = String(pickValue(row, ['userId', 'id'], ''));
    const userEmail = String(pickValue(row, ['email', 'userEmail'], ''));
    const occurredAt = timestamp(pickValue(row, ['accountCreateTime', 'accountCreateTimeText'], 0));
    return ([
      { type: 'otc_fee' as const, amount: numberValue(row.otcFeeAmount) },
      { type: 'card_issuance_fee' as const, amount: numberValue(row.cardIssuanceFeeAmount) },
    ]).filter((item) => item.amount > 0).map((item): RevenueEvent => ({
      id: `aggregate-${userId}-${item.type}`, revenueType: item.type, revenueTypeLabel: typeLabel(item.type),
      userId, userEmail, amount: item.amount, currency: 'USD', status: 'recognized', statusLabel: '已确认',
      occurredAt, recognizedAt: 0, sourceRef: `账户汇总 ${userId}`, granularity: 'account-aggregate',
    }));
  });
}

function deduplicate(events: RevenueEvent[]) {
  const seen = new Map<string, RevenueEvent>();
  let duplicateCount = 0;
  events.forEach((event) => {
    if (seen.has(event.id)) duplicateCount += 1;
    else seen.set(event.id, event);
  });
  return { events: [...seen.values()], duplicateCount };
}

export function buildRevenueModel(
  summaryInput: Record<string, unknown>,
  users: Record<string, unknown>[],
  options: { asOf?: number; days?: number } = {},
): RevenueModel {
  const asOf = options.asOf || Date.now();
  const summary = asRecord(summaryInput);
  const detailed = detailedEvents(summary);
  const deduplicated = deduplicate(detailed.length ? detailed : aggregateFallback(users));
  const windowStart = asOf - (options.days || 180) * 86_400_000;
  const events = (detailed.length ? deduplicated.events.filter((event) => event.occurredAt >= windowStart && event.occurredAt <= asOf) : deduplicated.events)
    .sort((a, b) => b.occurredAt - a.occurredAt);
  const duplicateCount = deduplicated.duplicateCount;
  const recognizedEvents = events.filter((event) => event.status === 'recognized');
  const pendingEvents = events.filter((event) => event.status === 'pending');
  const reversedEvents = events.filter((event) => event.status === 'reversed');
  const sum = (rows: RevenueEvent[]) => rows.reduce((total, event) => total + event.amount, 0);
  const otcEvents = recognizedEvents.filter((event) => event.revenueType === 'otc_fee');
  const issuanceEvents = recognizedEvents.filter((event) => event.revenueType === 'card_issuance_fee');

  const accountMap = new Map<string, Record<string, unknown>>();
  recognizedEvents.forEach((event) => {
    const key = event.userId || event.userEmail || 'unknown';
    const current = accountMap.get(key) || { id: key, userId: event.userId, email: event.userEmail, otcRevenue: 0, cardIssuanceRevenue: 0, totalRevenue: 0, recognizedCount: 0 };
    current.otcRevenue = numberValue(current.otcRevenue) + (event.revenueType === 'otc_fee' ? event.amount : 0);
    current.cardIssuanceRevenue = numberValue(current.cardIssuanceRevenue) + (event.revenueType === 'card_issuance_fee' ? event.amount : 0);
    current.totalRevenue = numberValue(current.totalRevenue) + event.amount;
    current.recognizedCount = numberValue(current.recognizedCount) + (event.granularity === 'event' ? 1 : 0);
    accountMap.set(key, current);
  });
  const accountRows = [...accountMap.values()].sort((a, b) => numberValue(b.totalRevenue) - numberValue(a.totalRevenue));

  const dayMap = new Map<string, Record<string, unknown>>();
  events.filter((event) => event.occurredAt).forEach((event) => {
    const day = new Date(event.occurredAt).toISOString().slice(0, 10);
    const current = dayMap.get(day) || { date: day, otcRecognized: 0, cardIssuanceRecognized: 0, pending: 0, reversed: 0 };
    const field = event.status === 'pending' ? 'pending' : event.status === 'reversed' ? 'reversed' : event.revenueType === 'otc_fee' ? 'otcRecognized' : 'cardIssuanceRecognized';
    current[field] = numberValue(current[field]) + event.amount;
    dayMap.set(day, current);
  });
  const trendRows = [...dayMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const otcVolume = users.reduce((total, row) => total + numberValue(row.otcToFiatAmount) + numberValue(row.otcToCoinAmount), 0);
  const selectedIncome = sum(recognizedEvents);
  const income = asRecord(summary.income);
  const legacyGrossIncome = numberValue(pickValue(income, ['grossIncomeAmount', 'totalAmount'], selectedIncome));
  const shares = accountRows.map((row) => selectedIncome ? numberValue(row.totalRevenue) / selectedIncome : 0);
  const timeCoverage = events.length ? events.filter((event) => event.occurredAt > 0).length / events.length : 0;
  const statusCoverage = events.length ? events.filter((event) => Boolean(event.status)).length / events.length : 0;
  const userIds = new Set(users.map((row) => String(pickValue(row, ['userId', 'id'], ''))).filter(Boolean));
  const accountCoverage = events.length ? events.filter((event) => Boolean(event.userId) && userIds.has(event.userId)).length / events.length : 0;
  const qualityScore = Math.min(timeCoverage, statusCoverage, accountCoverage);
  const confidence: RevenueModel['quality']['confidence'] = detailed.length && qualityScore >= 0.95 ? '高' : qualityScore >= 0.5 ? '中' : '低';

  return {
    version: REVENUE_MODEL_VERSION, asOf, events, accountRows, trendRows,
    recognized: { total: selectedIncome, otc: sum(otcEvents), cardIssuance: sum(issuanceEvents), count: recognizedEvents.length },
    pending: { total: sum(pendingEvents), count: pendingEvents.length },
    reversed: { total: sum(reversedEvents), count: reversedEvents.length },
    economics: {
      otcVolume, otcTakeRate: otcVolume ? sum(otcEvents) / otcVolume : 0,
      issuanceCount: detailed.length ? issuanceEvents.length : 0,
      averageIssuanceFee: detailed.length && issuanceEvents.length ? sum(issuanceEvents) / issuanceEvents.length : 0,
      accountHhi: shares.reduce((total, share) => total + share ** 2, 0),
    },
    reconciliation: { legacyGrossIncome, selectedIncome, variance: selectedIncome - legacyGrossIncome },
    quality: { granularity: detailed.length ? '逐笔' : '账户汇总', timeCoverage, statusCoverage, accountCoverage, duplicateCount, confidence },
  };
}

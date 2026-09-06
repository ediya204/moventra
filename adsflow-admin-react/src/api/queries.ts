import type { LoginResult, Paginated, UnknownRecord } from '../types';
import { apiGet, apiPost, unwrapData } from './client';
import { isDemoMode } from '../utils/dataMode';

export async function login(username: string, password: string) {
  if (!isDemoMode && username.trim().toLowerCase() === 'demo@adsflow.local') {
    throw new Error('当前是线上 API 模式，Demo 账号仅用于本地演示。请使用 pnpm demo 启动后重新打开登录页。');
  }
  const response = await apiPost<LoginResult>('/admin-api/login', {
    username,
    password,
  });
  return unwrapData(response);
}

export async function getDashboard() {
  const [critical, secondary, channels] = await Promise.all([
    apiPost<UnknownRecord>('/admin-api/v1-dashboard-critical', {}),
    apiPost<UnknownRecord>('/admin-api/v1-dashboard-secondary', {}),
    apiPost<UnknownRecord>('/admin-api/v1-dashboard-channel-balances', {}),
  ]);
  return {
    critical: unwrapData(critical),
    secondary: unwrapData(secondary),
    channels: unwrapData(channels),
  };
}

export async function getCustomers(body: Record<string, unknown>) {
  return unwrapData(await apiPost<Paginated>('/admin-api/v1-member-list', body));
}

export async function getCustomerDetail(userId: string) {
  return unwrapData(
    await apiPost<UnknownRecord>('/admin-api/v1-customer-detail', { userId }),
  );
}

export async function getSubAccountDetail(userId: string) {
  return unwrapData(
    await apiPost<UnknownRecord>('/admin-api/v1-sub-member-detail', { userId }),
  );
}

export async function getCustomerFundFlows(body: Record<string, unknown>) {
  return unwrapData(await apiPost<Paginated>('/admin-api/v1-customer-fund-flows', body));
}

export async function getCustomerDigitalRecords(body: Record<string, unknown>) {
  return unwrapData(await apiPost<Paginated>('/admin-api/v1-customer-digital-records', body));
}

export async function getCustomerOtcRecords(body: Record<string, unknown>) {
  return unwrapData(await apiPost<Paginated>('/admin-api/v1-customer-otc-records', body));
}

export async function getCustomerCreditRecords(body: Record<string, unknown>) {
  return unwrapData(await apiPost<Paginated>('/admin-api/v1-customer-credit-records', body));
}

export async function getSubAccountTransfers(body: Record<string, unknown>) {
  return unwrapData(await apiPost<Paginated>('/admin-api/admin-sub-member-transfer-record', body));
}

export async function getSubAccounts(mainAccountId: string) {
  return unwrapData(
    await apiPost<Paginated>('/admin-api/v1-sub-member-list', {
      mainAccountId,
      currentPage: 1,
      pageSize: 100,
    }),
  );
}

export async function getCards(query: Record<string, unknown>) {
  return unwrapData(
    await apiGet<Paginated>('/admin-api/card-management/cards', query),
  );
}

export async function getCardOverview() {
  return unwrapData(
    await apiGet<UnknownRecord>('/admin-api/card-management/overview'),
  );
}

export async function getUserCardAssets(query: Record<string, unknown>) {
  return unwrapData(
    await apiGet<Paginated>('/admin-api/card-management/user-card-assets', query),
  );
}

export async function getUserCardAssetDetail(userId: string, query: Record<string, unknown> = {}) {
  return unwrapData(
    await apiGet<UnknownRecord>(
      `/admin-api/card-management/user-card-assets/${encodeURIComponent(userId)}`,
      query,
    ),
  );
}

export async function getCardOtpRecords(query: Record<string, unknown>) {
  return unwrapData(
    await apiGet<Paginated>('/admin-api/card-management/card-otp-records', query),
  );
}

export async function getCardBatchHistory(query: Record<string, unknown> = {}) {
  return unwrapData(
    await apiGet<Paginated>('/admin-api/card-management/card-batch-actions', query),
  );
}

export async function getCardDetail(cardId: string) {
  return unwrapData(
    await apiGet<UnknownRecord>(`/admin-api/card-management/cards/${encodeURIComponent(cardId)}`),
  );
}

export async function getCardBills(cardId: string, query: Record<string, unknown>) {
  return unwrapData(
    await apiGet<Paginated>(
      `/admin-api/card-management/cards/${encodeURIComponent(cardId)}/bills`,
      query,
    ),
  );
}

export async function getCardOtps(cardId: string) {
  return unwrapData(
    await apiGet<Paginated>('/admin-api/card-management/card-otp-records', {
      cardId,
      page: 1,
      pageSize: 20,
    }),
  );
}

export async function getTransactions(query: Record<string, unknown>) {
  return unwrapData(
    await apiGet<Paginated>('/admin-api/card-management/card-bills', query),
  );
}

export async function getTradeOverview() {
  return unwrapData(
    await apiGet<UnknownRecord>('/admin-api/trade-management/overview'),
  );
}

export async function getTransactionDetail(billId: string) {
  return unwrapData(
    await apiGet<UnknownRecord>(
      `/admin-api/card-management/card-bills/${encodeURIComponent(billId)}`,
    ),
  );
}

export async function getRiskData() {
  const [warnings, warningStats, riskCards, riskCardStats] = await Promise.all([
    apiGet<Paginated>('/admin-api/risk-control/user-funds-warnings', {
      page: 1,
      pageSize: 50,
      sortField: 'warningPercent',
      sortOrder: 'desc',
    }),
    apiGet<UnknownRecord>('/admin-api/risk-control/user-funds-warnings/statistics'),
    apiGet<Paginated>('/admin-api/card-management/risk-cards', {
      page: 1,
      pageSize: 50,
      sortField: 'availableBalance',
      sortOrder: 'asc',
    }),
    apiGet<UnknownRecord>('/admin-api/card-management/risk-cards/statistics'),
  ]);

  return {
    warnings: unwrapData(warnings),
    warningStats: unwrapData(warningStats),
    riskCards: unwrapData(riskCards),
    riskCardStats: unwrapData(riskCardStats),
  };
}

export async function getUserRiskWarnings(query: Record<string, unknown>) {
  return unwrapData(
    await apiGet<Paginated>('/admin-api/risk-control/user-funds-warnings', {
      page: 1,
      pageSize: 20,
      ...query,
    }),
  );
}

export async function getPlatformFundsReport(query: Record<string, unknown> = {}) {
  const [summary, users, channels] = await Promise.all([
    apiGet<UnknownRecord>('/admin-api/platform-funds-report/summary'),
    apiGet<Paginated>('/admin-api/platform-funds-report/users', { page: 1, pageSize: 50, ...query }),
    apiGet<Paginated>('/admin-api/platform-funds-report/channels', { page: 1, pageSize: 100 }),
  ]);
  return {
    summary: unwrapData(summary),
    users: unwrapData(users),
    channels: unwrapData(channels),
  };
}

export async function getReconciliationData() {
  const [funds, transactions, cards] = await Promise.all([
    getPlatformFundsReport({ pageSize: 1000 }),
    getTransactions({ page: 1, pageSize: 1000 }),
    getCards({ page: 1, pageSize: 1000 }),
  ]);
  return { funds, transactions, cards };
}

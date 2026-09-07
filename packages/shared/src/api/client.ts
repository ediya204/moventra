import type { ApiEnvelope } from '../types';

type HttpMethod = 'GET' | 'POST';

type AllowRule = {
  method: HttpMethod;
  path: RegExp;
  purpose: string;
};

const READ_ONLY_ALLOWLIST: AllowRule[] = [
  {method:'GET',path:/^\/local-slash-demo\/management\/card-ownership\/cards\/[^/]+$/,purpose:'内部用户归属查询'},
  {method:'POST',path:/^\/local-slash-demo\/management\/card-ownership\/cards\/[^/]+$/,purpose:'本地内部用户绑定，不操作渠道'},
  {method:'GET',path:/^\/local-slash-demo\/management\/live\/(status|cards|transactions|overview)(\/[^/]+)?$/,purpose:'本地授权的真实Slash只读投影'},
  {method:'POST',path:/^\/local-slash-demo\/management\/live\/sync$/,purpose:'触发本地只读同步，不调用渠道写接口'},
  {method:'GET',path:/^\/local-slash-demo\/management\/finance\/(context|export|flows(\/[^/]+)?|orders(\/[^/]+)?)$/,purpose:'隔离数字货币账本与订单查询'},
  {method:'POST',path:/^\/local-slash-demo\/management\/finance\/(pricing|quotes|orders|orders\/[^/]+\/(confirm|review|amend|cancel|return|risk-check|execute|reconcile|payout))$/,purpose:'隔离内部兑换与出金审批'},
  {method:'GET',path:/^\/local-slash-demo\/management\/card-admin\/(identity|cards|operations)(\/[^/]+)?$/,purpose:'隔离卡片管理查询'},
  {method:'POST',path:/^\/local-slash-demo\/management\/card-admin\/(cards\/[^/]+\/(preview|operations)|operations\/[^/]+\/(review|refresh))$/,purpose:'隔离卡片权限审批与账本'},
  {method:'GET',path:/^\/local-slash-demo\/management\/fx\/(meta|report|balances|differences|export|cards\/[^/]+|transactions(\/[^/]+(\/(timeline|relations))?)?)$/,purpose:'本地精确跨币种查询'},
  {method:'GET',path:/^\/local-slash-demo\/management\/channels(\/[^/]+(\/products)?)?$/,purpose:'本地发卡渠道与目录'},
  {method:'POST',path:/^\/local-slash-demo\/management\/channels(\/[^/]+(\/import)?)?$/,purpose:'本地渠道维护与目录导入'},
  {method:'GET',path:/^\/local-slash-demo\/portal\/bin-products$/,purpose:'本地客户端卡BIN目录'},
  {method:'GET',path:/^\/local-slash-demo\/management\/bins(\/[^/]+)?$/,purpose:'本地卡BIN管理查询'},
  {method:'POST',path:/^\/local-slash-demo\/management\/bins(\/[^/]+)?$/,purpose:'本地卡BIN维护'},
  {method:'GET',path:/^\/local-slash-demo\/management\/console\/(overview|audit|settings|system|orders)(\/[^/]+)?$/,purpose:'管理总后台本地查询'},
  {method:'POST',path:/^\/local-slash-demo\/management\/console\/settings$/,purpose:'管理总后台本地展示配置'},
  { method: 'GET', path: /^\/local-slash-demo\/management\/(session|catalog|groups|users)(\/[^/]+)?$/, purpose: '本地用户组管理查询' },
  { method: 'POST', path: /^\/local-slash-demo\/management\/(session|groups|users|fees\/preview|reset\/complete|(groups|users)\/[^/]+\/(fees|status|review|reset-password|profile))$/, purpose: '独立本地用户管理操作' },
  { method: 'GET', path: /^\/local-slash-demo\/portal\/(state|transactions|messages)(\/[^/]+)?$/, purpose: '本地统一客户端数据' },
  { method: 'POST', path: /^\/local-slash-demo\/portal\/action$/, purpose: '本地 Demo 资金流程，固定loopback代理' },
  { method: 'GET', path: /^\/local-slash-demo\/(health|summary|scenarios|transactions|accounts|cards|virtual-accounts)(\/[^/]+)?$/, purpose: '本地客户端 Slash Demo 查询' },
  { method: 'POST', path: /^\/admin-api\/login$/, purpose: '认证' },
  { method: 'POST', path: /^\/admin-api\/refresh-token$/, purpose: '刷新会话' },
  { method: 'GET', path: /^\/admin-api\/system\/getAsyncRoutes$/, purpose: '读取权限路由' },
  { method: 'POST', path: /^\/admin-api\/v1-dashboard-(critical|secondary|channel-balances)$/, purpose: '运营工作台' },
  { method: 'POST', path: /^\/admin-api\/v1-(member-list|sub-member-list|customer-detail|sub-member-detail)$/, purpose: '客户与账户关系' },
  { method: 'POST', path: /^\/admin-api\/v1-customer-(fund-flows|digital-records|otc-records|credit-records)$/, purpose: '客户流水' },
  { method: 'POST', path: /^\/admin-api\/admin-sub-member-transfer-record$/, purpose: '子账户资金关系' },
  { method: 'GET', path: /^\/admin-api\/card-management\/overview$/, purpose: '卡片总览' },
  { method: 'GET', path: /^\/admin-api\/card-management\/cards$/, purpose: '卡片查询' },
  { method: 'GET', path: /^\/admin-api\/card-management\/cards\/[^/]+$/, purpose: '卡片详情' },
  { method: 'GET', path: /^\/admin-api\/card-management\/cards\/[^/]+\/bills$/, purpose: '单卡交易' },
  { method: 'GET', path: /^\/admin-api\/card-management\/card-bills$/, purpose: '卡交易查询' },
  { method: 'GET', path: /^\/admin-api\/card-management\/card-bills\/[^/]+$/, purpose: '交易详情' },
  { method: 'GET', path: /^\/admin-api\/card-management\/(risk-cards|risk-cards\/statistics|card-otp-records|user-card-assets)$/, purpose: '卡片风险与资产' },
  { method: 'GET', path: /^\/admin-api\/card-management\/user-card-assets\/[^/]+$/, purpose: '用户卡资产详情' },
  { method: 'GET', path: /^\/admin-api\/card-management\/card-batch-actions$/, purpose: '批量操作历史' },
  { method: 'GET', path: /^\/admin-api\/card-management\/card-batch-actions\/[^/]+$/, purpose: '批量操作详情' },
  { method: 'GET', path: /^\/admin-api\/trade-management\/overview$/, purpose: '交易总览' },
  { method: 'GET', path: /^\/admin-api\/trade-management\/(digital-bills|otc-bills)\/statistics$/, purpose: '交易统计' },
  { method: 'GET', path: /^\/admin-api\/risk-control\/user-funds-warnings$/, purpose: '资金预警' },
  { method: 'GET', path: /^\/admin-api\/risk-control\/user-funds-warnings\/statistics$/, purpose: '预警统计' },
  { method: 'GET', path: /^\/admin-api\/platform-funds-report\/.+$/, purpose: '平台报表' },
  { method: 'GET', path: /^\/admin-api\/settlement-management\/.+$/, purpose: '结算查询' },
];

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
let accessToken = '';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function setAccessToken(token?: string) {
  accessToken = token?.trim() || '';
}

export function clearAccessToken() {
  accessToken = '';
}

function assertAllowed(method: HttpMethod, path: string) {
  const allowed = READ_ONLY_ALLOWLIST.some(
    (rule) => rule.method === method && rule.path.test(path),
  );

  if (!allowed) {
    throw new ApiError(`只读网关已阻止未授权接口：${method} ${path}`);
  }
}

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
      return;
    }
    url.searchParams.set(key, String(value));
  });

  return `${url.pathname}${url.search}`;
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: { query?: Record<string, unknown>; body?: unknown } = {},
) {
  assertAllowed(method, path);
  const response = await fetch(buildUrl(path, options.query), {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(`接口返回了无法解析的数据（HTTP ${response.status}）`, response.status);
  }

  if (!response.ok || payload.success === false) {
    const message = typeof payload.message === 'string' && payload.message.trim()
      ? payload.message
      : typeof payload.msg === 'string' && payload.msg.trim() ? payload.msg : '';
    throw new ApiError(message || (response.ok
      ? '接口拒绝了请求，请检查账号、认证要求及当前数据源。'
      : `请求失败（HTTP ${response.status}）`), response.status);
  }

  return payload;
}

export const apiGet = <T>(path: string, query?: Record<string, unknown>) =>
  request<T>('GET', path, { query });

export const apiPost = <T>(path: string, body?: unknown) =>
  request<T>('POST', path, { body });

export function unwrapData<T>(payload: ApiEnvelope<T>): T {
  if (payload.data !== undefined) return payload.data;
  return payload as unknown as T;
}

export function getReadOnlyRules() {
  return READ_ONLY_ALLOWLIST.map(({ method, path, purpose }) => ({
    method,
    path: path.source,
    purpose,
  }));
}

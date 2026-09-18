import { isFundsPath, type FundsCommand } from './fundsContract';
import { isCardSnapshotPath, isCardSyncPath, isCardActionPath } from './cardSnapshotContract';
import { isAdminSite } from './site';
import { isLedgerReadPath } from './ledgerContract';
import { getFirebaseAuth } from '../firebase';

export type CustomerScope = { id: string; kind: 'personal' | 'business'; name: string };
export type LiveSession = {
  id: string; role: 'customer' | 'admin'; globalAdmin?: boolean; customers: CustomerScope[]; operator: boolean; mfaVerified: boolean;
  requiresMfa: boolean; staffScopes: { customerId: string; name: string; permission: string }[];
};
export class SessionError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
const messages: Record<string, string> = {
  card_action_in_progress:'该卡已有处理中或待核实的操作，请等待渠道确认。',
 card_controls_disabled:'此卡暂不支持在线操作。',
 card_control_scope_required:'没有这张卡的操作权限。',
 idempotency_conflict:'请求内容已变化，请关闭后重新操作。',
 invalid_card_action:'操作与当前卡片状态不匹配，请刷新后重试。',
 card_metrics_not_enrolled: '此卡尚未完成历史数据初始化。',
 card_sync_disabled: '此卡来源尚未启用渠道同步。',
  projection_updated: '数据版本已变化，请刷新后重试。',
  test_wallet_unavailable: '测试余额暂时无法读取，请稍后重试。',
  ledger_disabled: '账本查询尚未启用。',
  ledger_unavailable: '账本暂时无法读取，请稍后重试。',
  invalid_email_query: '请输入完整、有效的登录邮箱。',
  identity_directory_unavailable: '登录身份服务暂不可用，无法核对邮箱，请稍后重试。',
  invalid_query: '查询参数无效，请重新输入。',
  onboarding_changed: '开户状态已更新，请刷新后重新操作。',
  invalid_onboarding_transition: '当前开户状态不允许此操作，请刷新。',
  review_reason_required: '请填写审批或状态变更说明。',
  admin_password_required: '运营后台请使用已开通账号的邮箱和密码登录。',
  customer_required: '此账号是后台管理员，请使用运营后台入口。',
  operator_required: '此账号没有运营后台权限，请使用客户端入口。',
  registration_required: '你尚未创建 Moventra 账户，请补充信息完成注册。',
  user_disabled: '账户已停用，请联系管理员。',
  invalid_registration: '请填写有效姓名（1–80 个字符）。',
  invalid_api_response: '身份服务响应异常，请稍后重试。',
  api_unavailable: '身份服务暂时无法连接，请稍后重试。',
  api_not_available: '当前服务尚未开放此功能，请联系管理员。',
  'auth/weak-password': '密码强度不足，请使用更强的密码。',
  'auth/email-already-in-use': '邮箱已关联其他账户，请使用原登录方式。',
  'auth/provider-already-linked': '已设置密码，请重试创建账户。',
  user_not_enabled: '身份已验证，业务账户尚未开通或已停用，请联系管理员。',
  unauthenticated: '登录已失效，请退出后重新登录。',
  mfa_required: '运营访问需要验证器双重验证。',
  not_found: '没有访问该客户或该资源的权限。',
  temporarily_unavailable: '服务暂不可用，请稍后重试。',
  'auth/invalid-credential': '邮箱或密码不正确。',
  'auth/wrong-password': '邮箱或密码不正确。',
  'auth/user-not-found': '邮箱或密码不正确。',
  'auth/invalid-email': '请输入有效邮箱。',
  'auth/user-disabled': '该账户已停用。',
  'auth/too-many-requests': '尝试过于频繁，请稍后重试。',
  'auth/invalid-verification-code': '验证码不正确，请输入验证器当前的六位验证码。',
  'auth/code-expired': '验证已过期，请重新登录。',
  'auth/requires-recent-login': '此操作需要重新登录，请退出后再试。',
  'auth/network-request-failed': '网络连接失败，请稍后重试。',
  'auth/popup-blocked': '浏览器阻止了登录弹窗，请允许弹窗后重试。',
  'auth/popup-closed-by-user': 'Google 登录已取消，请重试或使用邮箱登录。',
  'auth/cancelled-popup-request': '登录弹窗已取消，请重新尝试。',
  'auth/unauthorized-domain': '当前域名尚未获得 Google 登录授权，请联系管理员。',
  'auth/operation-not-allowed': '该登录方式尚未启用，请联系管理员。',
  'auth/account-exists-with-different-credential': '该邮箱已有其他登录方式，请先使用原方式登录，不要重复注册。',
  email_unverified: '请先验证邮箱，再继续登录。',
};
export function authMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return messages[code] || '操作未完成，请稍后重试或联系管理员。';
}

// Existing read-only channel projection contract; no provider or write proxy.
export function isChannelReadPath(path: string): boolean {
  if (path === '/admin-api/v1/channel-projections') return true;
  const [pathname, query = ''] = path.split('?');
  if (path.includes('#') || path.split('?').length > 2) return false;
  const base = '/admin-api/v1/channel-projections/[A-Za-z0-9_-]+';
  if (new RegExp('^' + base + '/(transactions|cards)/[A-Za-z0-9_-]+$').test(pathname)) return !query;
  if (!new RegExp('^' + base + '/(transactions|cards)$').test(pathname)) return false;
  const params = new URLSearchParams(query);
  const allowed = new Set(pathname.endsWith('/cards') ? ['revision', 'keyword', 'cardStatus', 'page'] : ['revision', 'keyword', 'detailedStatus', 'from', 'to', 'page', 'cardId', 'metric']);
  return [...params.keys()].every(key => allowed.has(key) && params.getAll(key).length === 1);
}

export function isCustomerReadPath(path: string): boolean {
 const [pathname, query = ''] = path.split('?');
 if (path.includes('#') || path.split('?').length > 2 || !/^\/(client|admin)-api\/v1\/customers\/[0-9a-f-]{36}\/(accounts|transactions)$/.test(pathname)) return false;
 const params = new URLSearchParams(query);
 return [...params.keys()].every(key => ['limit', 'offset'].includes(key) && params.getAll(key).length === 1 && /^\d+$/.test(params.get(key)!));
}

// Dedicated same-origin transport. Firebase tokens never enter legacy/Demo APIs.
export function isUserDirectoryPath(path:string):boolean {
 const [pathname,query='']=path.split('?');
 if(pathname!=='/admin-api/v1/users'||path.includes('#')||path.split('?').length>2)return false;
 const params=new URLSearchParams(query);
 return [...params.keys()].every(key=>['email','userId','limit','offset'].includes(key)&&params.getAll(key).length===1);
}
async function liveRequest<T>(path: string, body?: { name: string } | {action:string;revision:number;reason:string} | FundsCommand | {refresh:true} | CardActionInput, envelope = false, requestId?:string): Promise<T> {
  const onboarding = /^\/(client|admin)-api\/v1\/customers\/[0-9a-f-]{36}\/onboarding$/.test(path);
  if (body !== undefined ? path !== '/api/v1/register' && !isCardSyncPath(path) && !isCardActionPath(path) && !onboarding && !isFundsPath(path,true) : !isFundsPath(path,false) && !isTestWalletPath(path) && !isCardSnapshotPath(path) && !isLedgerReadPath(path) && !onboarding && !/^\/(api|client-api|admin-api)\/v1\/me$/.test(path) && !isChannelReadPath(path) && !/^\/admin-api\/v1\/ops\/overview\?days=(7|14|30)$/.test(path) && !isCustomerReadPath(path) && !isUserDirectoryPath(path)) throw new SessionError('invalid_path');
  if (isAdminSite ? path.startsWith('/client-api/') || path === '/api/v1/register' : path.startsWith('/admin-api/')) throw new SessionError('invalid_path');
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new SessionError('unauthenticated', 401);
  const token = await user.getIdToken();
  if (getFirebaseAuth().currentUser !== user) throw new SessionError('unauthenticated', 401);
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(requestId ? {'Idempotency-Key':requestId} : {}), Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  let payload;
  try { payload = await response.json(); } catch { throw new SessionError('invalid_api_response', response.status); }
  if (!response.ok) throw new SessionError(payload?.error?.code || 'temporarily_unavailable', response.status);
  if (getFirebaseAuth().currentUser !== user) throw new SessionError('unauthenticated', 401);
  if (!payload || typeof payload.data !== 'object' || payload.data === null) throw new SessionError('invalid_api_response', response.status);
  return (envelope ? payload : payload.data) as T;
}

export const liveGet = <T>(path: string) => liveRequest<T>(path);
export const registerUser = (name: string) => liveRequest<{ id: string }>('/api/v1/register', { name });

export const updateOnboarding = (path:string, input:{action:string;revision:number;reason:string}) => liveRequest<import("./onboarding").OnboardingState>(path,input);

export async function liveGetPage<T>(path:string):Promise<{data:T[];meta:{limit:number;offset:number;hasMore:boolean}}> {
 const result=await liveRequest<{data:T[];meta:{limit:number;offset:number;hasMore:boolean}}>(path,undefined,true);
 if(!Array.isArray(result.data)||typeof result.meta?.hasMore!=='boolean')throw new SessionError('invalid_api_response');
 return result;
}

export function isTestWalletPath(path:string):boolean { return /^\/client-api\/v1\/customers\/[0-9a-f-]{36}\/test-wallet$/.test(path); }

export const fundsCommand = <T>(path:string,body:FundsCommand,requestId:string)=>liveRequest<T>(path,body,false,requestId);

export const liveCardSync = (path:string) => liveRequest<{syncState:string}>(path,{refresh:true});

export type CardActionInput={action:"activate"|"pause"|"close";expectedStatus:string;confirmClose:boolean};
export const liveCardAction=(path:string,body:CardActionInput,key:string)=>liveRequest<{id:string;state:string}>(path,body,false,key);

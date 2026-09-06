import { getFirebaseAuth } from '../firebase';

export type CustomerScope = { id: string; kind: 'personal' | 'business'; name: string };
export type LiveSession = {
  id: string; customers: CustomerScope[]; operator: boolean; mfaVerified: boolean;
  requiresMfa: boolean; staffScopes: { customerId: string; name: string; permission: string }[];
};
export class SessionError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
const messages: Record<string, string> = {
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
  email_unverified: '请先验证邮箱，再继续登录。',
};
export function authMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return messages[code] || '操作未完成，请稍后重试或联系管理员。';
}

// Dedicated same-origin transport. Firebase tokens never enter legacy/Demo APIs.
export async function liveGet<T>(path: string): Promise<T> {
  if (!/^\/api\/v1\/me$/.test(path) && !/^\/(client|admin)-api\/v1\/customers\/[0-9a-f-]{36}\/(accounts|transactions)$/.test(path)) throw new SessionError('invalid_path');
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new SessionError('unauthenticated', 401);
  const token = await user.getIdToken();
  if (getFirebaseAuth().currentUser !== user) throw new SessionError('unauthenticated', 401);
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  const payload = await response.json();
  if (!response.ok) throw new SessionError(payload.error?.code || 'temporarily_unavailable', response.status);
  if (getFirebaseAuth().currentUser !== user) throw new SessionError('unauthenticated', 401);
  return payload.data as T;
}

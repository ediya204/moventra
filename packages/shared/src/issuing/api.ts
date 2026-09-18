import { getFirebaseAuth } from "../firebase";
import { isAdminSite } from "../auth/site";
import { issuingPath, reasons } from "./contract";
export class IssuingError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
export async function issuingRequest<T>(
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const method = body === undefined ? "GET" : "POST";
  if (
    !issuingPath(method, path) ||
    (isAdminSite
      ? path.startsWith("/client-api/")
      : path.startsWith("/admin-api/"))
  )
    throw new Error("请求路径不可用");
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("请先登录");
  const token = await user.getIdToken();
  if (getFirebaseAuth().currentUser !== user) throw new Error("登录已变更");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    const p = await r.json();
    if (getFirebaseAuth().currentUser !== user) throw new Error("登录已变更");
    if (!r.ok)
      throw new IssuingError(p?.error?.code || "unknown", r.status, reasons[p?.error?.code] || `请求未完成（${r.status}）`);
    if (p?.data === undefined || p.data === null)
      throw new Error("服务响应无效");
    return p.data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError")
      throw new Error("请求结果尚未确认，请刷新查询；再次提交将沿用原请求标识");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

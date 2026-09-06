import { apiGet, apiPost, unwrapData } from "../api/client";
export interface Fee {
  kind: string;
  label: string;
  currency: string;
  precision: number;
  bps: number;
  fixedMinor: number;
  overridden: boolean;
  source: string;
}
export interface Group {
  id: string;
  name: string;
  description: string;
  status: string;
  revision: number;
  memberCount?: number;
  created_at: string;
  fees?: Fee[];
  audit?: Audit[];
}
export interface User {
  id: string;
  group_id: string;
  groupName: string;
  name: string;
  email: string;
  status: string;
  revision: number;
  created_at: string;
  review_note?: string;
  password_set?: number;
  credential_version?: number;
  fees?: Fee[];
  accounts?: {
    id: string;
    currency: string;
    available_minor: number;
    posted_minor: number;
  }[];
  audit?: Audit[];
}
export interface Audit {
  actor: string;
  action: string;
  description: string;
  created_at: string;
}
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
const base = "/local-slash-demo/management";
export const get = async <T>(
  path: string,
  query?: Record<string, unknown>,
): Promise<T> => unwrapData(await apiGet<T>(`${base}/${path}`, query));
export const post = async <T>(path: string, body: unknown): Promise<T> =>
  unwrapData(await apiPost<T>(`${base}/${path}`, body));
export function exactUnits(text: string, precision: number) {
  if (!new RegExp(`^\\d+(\\.\\d{1,${precision}})?$`).test(text))
    throw new Error(`请输入最多${precision}位小数的非负数`);
  const [whole, fraction = ""] = text.split(".");
  const v =
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, "0"));
  if (v > 1000000000000n) throw new Error("数值超过演示上限");
  return Number(v);
}
export function decimal(value: number, precision: number) {
  const n = BigInt(value),
    factor = 10n ** BigInt(precision);
  return `${n / factor}.${String(n % factor).padStart(precision, "0")}`;
}
export const labels: Record<string, string> = {
  active: "启用",
  disabled: "停用",
  pending: "待审核",
  rejected: "已拒绝",
};

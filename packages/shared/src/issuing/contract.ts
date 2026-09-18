export type Supplier = {
  id: string;
  name: string;
  adapter: "manual" | "slash";
  status: string;
  accountRef: string;
  entityRef: string;
  revision: number;
};
export type Product = {
  id: string;
  supplierId: string;
  name: string;
  bin: string;
  network: string;
  upstreamId: string;
  status: string;
  description: string;
  feeMinor: string;
  minimumMinor: string;
  revision: number;
};
export type PublicProduct = Pick<
  Product,
  | "id"
  | "name"
  | "bin"
  | "network"
  | "status"
  | "description"
  | "feeMinor"
  | "minimumMinor"
  | "revision"
> & { currency: "USD"; blockedReason: string };
export type Quote = {
  id: string;
  productId: string;
  feeMinor: string;
  fundingMinor: string;
  totalMinor: string;
  priceSource: string;
  expiresAt: string;
};
export type Order = {
  cardName: string;
  id: string;
  customerId: string;
  productId: string;
  productName: string;
  bin: string;
  state: string;
  feeMinor: string;
  fundingMinor: string;
  last4: string;
  errorCode: string;
  createdAt: string;
  cardId: string;
  parentId: string;
};
export const statuses: Record<string, string> = {
  draft: "草稿",
  active: "已上架",
  paused: "暂停新开卡",
  archived: "已归档",
  queued: "等待预占",
  reserved: "资金已预占",
  creating: "正在发卡",
  provider_unknown: "渠道结果待核查",
  created: "已发卡 · 待收取开卡费",
  fee_charged: "已收费 · 待首充",
  funded: "首充已记账 · 待启用",
  enabling: "正在核验消费限制",
  releasing: "正在退回预占",
  failed: "开卡未完成",
  funding_failed: "首充失败 · 待充值",
  review_required: "需人工核查",
  submitted: "待复核",
  approved: "已复核 · 待入账",
  rejected: "已拒绝",
  applied: "已入账",
};
export const reasons: Record<string, string> = {
  product_unconfigured: "产品费用或最低首充未配置",
  source_product_inactive: "上游产品不可用",
  provider_access_blocked: "渠道访问被拒绝，等待运营恢复",
  product_paused: "该 BIN 暂停新开卡",
  supplier_paused: "供应商暂停新开卡",
  customer_not_enabled: "客户尚未获开卡资格",
  cardholder_not_verified: "持卡人尚未核验",
  execution_disabled: "真实开卡服务尚未启用",
  provider_not_verified: "该供应商尚未完成真实发卡验证",
  issuing_not_enabled: "服务或客户资格尚未开通",
  configuration_changed: "配置或报价已变更，请刷新后重新确认",
  insufficient_wallet_balance: "钱包余额不足",
  permission_required: "没有该操作权限",
  not_found: "记录不存在或没有访问权限",
  record_conflict: "记录重复或关联无效，请刷新后检查",
  invalid_issuing_request: "请检查输入内容和金额",
  temporarily_unavailable: "服务暂时不可用，请稍后重试",
  provider_outcome_unknown: "渠道结果未知，资金保持预占，请勿重复开卡",
  funding_rejected: "首充未完成，开卡费已收取，首充金额已退回",
  execution_not_enabled: "执行资格已停用",
  creation_failed: "创建失败，预占已释放",
};
export function money(v: unknown) {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) return "未知";
  const n = BigInt(v),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}
export function toMinor(v: string) {
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(v))
    throw new Error("金额须为非负数，最多两位小数");
  const [a, b = ""] = v.split(".");
  return (BigInt(a) * 100n + BigInt(b.padEnd(2, "0"))).toString();
}
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function issuingPath(method: string, path: string) {
  if (path.includes("#") || path.split("?").length > 2) return false;
  const [p, q = ""] = path.split("?");
  const params = new URLSearchParams(q);
  if (
    [...params.keys()].some(
      (k) =>
        !["page", "q", "status"].includes(k) || params.getAll(k).length !== 1,
    ) ||
    (method !== "GET" && q)
  )
    return false;
  if (method === "GET")
    return (
      new RegExp(
        `^/admin-api/v1/card-issuing/(suppliers|products|groups|audit)(/${uuid})?$`,
      ).test(p) ||
      new RegExp(
        `^/(client|admin)-api/v1/customers/${uuid}/card-issuing/(products|wallet|orders)(/${uuid})?$`,
      ).test(p) ||
      new RegExp(
        `^/admin-api/v1/customers/${uuid}/card-issuing/(enrollment|deposits|audit|reconciliation)$`,
      ).test(p)
    );
  if (method !== "POST") return false;
  return (
    new RegExp(
      `^/admin-api/v1/card-issuing/(suppliers|products|groups)(/${uuid})?$`,
    ).test(p) ||
    p === "/admin-api/v1/card-issuing/prices" ||
    new RegExp(
      `^/admin-api/v1/customers/${uuid}/card-issuing/(enrollment|deposits)$`,
    ).test(p) ||
    new RegExp(
      `^/admin-api/v1/customers/${uuid}/card-issuing/(deposit-reviews|recoveries)/${uuid}$`,
    ).test(p) ||
    new RegExp(
      `^/client-api/v1/customers/${uuid}/card-issuing/(quotes|orders|topups)$`,
    ).test(p)
  );
}

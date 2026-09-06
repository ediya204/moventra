import type { Card, Entry } from "./model";
export const LOW_BALANCE = 20000;
export const cardStatus = (c: Card) =>
  c.slash && c.slash.source.status !== "active" ? (Object.hasOwn(statusLabels,c.slash.source.status||"") ? c.slash.source.status! : "unknown") : c.riskFrozen ? "risk" : c.frozen ? "frozen" : "active";
export const statusLabels: Record<string, string> = {
  all: "全部卡片",
  active: "使用中",
  frozen: "自助冻结",
  risk: "风控冻结",
  paused:"来源已暂停", inactive:"来源未激活", closed:"来源已关闭", unknown:"未知状态",
};
export type CardQuery = {
  q: string;
  status: string;
  platform: string;
  productId: string;
  min: string;
  max: string;
  start: string;
  end: string;
  low: boolean;
  sort: string;
  direction: "asc" | "desc";
  page: number;
  size: number;
};
const digits = (v: string | null, fallback: number) =>
  v && /^\d+$/.test(v) && Number.isSafeInteger(Number(v))
    ? Number(v)
    : fallback;
export function readCardQuery(params: URLSearchParams): CardQuery {
  const status = params.get("status") || "all",
    sort = params.get("sort") || "created";
  return {
    q: params.get("q") || "",
    status: Object.hasOwn(statusLabels, status) ? status : "all",
    platform: params.get("platform") || "",
    productId: params.get("productId") || "",
    min: params.get("min") || "",
    max: params.get("max") || "",
    start: params.get("start") || "",
    end: params.get("end") || "",
    low: params.get("low") === "1",
    sort: ["created", "balance", "name"].includes(sort) ? sort : "created",
    direction: params.get("direction") === "asc" ? "asc" : "desc",
    page: Math.max(1, digits(params.get("page"), 1)),
    size: [10, 20, 50].includes(digits(params.get("size"), 10))
      ? digits(params.get("size"), 10)
      : 10,
  };
}
const amountBound = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 1e9
    ? Math.round(Number(v) * 100)
    : NaN;
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function queryError(q: CardQuery): string {
  if (
    (q.min && !Number.isFinite(amountBound(q.min))) ||
    (q.max && !Number.isFinite(amountBound(q.max)))
  )
    return "余额请输入非负数，最多两位小数。";
  if (q.min && q.max && amountBound(q.min) > amountBound(q.max))
    return "最低余额不能大于最高余额。";
  if ((q.start && !validDate(q.start)) || (q.end && !validDate(q.end)))
    return "请选择有效的开卡日期。";
  if (q.start && q.end && q.start > q.end) return "开始日期不能晚于结束日期。";
  return "";
}
export function filterCards(cards: Card[], q: CardQuery): Card[] {
  if (queryError(q)) return [];
  return cards
    .filter(
      (c) =>
        (!q.q ||
          `${c.binProduct?.binPrefix||''} ${c.binProduct?.name||''} ${c.last4||''} ${c.name} ${c.id} ${c.project || ""}`
            .toLowerCase()
            .includes(q.q.trim().toLowerCase())) &&
        (!q.productId || c.binProduct?.id===q.productId) &&
        (q.status === "all" || cardStatus(c) === q.status) &&
        (!q.platform || (c.platform || "未分类") === q.platform) &&
        (!q.low || c.balance < LOW_BALANCE) &&
        (!q.min || c.balance >= amountBound(q.min)) &&
        (!q.max || c.balance <= amountBound(q.max)) &&
        (!q.start || (!!c.createdAt && c.createdAt.slice(0,10) >= q.start)) &&
        (!q.end || (!!c.createdAt && c.createdAt.slice(0,10) <= q.end)),
    )
    .sort((a, b) => {
      const result =
        q.sort === "balance"
          ? a.balance - b.balance
          : q.sort === "name"
            ? a.name.localeCompare(b.name, "zh-CN")
            : (a.createdAt || "").localeCompare(b.createdAt || "");
      return (
        (q.direction === "asc" ? result : -result) || a.id.localeCompare(b.id)
      );
    });
}
export function pageCards(cards: Card[], query: CardQuery) {
  const pages = Math.max(1, Math.ceil(cards.length / query.size)),
    page = Math.min(query.page, pages);
  return {
    page,
    rows: cards.slice((page - 1) * query.size, page * query.size),
  };
}
export const cardRecordTab = (e: Entry) =>
  e.slash || ["消费", "退款"].includes(e.kind)
    ? "transactions"
    : e.ledgerOperationId || ["卡片充值", "卡片转回"].includes(e.kind)
      ? "funds"
      : "activity";
export function cardHref(
  id: string | undefined,
  params: URLSearchParams,
  recordId?: string,
) {
  const query = params.toString();
  return `/portal/cards${id ? "/" + encodeURIComponent(id) : ""}${recordId ? "/records/" + encodeURIComponent(recordId) : ""}${query ? "?" + query : ""}`;
}
export function csvCell(value: string): string {
  return (
    '"' +
    (/^[\s]*[=+@\-]/.test(value) ? "'" : "") +
    value.replaceAll('"', '""') +
    '"'
  );
}

import { safeSource, statuses, details } from "../model.mjs";
export const NS = "fx-cross-currency-v1";
export const AS_OF = "2026-09-06T12:00:00.000Z";
export const categories = [
  "purchase",
  "refund",
  "fee",
  "fee_reversal",
  "cashback",
  "cashback_adjustment",
  "adjustment",
];
export function integer(v) {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isSafeInteger(v))
    throw new Error("Unsafe amount: use lossless source parsing");
  const s = String(v);
  if (!/^(0|-?[1-9]\d*)$/.test(s) || s.length > 31)
    throw new Error("Amount must be a bounded integer string");
  return s;
}
export function rate(v) {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isFinite(v))
    throw new Error("Invalid rate");
  let s = String(v);
  if (!/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(s))
    throw new Error("Rate must be an exact nonnegative decimal");
  return s;
}
export function parseSourceJSON(raw) {
  return JSON.parse(raw, (key, value, context) =>
    typeof value === "number" ? context.source : value,
  );
}
export function money(minor, currency, scale) {
  return minor == null || scale == null
    ? null
    : { minor: String(minor), currency, scale };
}
export function ratio(account, original, accountScale, originalScale) {
  if (
    account == null ||
    original == null ||
    accountScale == null ||
    originalScale == null ||
    BigInt(original) === 0n
  )
    return null;
  const abs = (n) => (n < 0n ? -n : n);
  const n =
    (abs(BigInt(account)) * 10n ** BigInt(originalScale + 12)) /
    (abs(BigInt(original)) * 10n ** BigInt(accountScale));
  return `${n / 1000000000000n}.${String(n % 1000000000000n).padStart(12, "0")}`;
}
// API transport normalizes numeric source fields to decimal strings; storage never rounds via Number.
export function sourceProjection(input) {
  const s = safeSource("transaction", input);
  if (s.amountCents != null) s.amountCents = integer(s.amountCents);
  if (s.originalCurrency) {
    if (s.originalCurrency.amountCents != null)
      s.originalCurrency.amountCents = integer(s.originalCurrency.amountCents);
    if (s.originalCurrency.conversionRate != null)
      s.originalCurrency.conversionRate = rate(
        s.originalCurrency.conversionRate,
      );
  }
  for (const k of ["fxFeeInfo", "cashbackInfo"])
    if (s[k]?.amountCents != null) s[k].amountCents = integer(s[k].amountCents);
  if (s.cashbackInfo?.rate != null)
    s.cashbackInfo.rate = rate(s.cashbackInfo.rate);
  if (s.feeInfo?.relatedTransaction?.amount != null)
    s.feeInfo.relatedTransaction.amount = String(
      s.feeInfo.relatedTransaction.amount,
    );
  return s;
}
export function normalize(source, internal) {
  const s = sourceProjection(source),
    platform = internal.platform || "slash";
  const scale = platform === "slash" ? 2 : (internal.accountScale ?? null),
    currency =
      platform === "slash" ? "USD" : (internal.accountCurrency ?? null);
  const originalCurrency =
    s.originalCurrency?.code || (platform === "slash" ? "USD" : null);
  for (const k of ["accountScale", "originalScale"])
    if (
      internal[k] != null &&
      (!Number.isInteger(internal[k]) || internal[k] < 0 || internal[k] > 8)
    )
      throw new Error("Currency scale out of range");
  const originalScale = originalCurrency
    ? ({ USD: 2, CNY: 2, AED: 2, EUR: 2 }[originalCurrency] ??
      internal.originalScale ??
      null)
    : null;
  const original = integer(s.originalCurrency?.amountCents ?? null); // Currency default does not invent a missing original amount.
  const postedAt = s.status === "posted" ? s.date : null;
  const issues = [];
  if (!statuses[s.status] || !details[s.detailedStatus])
    issues.push("未知来源状态");
  if (s.amountCents == null) issues.push("账户金额缺失");
  if (originalCurrency && originalScale == null) issues.push("原币单位待确认");
  if (s.originalCurrency && !s.originalCurrency.conversionRate)
    issues.push("来源汇率缺失");
  if (
    internal.category === "purchase" &&
    (!internal.feeTreatment || internal.feeTreatment === "unknown")
  )
    issues.push("费用入账方式待确认");
  if (internal.matching === "unmatched") issues.push("缺少可靠原交易关联");
  if (internal.fault) issues.push(internal.fault);
  return {
    source: s,
    currency,
    scale,
    originalCurrency,
    originalScale,
    original,
    postedAt,
    issues,
  };
}
export function rowDTO(r) {
  const s = sourceProjection(JSON.parse(r.source_json)),
    i = JSON.parse(r.internal_json),
    n = normalize(s, i);
  return {
    id: r.id,
    sourceKind: r.source_kind || "fx",
    crossCurrency:
      r.original_currency && r.account_currency
        ? r.original_currency === r.account_currency
          ? "same"
          : "cross"
        : "unknown",
    sourceId: r.source_id,
    connectionId: r.connection_id,
    entityId: r.entity_id,
    platform: r.platform,
    scenario: r.scenario,
    source: s,
    sourceNumericEncoding: "decimal-string",
    category: r.category,
    balanceType: r.balance_type,
    accountAmount: money(r.amount_minor, r.account_currency, r.account_scale),
    originalAmount: money(
      r.original_minor,
      r.original_currency,
      r.original_scale,
    ),
    originalCurrency: r.original_currency,
    originalRawMinor: r.original_minor,
    providerRate: r.provider_rate,
    displayRatio: ratio(
      r.amount_minor,
      r.original_minor,
      r.account_scale,
      r.original_scale,
    ),
    ratioBasis: "实际账户金额/原币金额，截断至12位，仅展示",
    status: r.status,
    statusLabel: statuses[r.status] || `未知状态 (${r.status})`,
    detailedStatus: r.detailed_status,
    detailedStatusLabel:
      details[r.detailed_status] || `未知状态 (${r.detailed_status})`,
    authorizedAt: r.authorized_at,
    sourceDate: s.date ?? null,
    postedAt: r.posted_at,
    dateMeaning:
      r.status === "posted"
        ? "入账时间"
        : ["pending", "failed"].includes(r.status)
          ? "创建时间"
          : "日期语义待确认",
    collectedAt: r.collected_at,
    feeTreatment: i.feeTreatment || "unknown",
    matching: i.matching || "unmatched",
    syncState: r.sync_state,
    issues: [
      ...n.issues,
      ...(r.sync_state === "current" ? [] : ["采集不完整，需补同步"]),
    ],
    assumption: i.assumption || "内部Demo假设",
    sourceComplete: false,
  };
}

import type { Currency, Entry, State } from "./model";

const dayMs = 86400000;
function dayNumber(value: string) {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === day
    ? time
    : null;
}

// Calendar dates are taken literally from source records; do not shift them by timezone.
export function spendingTrend(entries: Entry[], days: 7 | 30) {
  const dates = entries
    .map((entry) => dayNumber(entry.time))
    .filter((date): date is number => date !== null);
  if (!dates.length) return [];
  const end = Math.max(...dates);
  const rows = Array.from({ length: days }, (_, index) => ({
    day: new Date(end - (days - index - 1) * dayMs).toISOString().slice(0, 10),
    spend: 0,
    refund: 0,
  }));
  const lookup = new Map(rows.map((row) => [row.day, row]));
  for (const entry of entries) {
    if (
      entry.status !== "已完成" ||
      (entry.currency ?? "USD") !== "USD" ||
      !Number.isSafeInteger(entry.amount) ||
      dayNumber(entry.time) === null
    )
      continue;
    const row = lookup.get(entry.time.slice(0, 10));
    if (!row) continue;
    if (entry.kind === "消费" && entry.amount < 0) row.spend += -entry.amount;
    if (entry.kind === "退款" && entry.amount > 0) row.refund += entry.amount;
  }
  return rows;
}

export function assetComposition(state: State, currency: Currency) {
  const f = state.finance;
  if (currency === "USDT")
    return [
      { label: "账户可用", value: f.usdt, icon: "solar:wallet-money-linear" },
      {
        label: "冻结 / 预占",
        value: f.heldUsdt,
        icon: "solar:lock-keyhole-linear",
      },
    ];
  return [
    {
      label: "账户可用",
      value: state.balance,
      icon: "solar:wallet-money-linear",
    },
    {
      label: "内部卡预算",
      value: state.cards.reduce((sum, card) => sum + card.balance, 0),
      icon: "solar:card-linear",
    },
    {
      label: "子账户余额",
      value: Object.values(f.subBalances).reduce(
        (sum, value) => sum + value,
        0,
      ),
      icon: "solar:users-group-rounded-linear",
    },
    {
      label: "冻结 / 预占",
      value: f.heldUsd,
      icon: "solar:lock-keyhole-linear",
    },
    {
      label: "卡片转回在途",
      value: f.orders
        .filter(
          (order) =>
            order.kind === "卡片转回" &&
            ["处理中", "待核实"].includes(order.status),
        )
        .reduce((sum, order) => sum + order.amount, 0),
      icon: "solar:transfer-horizontal-linear",
    },
  ];
}

export function cardComposition(state: State) {
  return [
    {
      label: "使用中",
      value: state.cards.filter((card) => !card.frozen).length,
      icon: "solar:card-linear",
    },
    {
      label: state.unified ? "来源暂停 / 内部冻结" : "自助冻结",
      value: state.cards.filter((card) => card.frozen && !card.riskFrozen)
        .length,
      icon: "solar:lock-keyhole-linear",
    },
    {
      label: "风控冻结",
      value: state.cards.filter((card) => card.riskFrozen).length,
      icon: "solar:shield-warning-linear",
    },
  ];
}

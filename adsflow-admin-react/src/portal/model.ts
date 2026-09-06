import {assertPersonalAction} from "./personalV1.ts";
import type {SourceRecord,SourceFields} from '../slash/types';
export type BinSnapshot={id:string;name:string;binPrefix:string;network:string;currency:string;revision:number;mode:string};
export type Card = {
  binProduct?: BinSnapshot;
  id: string;
  name: string;
  balance: number;
  frozen: boolean;
  riskFrozen?: boolean;
  balanceKind?: "internal_budget" | "managed_ledger";
  management?: {reason:string|null;actor:string|null;operatedAt:string|null;providerStatus:string;revision:number;funding:boolean};
  last4?: string;
  slash?: SourceRecord;
  sourceBalance?: SourceFields;
  platform?: string;
  project?: string;
  createdAt?: string;
};
export type Entry = {
  ledgerOperationId?: string;
  nonFinancial?: boolean;
  id: string;
  time: string;
  kind: string;
  name: string;
  amount: number;
  status: "已完成" | "处理中" | "失败" | "未知状态";
  card?: string;
  currency?: Currency;
  orderId?: string;
  statusText?: string;
  cardSummary?: Pick<Card, "id" | "name" | "last4">;
  financeSummary?: Pick<Order, "id" | "status" | "currency" | "toCurrency" | "fee" | "receive">;
  slash?: SourceRecord;
};
export type Notice = {id:string;text:string;read:boolean;title?:string;category?:'card'|'funds'|'system';createdAt?:string;cardId?:string;orderId?:string};
export type State = {
  unified?: boolean;
  revision?: number;
  entryCount?: number;
  analytics?: Record<7 | 30, {day:string;spend:number;refund:number}[]>;
  balance: number;
  finance: FinanceState;
  cards: Card[];
  entries: Entry[];
  notices: Notice[];
  onboarding: "未提交" | "待审核";
  tickets: string[];
  application?: { name: string; email: string };
};
export function initialState(): State {
  return {
    balance: 2845000,
    finance: {
      usdt: 5000_000000,
      heldUsdt: 0,
      heldUsd: 0,
      addresses: [],
      orders: [],
      quotes: [],
      subBalances: {},
      events: [],
    },
    cards: [
      {
        id: "1001",
        name: "Meta · 北美增长",
        platform: "Meta",
        project: "北美增长",
        createdAt: "2026-08-12",
        balance: 480000,
        frozen: false,
      },
      {
        id: "1002",
        name: "Google · 品牌搜索",
        platform: "Google",
        project: "品牌搜索",
        createdAt: "2026-08-20",
        balance: 12500,
        frozen: false,
      },
      {
        id: "1003",
        name: "TikTok · 创意测试",
        platform: "TikTok",
        project: "创意测试",
        createdAt: "2026-09-01",
        balance: 96000,
        frozen: true,
        riskFrozen: true,
      },
    ],
    entries: [
      {
        id: "DEMO-T001",
        time: "2026-09-06 09:42",
        kind: "消费",
        name: "META ADS",
        amount: -24850,
        status: "已完成",
        card: "1001",
      },
      {
        id: "DEMO-T002",
        time: "2026-09-06 08:30",
        kind: "消费",
        name: "GOOGLE ADS",
        amount: -15000,
        status: "失败",
        card: "1002",
      },
      {
        id: "DEMO-T003",
        time: "2026-09-05 16:20",
        kind: "退款",
        name: "META ADS",
        amount: 3500,
        status: "已完成",
        card: "1001",
      },
    ],
    notices: [
      {
        id: "N1",
        title: "卡片预算不足", category: "card", cardId: "1002",
        text: "Google · 品牌搜索余额低于 200 USD，请及时补充。",
        read: false,
      },
      {
        id: "N2",
        title: "卡片已被风控冻结", category: "card", cardId: "1003",
        text: "TikTok · 创意测试被风控冻结，请联系支持处理。",
        read: false,
      },
    ],
    onboarding: "未提交",
    tickets: [],
  };
}
export type Action =
  | FinanceAction
  | { type: "open"; name: string; productId?:string; productRevision?:number }
  | { type: "topup"; id: string; amount: number; source?: "main" }
  | { type: "freeze"; id: string }
  | { type: "read"; ids?:string[]; read?:boolean }
  | { type: "onboard"; name: string; email: string }
  | { type: "ticket"; text: string };
export function transition(
  state: State,
  action: Action,
  id: string,
  time: string,
): State {
  assertPersonalAction(action);
  if (action.type.startsWith("finance/"))
    return financeTransition(state, action as FinanceAction, id, time);
  const s = structuredClone(state);
  const entry = (
    kind: string,
    name: string,
    amount: number,
    status: Entry["status"],
    card?: string,
  ) => s.entries.unshift({ id, time, kind, name, amount, status, card });
  const positive = (amount: number) => {
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error("请输入有效金额，最多两位小数。");
  };
  switch (action.type) {
    case "open":
      if (!action.name.trim())
        throw new Error("请填写卡片名称。");
      s.cards.push({
        id,
        name: action.name.trim(),
        createdAt: time.slice(0, 10),
        platform: "未分类",
        project: "未分组",
        balance: 0,
        frozen: false,
      });
      entry("开卡", action.name.trim(), 0, "已完成", id);
      break;
    case "topup": {
      positive(action.amount);
      const card = s.cards.find((c) => c.id === action.id);
      if (!card || card.frozen) throw new Error("卡片不存在或已冻结。");
      if (action.amount > s.balance) throw new Error("付款账户可用余额不足。");
      s.balance -= action.amount;
      card.balance += action.amount;
      entry("卡片充值", card.name, -action.amount, "已完成", card.id);
      s.entries[0].orderId = id;
      s.finance.orders.unshift({
        id,
        kind: "卡片充值",
        currency: "USD",
        toCurrency: "USD",
        amount: action.amount,
        receive: action.amount,
        fee: 0,
        status: "已完成",
        created: time,
        cardId: card.id,
        target: `个人账户 → ${card.name}`,
        history: [{ time, text: "模拟卡片充值完成" }],
      });
      break;
    }
    case "freeze": {
      const card = s.cards.find((c) => c.id === action.id);
      if (!card || card.riskFrozen)
        throw new Error("风控冻结需联系支持，无法自行解除。");
      card.frozen = !card.frozen;
      entry(card.frozen ? "冻结" : "解冻", card.name, 0, "已完成", card.id);
      break;
    }
    case "read":
      if (action.read !== undefined && typeof action.read !== 'boolean') throw new Error('已读状态无效');
      if (action.ids !== undefined && (!Array.isArray(action.ids) || !action.ids.length || action.ids.length > 100 || action.ids.some(id => typeof id !== 'string' || !s.notices.some(n=>n.id===id)))) throw new Error('请选择有效消息，单次最多100条');
      if (action.read === false && !action.ids) throw new Error('标为未读需选择消息');
      s.notices.forEach((n) => {if (!action.ids || action.ids.includes(n.id)) n.read = action.read ?? true;});
      break;
    case "onboard":
      if (
        !action.name.trim() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.email)
      )
        throw new Error("请填写开户姓名和有效邮箱。");
      s.application = { name: action.name.trim(), email: action.email };
      s.onboarding = "待审核";
      break;
    case "ticket":
      if (action.text.trim().length < 5)
        throw new Error("请至少输入 5 个字描述问题。");
      s.tickets.unshift(action.text.trim());
      break;
  }
  if (action.type !== "read")
    s.notices.unshift({
      id,
      createdAt: time,
      category: ['open','topup','freeze'].includes(action.type) ? 'card' : 'system',
      title: ({open:'卡片已创建',topup:'卡片充值已完成',freeze:'卡片状态已更新',onboard:'开户资料已提交',ticket:'支持请求已提交'} as Record<string,string>)[action.type],
      cardId: action.type==='open' ? id : action.type==='topup'||action.type==='freeze' ? action.id : undefined,
      orderId: action.type==='topup' ? id : undefined,
      text: `演示操作已记录：${action.type === "onboard" ? "开户资料待审核" : "请在相关页面查看结果"}`,
      read: false,
    });
  return s;
}
export function cents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("请输入正数金额，最多两位小数。");
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("金额超出范围。");
  return amount;
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );

// Synthetic finance engine. No network calls, wallet credentials or real addresses.
export type Currency = "USD" | "USDT";
export const FINANCE_POLICY = {
  network: "TRON · TRC20（演示）",
  depositAddress: "DEMO:USDT:TRON:DO-NOT-SEND",
  minDeposit: 10_000000,
  minWithdraw: 10_000000,
  maxWithdraw: 100000_000000,
  withdrawalFee: 2_000000,
  quoteMs: 60000,
} as const;
export type Address = {
  id: string;
  label: string;
  address: string;
  network: string;
  enabled: boolean;
};
export type Quote = {
  id: string;
  from: Currency;
  to: Currency;
  amount: number;
  fee: number;
  receive: number;
  expires: number;
  used: boolean;
};
export type Order = {
  id: string;
  kind: "充值" | "兑换" | "提现" | "卡片转回" | "卡片充值" | "内部划拨";
  currency: Currency;
  amount: number;
  fee: number;
  receive: number;
  toCurrency: Currency;
  status:
    | "待检测"
    | "确认中"
    | "需核查"
    | "待审核"
    | "处理中"
    | "待核实"
    | "已完成"
    | "已取消"
    | "已拒绝"
    | "失败";
  created: string;
  network?: string;
  address?: string;
  tx?: string;
  cardId?: string;
  quoteId?: string;
  target?: string;
  history: { time: string; text: string }[];
};
export type FinanceState = {
  usdt: number;
  heldUsdt: number;
  heldUsd: number;
  addresses: Address[];
  orders: Order[];
  quotes: Quote[];
  /** Historical storage only. No V1 operation can spend these balances. */
  subBalances: Record<string, number>;
  legacyRestrictedUsd?: number;
  events: string[];
};
export type FinanceAction =
  | { type: "finance/deposit"; amount: number }
  | { type: "finance/quote"; from: Currency; amount: number; now: number }
  | { type: "finance/exchange"; quoteId: string; now: number }
  | { type: "finance/address"; label: string; address: string }
  | { type: "finance/address-toggle"; addressId: string }
  | {
      type: "finance/withdraw";
      addressId: string;
      amount: number;
      verified: boolean;
    }
  | { type: "finance/cancel"; orderId: string }
  | { type: "finance/card-return"; cardId: string; amount: number }
  | {
      type: "finance/simulate";
      orderId: string;
      event:
        | "detect"
        | "review"
        | "approve"
        | "reject"
        | "unknown"
        | "complete"
        | "fail";
      eventId: string;
    };
export function units(value: string, currency: Currency): number {
  const precision = currency === "USD" ? 2 : 6;
  if (!new RegExp(`^\\d+(\\.\\d{1,${precision}})?$`).test(value.trim()))
    throw new Error(`请输入有效正数，${currency} 最多 ${precision} 位小数。`);
  const [whole, fraction = ""] = value.trim().split(".");
  const amount =
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, "0"));
  if (amount <= 0n || amount > 1000000n * 10n ** BigInt(precision))
    throw new Error("单笔金额须大于 0，且不超过演示上限 1,000,000。");
  return Number(amount);
}
export function asset(value: number, currency: Currency = "USD"): string {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: currency === "USD" ? 2 : 6 }).format(value / (currency === "USD" ? 100 : 1000000))} ${currency}`;
}
export function financeTransition(
  state: State,
  action: FinanceAction,
  id: string,
  time: string,
): State {
  assertPersonalAction(action);
  const s = structuredClone(state);
  const f = s.finance;
  const positive = (value: number) => {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("金额必须是有效正数。");
  };
  const checked = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("余额范围异常。");
    return value;
  };
  const balance = (c: Currency) => (c === "USD" ? s.balance : f.usdt);
  const move = (c: Currency, amount: number) => {
    const next = checked(balance(c) + amount);
    if (c === "USD") s.balance = next;
    else f.usdt = next;
  };
  const hold = (c: Currency, amount: number) => {
    if (c === "USD") f.heldUsd = checked(f.heldUsd + amount);
    else f.heldUsdt = checked(f.heldUsdt + amount);
  };
  const reserve = (c: Currency, amount: number) => {
    if (balance(c) < amount) throw new Error(`${c} 可用余额不足。`);
    move(c, -amount);
    hold(c, amount);
  };
  const history = (o: Order, text: string) => o.history.push({ time, text });
  const makeOrder = (data: Omit<Order, "id" | "created" | "history">) => {
    const o: Order = {
      ...data,
      id,
      created: time,
      history: [{ time, text: data.status }],
    };
    f.orders.unshift(o);
    return o;
  };
  const record = (o: Order, amount: number) =>
    s.entries.unshift({
      id: o.id,
      orderId: o.id,
      time,
      kind: o.kind,
      name:
        o.target ||
        `${o.kind} · ${o.currency}${o.kind === "兑换" ? ` → ${o.toCurrency}` : ""}`,
      amount,
      currency: o.currency,
      status: o.status === "已完成" ? "已完成" : "处理中",
      card: o.cardId,
    });
  const order = (oid: string) => {
    const o = f.orders.find((o) => o.id === oid);
    if (!o) throw new Error("未找到订单。");
    return o;
  };
  const release = (o: Order) => {
    const total = o.kind === "提现" ? o.amount + o.fee : o.amount;
    hold(o.currency, -total);
    move(o.currency, total);
  };
  switch (action.type) {
    case "finance/deposit": {
      positive(action.amount);
      if (action.amount < FINANCE_POLICY.minDeposit)
        throw new Error("演示最低充值为 10 USDT。");
      const o = makeOrder({
        kind: "充值",
        currency: "USDT",
        toCurrency: "USDT",
        amount: action.amount,
        receive: action.amount,
        fee: 0,
        status: "待检测",
        network: FINANCE_POLICY.network,
        address: FINANCE_POLICY.depositAddress,
      });
      record(o, o.amount);
      break;
    }
    case "finance/quote": {
      positive(action.amount);
      if (!Number.isFinite(action.now)) throw new Error("报价时间无效。");
      const fee = Number((BigInt(action.amount) * 5n + 999n) / 1000n); // 0.5%, rounded upward in source minor units.
      const net = BigInt(action.amount - fee);
      const receive = Number(
        action.from === "USDT"
          ? (net * 997n * 100n) / (1000n * 1000000n)
          : (net * 1001n * 1000000n) / (1000n * 100n),
      );
      positive(receive);
      checked(receive);
      f.quotes.unshift({
        id,
        from: action.from,
        to: action.from === "USD" ? "USDT" : "USD",
        amount: action.amount,
        fee,
        receive,
        expires: action.now + FINANCE_POLICY.quoteMs,
        used: false,
      });
      break;
    }
    case "finance/exchange": {
      const q = f.quotes.find((q) => q.id === action.quoteId);
      if (
        !q ||
        q.used ||
        !Number.isFinite(action.now) ||
        action.now >= q.expires
      )
        throw new Error("报价已失效，请重新获取并确认。");
      reserve(q.from, q.amount);
      q.used = true;
      const o = makeOrder({
        kind: "兑换",
        currency: q.from,
        toCurrency: q.to,
        amount: q.amount,
        fee: q.fee,
        receive: q.receive,
        status: "处理中",
        quoteId: q.id,
      });
      record(o, -o.amount);
      break;
    }
    case "finance/address": {
      const address = action.address.trim();
      if (
        !action.label.trim() ||
        !/^DEMO:TRON:[A-Za-z0-9_-]{3,40}$/.test(address)
      )
        throw new Error(
          "请输入备注和演示地址，如 DEMO:TRON:my-wallet；不接受真实钱包地址。",
        );
      if (f.addresses.some((a) => a.address === address))
        throw new Error("地址已存在。");
      f.addresses.push({
        id,
        label: action.label.trim(),
        address,
        network: FINANCE_POLICY.network,
        enabled: true,
      });
      break;
    }
    case "finance/address-toggle": {
      const a = f.addresses.find((a) => a.id === action.addressId);
      if (!a) throw new Error("未找到地址。");
      a.enabled = !a.enabled;
      break;
    }
    case "finance/withdraw": {
      positive(action.amount);
      const a = f.addresses.find((a) => a.id === action.addressId && a.enabled);
      if (!a || !action.verified)
        throw new Error("请选择可用地址并完成演示二次确认。");
      if (
        action.amount < FINANCE_POLICY.minWithdraw ||
        action.amount > FINANCE_POLICY.maxWithdraw
      )
        throw new Error("演示单笔提现范围为 10–100,000 USDT。");
      reserve("USDT", action.amount + FINANCE_POLICY.withdrawalFee);
      const o = makeOrder({
        kind: "提现",
        currency: "USDT",
        toCurrency: "USDT",
        amount: action.amount,
        fee: FINANCE_POLICY.withdrawalFee,
        receive: action.amount,
        status: "待审核",
        address: a.address,
        network: a.network,
        target: a.label,
      });
      record(o, -(o.amount + o.fee));
      break;
    }
    case "finance/cancel": {
      const o = order(action.orderId);
      if (o.kind !== "提现" || o.status !== "待审核")
        throw new Error("仅待审核提现可以取消。");
      release(o);
      o.status = "已取消";
      history(o, "客户取消，预占金额已释放");
      break;
    }
    case "finance/card-return": {
      positive(action.amount);
      const c = s.cards.find((c) => c.id === action.cardId);
      if (!c || c.frozen || c.balance < action.amount)
        throw new Error("卡片不可转回或可转回余额不足。");
      c.balance -= action.amount;
      const o = makeOrder({
        kind: "卡片转回",
        currency: "USD",
        toCurrency: "USD",
        amount: action.amount,
        fee: 0,
        receive: action.amount,
        status: "处理中",
        cardId: c.id,
        target: c.name,
      });
      record(o, o.amount);
      break;
    }
    case "finance/simulate": {
      if (f.events.includes(action.eventId)) return state;
      const o = order(action.orderId);
      const event = action.event;
      if (o.kind === "充值") {
        if (event === "detect" && o.status === "待检测") {
          o.status = "确认中";
          o.tx = `DEMO-TX-${o.id}`;
        } else if (event === "review" && o.status === "确认中")
          o.status = "需核查";
        else if (
          event === "complete" &&
          ["确认中", "需核查"].includes(o.status)
        ) {
          move("USDT", o.receive);
          o.status = "已完成";
        } else throw new Error("该充值状态不允许此操作。");
      } else if (o.kind === "提现") {
        if (event === "approve" && o.status === "待审核") o.status = "处理中";
        else if (event === "reject" && o.status === "待审核") {
          release(o);
          o.status = "已拒绝";
        } else if (event === "unknown" && o.status === "处理中")
          o.status = "待核实";
        else if (
          event === "complete" &&
          ["处理中", "待核实"].includes(o.status)
        ) {
          hold("USDT", -(o.amount + o.fee));
          o.status = "已完成";
          o.tx = `DEMO-TX-${o.id}`;
        } else if (
          event === "fail" &&
          ["处理中", "待核实"].includes(o.status)
        ) {
          release(o);
          o.status = "失败";
        } else throw new Error("该提现状态不允许此操作。");
      } else if (o.kind === "兑换" || o.kind === "卡片转回") {
        if (event === "unknown" && o.status === "处理中") o.status = "待核实";
        else if (
          ["complete", "fail"].includes(event) &&
          ["处理中", "待核实"].includes(o.status)
        ) {
          if (o.kind === "兑换") {
            if (event === "complete") {
              hold(o.currency, -o.amount);
              move(o.toCurrency, o.receive);
            } else release(o);
          } else {
            const card = s.cards.find((c) => c.id === o.cardId);
            if (!card) throw new Error("未找到原卡片");
            if (event === "complete") move("USD", o.receive);
            else card.balance = checked(card.balance + o.amount);
          }
          o.status = event === "complete" ? "已完成" : "失败";
        } else throw new Error("该订单状态不允许此操作。");
      } else throw new Error("此订单无需模拟处理。");
      history(
        o,
        `${event === "complete" ? "模拟最终结果成功" : event === "fail" ? "模拟确认失败，资金退回" : event === "unknown" ? "模拟超时，结果待核实，资金保持预占" : "模拟渠道 / 审核事件"}：${o.status}`,
      );
      f.events.push(action.eventId);
      break;
    }
  }
  for (const o of f.orders) {
    const e = s.entries.find((e) => e.orderId === o.id);
    if (e)
      e.status =
        o.status === "已完成"
          ? "已完成"
          : ["已取消", "已拒绝", "失败"].includes(o.status)
            ? "失败"
            : "处理中";
  }
  if (action.type !== "finance/quote") {
    const oid = "orderId" in action ? action.orderId : id;
    const o = f.orders.find((o) => o.id === oid);
    s.notices.unshift({
      id,
      createdAt: time,
      category: 'funds',
      title: o ? `${o.kind} · ${o.status}` : '地址簿已更新',
      orderId: o?.id,
      text: o ? `${o.kind} ${o.id}：${o.status}` : "演示地址簿已更新",
      read: false,
    });
  }
  return s;
}

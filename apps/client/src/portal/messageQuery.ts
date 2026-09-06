import {isRetiredNotice} from "../../../../packages/shared/src/portal/personalV1.ts";
import type { Notice, State } from "./model.ts";
export const messageTypes: Record<string, string> = {
  card: "卡片通知",
  funds: "资金动态",
  system: "系统消息",
};
export type Message = Notice & {
  title: string;
  category: string;
  cardName?: string;
  orderName?: string;
};
export type MessagePage = {
  rows: Message[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; unread: number; read: number };
};
// Legacy relationships are recovered only from stored IDs or the exact old order notification format.
export function messageRows(state: State): Message[] {
  return state.notices.filter(n=>!isRetiredNotice(n)).map((n) => {
    const entry = state.entries.find((e) => e.id === n.id);
    const order = state.finance.orders.find(
      (o) =>
        o.id === n.orderId ||
        o.id === entry?.orderId ||
        n.text.startsWith(`${o.kind} ${o.id}：`),
    );
    const seedCard =
      n.id === "N1" &&
      n.text === "Google · 品牌搜索余额低于 200 USD，请及时补充。"
        ? "1002"
        : n.id === "N2" &&
            n.text === "TikTok · 创意测试被风控冻结，请联系支持处理。"
          ? "1003"
          : undefined;
    const card = state.cards.find(
      (c) => c.id === (n.cardId || entry?.card || seedCard),
    );
    const category =
      n.category ||
      (order
        ? "funds"
        : card
          ? "card"
          : n.text === "演示地址簿已更新"
            ? "funds"
            : "system");
    const date = n.createdAt || entry?.time;
    const title =
      n.title ||
      (seedCard
        ? seedCard === "1002"
          ? "卡片预算不足"
          : "卡片已被风控冻结"
        : order && n.text.startsWith(`${order.kind} ${order.id}：`)
          ? n.text.replace(`${order.kind} ${order.id}：`, `${order.kind} · `)
          : entry
            ? `${entry.kind}通知`
            : n.text.startsWith("演示操作已记录")
              ? "操作通知"
              : n.text);
    return {
      id: n.id,
      text: n.text,
      read: n.read,
      title,
      category,
      createdAt: date && /^\d{4}-\d{2}-\d{2}[T ]/.test(date) ? date : undefined,
      cardId: card?.id,
      cardName: card?.name,
      orderId: order?.id,
      orderName: order?.kind,
    };
  });
}
export function queryMessages(
  state: State,
  q: Record<string, unknown> = {},
): MessagePage {
  const page = Number(q.page ?? 0),
    pageSize = Number(q.pageSize ?? 10);
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new Error("分页参数无效");
  const all = messageRows(state),
    unread = all.filter((n) => !n.read).length;
  const keyword = String(q.keyword || "")
    .trim()
    .toLowerCase();
  const rows = all.filter(
    (n) =>
      (!q.status ||
        (q.status === "unread"
          ? !n.read
          : q.status === "read"
            ? n.read
            : false)) &&
      (!q.category || n.category === q.category) &&
      (!keyword ||
        `${n.id} ${n.title} ${n.text} ${n.cardName || ""} ${n.cardId || ""} ${n.orderId || ""}`
          .toLowerCase()
          .includes(keyword)),
  );
  // Existing storage is newest-first. Unknown historical times stay unknown.
  if (q.direction === "asc") rows.reverse();
  return {
    rows: rows.slice(page * pageSize, (page + 1) * pageSize),
    total: rows.length,
    page,
    pageSize,
    counts: { all: all.length, unread, read: all.length - unread },
  };
}

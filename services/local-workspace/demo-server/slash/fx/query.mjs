import {
  NS,
  AS_OF,
  rowDTO,
  money,
  sourceProjection,
  normalize,
} from "./model.mjs";
import { lookup, rebuildDaily } from "./store.mjs";
import { scenarios } from "./demo.mjs";
const error = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const number = (v, d, min, max) => {
  const n = v == null ? d : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) error("分页参数无效");
  return n;
};
const choice = (v, values, d) => {
  v = v || d;
  if (!values.includes(v)) error("查询口径无效");
  return v;
};
export function context(q = {}) {
  const timezone = choice(q.timezone, ["UTC", "Asia/Hong_Kong"], "UTC"),
    basis = choice(q.basis, ["posted", "order"], "posted"),
    from = q.from || "2026-08-01",
    to = q.to || "2026-09-30";
  for (const d of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
      !Number.isFinite(Date.parse(d)) ||
      new Date(d).toISOString().slice(0, 10) !== d
    )
      error("日期格式无效");
  if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000)
    error("时间范围须在366天内");
  return {
    from,
    to,
    timezone,
    basis,
    platform: q.platform || "全部",
    account: q.account || "全部",
    currency: q.currency || "全部",
    scenario: q.scenario || "全部",
    asOf: AS_OF,
    completeness: "仅已采集的本地 Demo，非完整平台历史",
    basisLabel:
      basis === "posted"
        ? "入账日期；待入账按来源创建日期"
        : "原消费入账月份；无可信关联的记录不归属订单月份",
  };
}
function filter(q, ns = NS) {
  const c = context(q),
    where = ["namespace=?"],
    args = [ns];
  for (const [key, col] of Object.entries({
    platform: "platform",
    account: "account_id",
    card: "card_id",
    currency: "account_currency",
    originalCurrency: "original_currency",
    scenario: "scenario",
    status: "status",
    detailedStatus: "detailed_status",
    category: "category",
    balanceType: "balance_type",
  }))
    if (q[key]) {
      where.push(`${col}=?`);
      args.push(q[key]);
    }
  if (q.q) {
    where.push("(id LIKE ? ESCAPE '\\' OR source_json LIKE ? ESCAPE '\\')");
    const term =
      "%" +
      String(q.q)
        .slice(0, 160)
        .replace(/[\\%_]/g, "\\$&") +
      "%";
    args.push(term, term);
  }
  const field = choice(
      q.dateField,
      ["source", "authorized", "posted"],
      "source",
    ),
    col = {
      source: "source_date",
      authorized: "authorized_at",
      posted: "posted_at",
    }[field],
    offset = c.timezone === "UTC" ? 0 : 8 * 3600000,
    start = new Date(Date.parse(c.from) - offset).toISOString(),
    end = new Date(Date.parse(c.to) + 86400000 - offset).toISOString();
  where.push(`${col}>=? AND ${col}<?`);
  args.push(start, end);
  if (q.issues === "yes")
    where.push(
      "(sync_state!='current' OR json_extract(internal_json,'$.matching')='unmatched' OR json_extract(internal_json,'$.feeTreatment')='unknown' OR json_extract(internal_json,'$.fault') IS NOT NULL OR amount_minor IS NULL OR status NOT IN('pending','posted','failed') OR detailed_status NOT IN('pending','pending_approval','in_review','canceled','failed','settled','declined','refund','reversed','returned','dispute') OR (json_type(source_json,'$.originalCurrency') IS NOT NULL AND provider_rate IS NULL) OR (original_currency IS NOT NULL AND original_scale IS NULL))",
    );
  if (q.crossCurrency) {
    const v = choice(q.crossCurrency, ["cross", "same", "unknown"], "cross");
    where.push(
      v === "cross"
        ? "original_currency IS NOT NULL AND account_currency IS NOT NULL AND original_currency!=account_currency"
        : v === "same"
          ? "original_currency=account_currency"
          : "(original_currency IS NULL OR account_currency IS NULL)",
    );
  }
  if (q.catalog && q.unified === "yes") {
    choice(q.catalog, ["fx", "legacy"], "fx");
    where.push("source_kind=?");
    args.push(q.catalog);
  }
  return { sql: where.join(" AND "), args, context: c };
}
function order(q) {
  const dir = choice(q.direction, ["asc", "desc"], "desc").toUpperCase(),
    sort = choice(
      q.sort,
      ["sourceDate", "postedAt", "authorizedAt", "amount", "id"],
      "sourceDate",
    );
  if (sort === "amount")
    return `account_currency ASC,account_scale ASC,amount_minor IS NULL ASC,CASE WHEN amount_minor LIKE '-%' THEN 0 ELSE 1 END ${dir},CASE WHEN amount_minor LIKE '-%' THEN -length(amount_minor) ELSE length(amount_minor) END ${dir},CASE WHEN amount_minor LIKE '-%' THEN substr(amount_minor,2) END ${dir === "ASC" ? "DESC" : "ASC"},CASE WHEN amount_minor NOT LIKE '-%' THEN amount_minor END ${dir},id ASC`;
  return `${{ sourceDate: "source_date", postedAt: "posted_at", authorizedAt: "authorized_at", id: "id" }[sort]} ${dir},id ASC`;
}
export function list(db, q = {}, ns = NS) {
  const table = q.unified === "yes" ? "fx_unified_transactions" : "fx_records",
    f = filter(q, ns),
    page = number(q.page, 0, 0, 1000000),
    pageSize = number(q.pageSize, 25, 1, 100),
    total = db
      .prepare(`SELECT count(*) n FROM ${table} WHERE ${f.sql}`)
      .get(...f.args).n;
  const rows = db
    .prepare(
      `SELECT * FROM ${table} WHERE ${f.sql} ORDER BY ${order(q)} LIMIT ? OFFSET ?`,
    )
    .all(...f.args, pageSize, page * pageSize)
    .map(rowDTO);
  return { rows, total, page, pageSize, context: f.context };
}
export function timeline(db, id, ns = NS) {
  lookup(db, ns, id);
  const internal = JSON.parse(
    db
      .prepare(
        "SELECT internal_json FROM fx_records WHERE namespace=? AND id=?",
      )
      .get(ns, id).internal_json,
  );
  const rows = db
    .prepare(
      "SELECT request_seq,source_json,collected_at,result FROM fx_observations WHERE namespace=? AND record_id=? ORDER BY request_seq",
    )
    .all(ns, id)
    .map((r) => {
      const n = normalize(JSON.parse(r.source_json), internal);
      return {
        requestSequence: r.request_seq,
        source: n.source,
        accountAmount: money(n.source.amountCents, n.currency, n.scale),
        originalAmount: money(n.original, n.originalCurrency, n.originalScale),
        collectedAt: r.collected_at,
        result: r.result,
      };
    });
  return {
    rows,
    complete: false,
    note: "请求序号仅用于本系统并发采集排序；不是平台版本。晚到响应保留但不覆盖。",
  };
}
export function related(db, id, ns = NS) {
  lookup(db, ns, id);
  return db
    .prepare(
      "SELECT * FROM fx_relations WHERE namespace=? AND (child_id=? OR parent_id=?) ORDER BY child_id",
    )
    .all(ns, id, id)
    .map((r) => ({
      kind: r.kind,
      confirmation: r.confirmation,
      evidence: r.evidence,
      parentId: r.parent_id,
      childId: r.child_id,
      record: lookup(db, ns, r.child_id === id ? r.parent_id : r.child_id),
    }));
}
const sum = (rows, field) =>
  rows.some((r) => r[field] == null)
    ? null
    : rows.reduce((n, r) => n + BigInt(r[field]), 0n).toString();
export function detail(db, id, ns = NS) {
  const record = lookup(db, ns, id),
    history = timeline(db, id, ns),
    relations = related(db, id, ns),
    base = db
      .prepare("SELECT * FROM fx_records WHERE namespace=? AND id=?")
      .get(ns, id);
  const parents = db
    .prepare(
      "SELECT p.* FROM fx_relations l JOIN fx_records p ON p.namespace=l.namespace AND p.id=l.parent_id WHERE l.namespace=? AND l.child_id=? AND l.confirmation IN('demo_verified','source_confirmed') AND p.category='purchase'",
    )
    .all(ns, id);
  const root =
    base.category !== "purchase" && parents.length === 1 ? parents[0] : base;
  const children = db
    .prepare(
      "SELECT DISTINCT c.* FROM fx_relations l JOIN fx_records c ON c.namespace=l.namespace AND c.id=l.child_id WHERE l.namespace=? AND l.parent_id=? AND l.confirmation IN('demo_verified','source_confirmed')",
    )
    .all(ns, root.id);
  const posted = [root, ...children].filter((r) => r.status === "posted"),
    sameScope = posted.every(
      (r) =>
        r.account_currency === root.account_currency &&
        r.account_scale === root.account_scale &&
        r.balance_type === root.balance_type,
    ),
    account = sum(posted, "amount_minor");
  const originals = posted.filter((r) =>
      ["purchase", "refund"].includes(r.category),
    ),
    sameOriginal = originals.every(
      (r) =>
        r.original_currency === root.original_currency &&
        r.original_scale === root.original_scale,
    ),
    original = sum(originals, "original_minor");
  const refunds = [root, ...children].filter(
      (r) => r.category === "refund" && r.status === "posted",
    ),
    refund = sum(refunds, "amount_minor");
  const issues = [
    ...new Set(
      [rowDTO(root), ...children.map(rowDTO)].flatMap((r) => r.issues),
    ),
  ];
  if (relations.some((r) => r.confirmation === "unconfirmed"))
    issues.push("存在未确认关联");
  const accepted = history.rows.filter((r) => r.result === "applied"),
    authorization = accepted.find((r) => r.source.status === "pending");
  const events = db
    .prepare(
      "SELECT e.event_id,e.event,e.event_timestamp,e.received_at,d.id delivery_id,d.result FROM fx_events e JOIN fx_deliveries d ON d.namespace=e.namespace AND d.connection_id=e.connection_id AND d.event_id=e.event_id WHERE e.namespace=? AND e.connection_id=? AND e.entity_id=? ORDER BY d.id",
    )
    .all(ns, base.connection_id, base.source_id);
  return {
    record,
    history,
    relations,
    events,
    feeDetails: db
      .prepare(
        "SELECT source_json FROM fx_assets WHERE namespace=? AND kind='fee-detail' AND (id=? OR id IN(SELECT child_id FROM fx_relations WHERE namespace=? AND parent_id=?))",
      )
      .all(ns, id, ns, id)
      .map((r) => {
        const f = JSON.parse(r.source_json);
        return {
          id: f.id,
          dateCharged: f.dateCharged,
          feeAmountCents: f.feeAmountCents,
          feeType: f.feeType,
          accountId: f.accountId,
          originalTransactionId: f.originalTransaction?.id ?? null,
        };
      }),
    authorizationAmount: authorization
      ? money(
          authorization.source.amountCents,
          base.account_currency,
          base.account_scale,
        )
      : null,
    net: {
      scopeId: root.id,
      scopeKind: root.category === "purchase" ? "original_order" : "record",
      account:
        account != null && sameScope
          ? money(
              (-BigInt(account)).toString(),
              base.account_currency,
              base.account_scale,
            )
          : null,
      original:
        original != null && sameOriginal && originals.length
          ? money(
              (-BigInt(original)).toString(),
              base.original_currency,
              base.original_scale,
            )
          : null,
      refund: money(refund, base.account_currency, base.account_scale),
      confirmedWithinDemo: issues.length === 0,
      issues,
      note: "以明确关联的原消费及全部已确认子流水为计算范围；未匹配时仅本记录。费用说明及授权不参与求和。仅 Demo 关联成立，未知费用可能使已知净额不完整。",
    },
    fees: {
      fx: record.source.fxFeeInfo?.amountCents ?? null,
      cashback: record.source.cashbackInfo?.amountCents ?? null,
      treatment: record.feeTreatment,
      note: "说明字段不独立计入资金；无字段代表未知，并非手续费为0。",
    },
    asOf: AS_OF,
  };
}
function dailyFilter(q, ns) {
  const c = context(q),
    where = ["namespace=?", "timezone=?", "basis=?"],
    args = [ns, c.timezone, c.basis];
  for (const [k, col] of Object.entries({
    platform: "platform",
    account: "account_id",
    currency: "account_currency",
    originalCurrency: "original_currency",
    scenario: "scenario",
    balanceType: "balance_type",
  }))
    if (q[k]) {
      where.push(`${col}=?`);
      args.push(q[k]);
    }
  return { c, where: where.join(" AND "), args };
}
export function report(db, q = {}, ns = NS) {
  if (
    db
      .prepare("SELECT dirty FROM fx_projection_state WHERE namespace=?")
      .get(ns)?.dirty
  )
    rebuildDaily(db, ns);
  const f = dailyFilter(q, ns),
    rows = db
      .prepare(`SELECT * FROM fx_daily WHERE ${f.where} AND day>=? AND day<=?`)
      .all(...f.args, f.c.from, f.c.to),
    unassigned = db
      .prepare(
        `SELECT coalesce(sum(count),0) n FROM fx_daily WHERE ${f.where} AND day='unassigned'`,
      )
      .get(...f.args).n;
  const accounts = new Map(),
    originals = new Map(),
    daily = new Map();
  for (const r of rows) {
    const key = JSON.stringify([
      r.connection_id,
      r.account_id,
      r.balance_type,
      r.account_currency,
      r.account_scale,
    ]);
    const a = accounts.get(key) || {
      accountId: r.account_id,
      connectionId: r.connection_id,
      balanceType: r.balance_type,
      currency: r.account_currency,
      scale: r.account_scale,
      posted: {},
      pending: {},
      inflow: 0n,
      outflow: 0n,
      net: 0n,
      issues: 0,
      count: 0,
    };
    a.count += r.count;
    a.issues += r.issues;
    if (["posted", "pending"].includes(r.status)) {
      const target = a[r.status];
      target[r.category] = (target[r.category] || 0n) + BigInt(r.amount_minor);
    }
    if (r.status === "posted") {
      const v = BigInt(r.amount_minor);
      a.net -= v;
      if (v < 0n) a.outflow -= v;
      else a.inflow += v;
      if (["purchase", "refund"].includes(r.category)) {
        const ok = JSON.stringify([r.original_currency, r.original_scale]),
          o = originals.get(ok) || {
            currency: r.original_currency,
            scale: r.original_scale,
            purchase: 0n,
            refund: 0n,
            unknown: 0,
          };
        o[r.category] += BigInt(r.original_minor);
        o.unknown += r.unknown_original;
        originals.set(ok, o);
      }
      const dk = JSON.stringify([r.day, ...JSON.parse(key)]),
        d = daily.get(dk) || {
          day: r.day,
          accountId: r.account_id,
          balanceType: r.balance_type,
          currency: r.account_currency,
          scale: r.account_scale,
          net: 0n,
        };
      d.net -= v;
      daily.set(dk, d);
    }
    accounts.set(key, a);
  }
  const encode = (o) =>
    JSON.parse(
      JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  const page = number(q.page, 0, 0, 1000000),
    pageSize = number(q.pageSize, 25, 1, 100),
    accountRows = [...accounts.values()].sort((a, b) =>
      (a.accountId + a.balanceType).localeCompare(b.accountId + b.balanceType),
    ),
    selected = accountRows.slice(page * pageSize, (page + 1) * pageSize),
    keys = new Set(
      selected.map((a) =>
        JSON.stringify([a.accountId, a.balanceType, a.currency, a.scale]),
      ),
    ),
    days = [...daily.values()]
      .filter((d) =>
        keys.has(
          JSON.stringify([d.accountId, d.balanceType, d.currency, d.scale]),
        ),
      )
      .sort((a, b) => (a.day + a.accountId).localeCompare(b.day + b.accountId)),
    dailyPage = number(q.dailyPage, 0, 0, 1000000);
  return encode({
    context: f.c,
    accountTotal: accountRows.length,
    page,
    pageSize,
    dailyPage,
    dailyTotal: days.length,
    accounts: selected,
    originals: [...originals.values()].map((o) => ({
      ...o,
      net: -o.purchase - o.refund,
    })),
    daily: days.slice(dailyPage * 50, (dailyPage + 1) * 50),
    unassigned,
    complete: false,
    note: "金额为各币种最小单位字符串；账户/余额类型分组；待入账不计净支出；仅累计独立流水。订单口径未匹配记录单列，不自动认定对账成功。",
  });
}
export function balances(db, q = {}, ns = NS) {
  const where = ["namespace=?"],
    args = [ns];
  if (q.account) {
    where.push("account_id=?");
    args.push(q.account);
  }
  if (q.currency) {
    where.push("currency=?");
    args.push(q.currency);
  }
  return {
    rows: db
      .prepare(
        `SELECT * FROM fx_balances WHERE ${where.join(" AND ")} ORDER BY account_id,balance_type,timestamp LIMIT 200`,
      )
      .all(...args)
      .map((b) => {
        const rows = db
            .prepare(
              "SELECT * FROM fx_records WHERE namespace=? AND connection_id=? AND account_id=? AND balance_type=? AND account_currency=? AND status=? AND posted_at>? AND posted_at<=?",
            )
            .all(
              ns,
              b.connection_id,
              b.account_id,
              b.balance_type,
              b.currency,
              "posted",
              b.opening_at || "",
              b.timestamp,
            ),
          delta = sum(rows, "amount_minor"),
          expected =
            b.scope_complete && b.opening_minor != null && delta != null
              ? (BigInt(b.opening_minor) + BigInt(delta)).toString()
              : null;
        return {
          id: b.id,
          accountId: b.account_id,
          type: b.balance_type,
          available: money(b.available_minor, b.currency, b.scale),
          posted: money(b.posted_minor, b.currency, b.scale),
          timestamp: b.timestamp,
          collectedAt: b.collected_at,
          expected: money(expected, b.currency, b.scale),
          difference:
            expected != null && b.posted_minor != null
              ? money(
                  (BigInt(b.posted_minor) - BigInt(expected)).toString(),
                  b.currency,
                  b.scale,
                )
              : null,
          state:
            expected == null || rows.some((r) => rowDTO(r).issues.length)
              ? "待确认"
              : expected === b.posted_minor
                ? "Demo 快照一致"
                : "金额差异",
          note: "仅在完整 Demo 期初和流水范围下核对 posted；available 独立保留。",
        };
      }),
    limitedTo: 200,
    note: "cash / credit / debit 分开展示；余额币种来自账户上下文，不合并现金与信用额度。",
  };
}
export function exportCSV(db, q = {}, ns = NS) {
  const table = q.unified === "yes" ? "fx_unified_transactions" : "fx_records",
    f = filter(q, ns),
    total = db
      .prepare(`SELECT count(*) n FROM ${table} WHERE ${f.sql}`)
      .get(...f.args).n;
  if (total > 10000) error("单次导出上限10000条，请缩小筛选范围");
  const headers = [
    "id",
    "scenario",
    "platform",
    "account",
    "original_currency",
    "original_minor",
    "original_scale",
    "account_currency",
    "account_minor",
    "account_scale",
    "status",
    "detailed_status",
    "authorized_at",
    "posted_at",
    "source_date",
    "provider_rate",
    "category",
    "matching",
    "sync_state",
  ];
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^(?:[=+@\t\r]|-(?!\d+(?:\.\d+)?$))/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const lines = [headers.join(",")];
  for (const r of db
    .prepare(`SELECT * FROM ${table} WHERE ${f.sql} ORDER BY ${order(q)}`)
    .iterate(...f.args))
    lines.push(
      [
        r.id,
        r.scenario,
        r.platform,
        r.account_id,
        r.original_currency,
        r.original_minor,
        r.original_scale,
        r.account_currency,
        r.amount_minor,
        r.account_scale,
        r.status,
        r.detailed_status,
        r.authorized_at,
        r.posted_at,
        r.source_date,
        r.provider_rate,
        r.category,
        JSON.parse(r.internal_json).matching,
        r.sync_state,
      ]
        .map(cell)
        .join(","),
    );
  return {
    csv: "\uFEFF" + lines.join("\r\n"),
    count: total,
    context: f.context,
  };
}
export function fxRead(db, path, q = {}) {
  const [resource, id, sub, ...extra] = path.split("/");
  if (extra.length) error("接口不存在", 404);
  if (resource === "transactions") {
    if (sub === "timeline") return timeline(db, id);
    if (sub === "relations") return { rows: related(db, id) };
    if (sub) error("接口不存在", 404);
    return id ? detail(db, id) : list(db, q);
  }
  if (id && resource !== "cards") error("接口不存在", 404);
  if (resource === "report") return report(db, q);
  if (resource === "balances") return balances(db, q);
  if (resource === "differences") return list(db, { ...q, issues: "yes" });
  if (resource === "export") return exportCSV(db, q);
  if (resource === "cards" && id) {
    const r = db
      .prepare(
        "SELECT source_json FROM fx_assets WHERE namespace=? AND kind='card' AND id=?",
      )
      .get(NS, id);
    if (!r) error("卡片不存在", 404);
    return {
      card: JSON.parse(r.source_json),
      transactions: list(db, { ...q, card: id }),
    };
  }
  if (resource === "meta")
    return {
      namespace: NS,
      scenarios: [
        ...scenarios,
        ...db
          .prepare(
            "SELECT id,title FROM scenarios WHERE namespace='slash-clearing-v1' ORDER BY id LIMIT 100",
          )
          .all()
          .map((s) => [s.id, s.title]),
      ],
      asOf: AS_OF,
      assumption: "全部为合成数据；费率、关系和资金变化待 Slash 确认",
      records: db
        .prepare("SELECT count(*) n FROM fx_records WHERE namespace=?")
        .get(NS).n,
    };
  error("接口不存在", 404);
}

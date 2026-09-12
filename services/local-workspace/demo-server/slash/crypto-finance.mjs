import { FINANCE_POLICY } from "../../../../apps/client/src/portal/model.ts";
import { createHash, randomUUID } from "node:crypto";
import { assertLocal } from "./store.mjs";
import { balance as ledgerBalance, journal, principal } from "./card-admin.mjs";
export const FINANCE_NS = "finance-workbench-v1";
const ns = FINANCE_NS,
  clock = () => new Date().toISOString();
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const one = (db, sql, ...args) => db.prepare(sql).get(ns, ...args);
const many = (db, sql, ...args) => db.prepare(sql).all(ns, ...args);
const run = (db, sql, ...args) => db.prepare(sql).run(ns, ...args);
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const str = (v, label, max = 500) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(`${label}必填，最多${max}字`);
  return v.trim();
};
const amount = (v) => {
  if (
    typeof v !== "string" ||
    !/^(0|[1-9]\d{0,12})$/.test(v) ||
    BigInt(v) <= 0n ||
    BigInt(v) > 1000000000000n
  )
    fail("金额须为正整数最小单位字符串（上限 10^12）");
  return v;
};
const atomic = (db, fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
const insert = (db, table, obj) =>
  db
    .prepare(
      `INSERT INTO ${table}(${Object.keys(obj).join(",")}) VALUES(${Object.keys(
        obj,
      )
        .map(() => "?")
        .join(",")})`,
    )
    .run(...Object.values(obj));
function permit(db, actor, p, customer) {
  const identity = principal(db, ns, actor);
  if (
    !identity.permissions.includes(p) ||
    (customer &&
      identity.owner_scope !== "*" &&
      identity.owner_scope !== customer)
  )
    fail("无此资金操作权限或客户不在授权范围", 403);
  return identity;
}
const audit = (db, oid, actor, action, note) =>
  insert(db, "fn_audit", {
    namespace: ns,
    id: randomUUID(),
    order_id: oid,
    actor,
    action,
    note,
    created_at: clock(),
  });
const wallet = (db, id) => {
  const w = one(db, "SELECT * FROM fn_wallets WHERE namespace=? AND id=?", id);
  if (!w) fail("钱包不存在", 404);
  return w;
};
export function walletBalance(db, id) {
  const w = wallet(db, id);
  const base = ledgerBalance(db, ns, id);
  let held = 0n;
  for (const h of many(
    db,
    "SELECT amount_minor FROM fn_holds WHERE namespace=? AND account_id=?",
    id,
  ))
    held += BigInt(h.amount_minor);
  return {
    ...w,
    postedMinor: base.postedMinor,
    heldMinor: String(held),
    availableMinor: String(BigInt(base.postedMinor) - held),
  };
}
function reserve(db, o, account, total) {
  const w = walletBalance(db, account);
  if (
    w.customer !== o.customer ||
    w.asset !== o.asset ||
    w.network !== o.network
  )
    fail("账户归属、资产或网络不匹配");
  if (BigInt(w.availableMinor) < BigInt(total)) fail("可用余额不足", 409);
  run(db, "INSERT INTO fn_holds VALUES(?,?,?,?)", o.id, account, total);
}
function release(db, id) {
  run(db, "DELETE FROM fn_holds WHERE namespace=? AND order_id=?", id);
}
function load(db, id) {
  const r = one(db, "SELECT * FROM fn_orders WHERE namespace=? AND id=?", id);
  if (!r) fail("订单不存在", 404);
  return {
    ...JSON.parse(r.data_json),
    ...Object.fromEntries(
      Object.entries(r).filter(
        ([k]) => !["data_json", "namespace"].includes(k),
      ),
    ),
  };
}
const columns = [
  "id",
  "kind",
  "customer",
  "asset",
  "network",
  "amount_minor",
  "fee_minor",
  "approval",
  "execution",
  "state",
  "risk",
  "revision",
  "requester",
  "parent_id",
  "created_at",
  "updated_at",
];
function save(db, o) {
  const data = { ...o };
  for (const c of columns) delete data[c];
  insert(db, "fn_orders", {
    namespace: ns,
    ...Object.fromEntries(columns.map((c) => [c, o[c] ?? null])),
    data_json: JSON.stringify(data),
  });
}
// Explicit binding keeps the namespace in the WHERE clause, never in editable payloads.
function update(db, o) {
  const fields = columns.filter((c) => c !== "id");
  const d = { ...o };
  for (const c of columns) delete d[c];
  db.prepare(
    `UPDATE fn_orders SET ${fields.map((c) => `${c}=?`).join(",")},data_json=? WHERE namespace=? AND id=?`,
  ).run(...fields.map((c) => o[c] ?? null), JSON.stringify(d), ns, o.id);
}
function fresh(kind, customer, asset, amountMinor, actor, id) {
  return {
    id: id || `FIN-${randomUUID()}`,
    kind,
    customer,
    asset,
    network: asset === "USDT" ? "TRON" : "FIAT",
    amount_minor: amountMinor,
    fee_minor: "0",
    approval: "pending",
    execution: "not_submitted",
    state: "draft",
    risk: "unchecked",
    revision: 1,
    requester: actor,
    parent_id: null,
    created_at: clock(),
    updated_at: clock(),
    reason: "",
    evidence: null,
    accounting: "unposted",
    chain: "not_applicable",
    deliveredMinor: "0",
    feePostedMinor: "0",
    policyVersion: "sandbox-only-v1",
    requiredNodes: ["reviewer"],
    error: null,
    source: null,
    target: null,
    channelMode: "success",
    address: null,
    memo: null,
  };
}
function postTransfer(db, o, key, kind, source, target, value) {
  const a = wallet(db, source),
    b = wallet(db, target);
  if (a.asset !== b.asset || a.network !== b.network)
    fail("不能跨资产或网络直接划转");
  const beforeA = ledgerBalance(db, ns, source).postedMinor,
    beforeB = ledgerBalance(db, ns, target).postedMinor;
  journal(db, ns, key, null, kind, source, target, value);
  for (const [w, before, sign] of [
    [a, beforeA, -1n],
    [b, beforeB, 1n],
  ])
    if (w.kind === "customer")
      insert(db, "fn_movements", {
        namespace: ns,
        id: `${key}:${w.id}`,
        order_id: o.id,
        journal_id: key,
        account_id: w.id,
        customer: w.customer,
        kind,
        asset: w.asset,
        network: w.network,
        amount_minor: String(sign * BigInt(value)),
        before_minor: before,
        after_minor: String(BigInt(before) + sign * BigInt(value)),
        created_at: clock(),
      });
}
export function validTronAddress(address) {
  try {
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if (
      typeof address !== "string" ||
      address.length !== 34 ||
      address[0] !== "T"
    )
      return false;
    let n = 0n;
    for (const c of address) {
      const i = alphabet.indexOf(c);
      if (i < 0) return false;
      n = n * 58n + BigInt(i);
    }
    const buf = Buffer.from(n.toString(16).padStart(50, "0"), "hex");
    if (buf.length !== 25 || buf[0] !== 0x41) return false;
    const checksum = createHash("sha256")
      .update(createHash("sha256").update(buf.subarray(0, 21)).digest())
      .digest()
      .subarray(0, 4);
    return checksum.equals(buf.subarray(21));
  } catch {
    return false;
  }
}
function addressCheck(asset, network, address) {
  if (asset !== "USDT" || network !== "TRON")
    fail("本地出金仅支持 USDT / TRON");
  if (!/^DEMO:TRON:[A-Za-z0-9_-]{3,80}$/.test(address || ""))
    fail(
      validTronAddress(address)
        ? "地址格式正确，但真实地址禁止在隔离执行模块出金"
        : "地址与 TRON 演示网络不匹配；使用 DEMO:TRON: 标识",
    );
}
function ratio(value) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,3})(\.\d{1,8})?$/.test(value)
  )
    fail("比例须为正十进制数，最多 8 位小数");
  const [whole, fraction = ""] = value.split(".");
  const numerator = BigInt(whole + fraction),
    denominator = 10n ** BigInt(fraction.length);
  if (numerator <= 0n || numerator > denominator * 1000n)
    fail("比例须大于 0 且不超过 1000");
  return {
    numerator,
    denominator,
    value: value.includes(".")
      ? value.replace(/0+$/, "").replace(/\.$/, "")
      : value,
  };
}
function currentPrice(db) {
  const p = one(
    db,
    "SELECT * FROM fn_fixed_prices WHERE namespace=? ORDER BY version DESC LIMIT 1",
  );
  if (!p) fail("固定报价尚未配置", 409);
  return {
    version: p.version,
    usdPerUsdt: p.usd_per_usdt,
    actor: p.actor,
    reason: p.reason,
    updatedAt: p.created_at,
    mode: "fixed",
    scope: "isolated-sandbox",
  };
}
function seedPrice(db) {
  if (one(db, "SELECT 1 FROM fn_fixed_prices WHERE namespace=? LIMIT 1"))
    return;
  insert(db, "fn_fixed_prices", {
    namespace: ns,
    version: 1,
    usd_per_usdt: "0.99",
    actor: "user-configured-default",
    reason: "用户指定默认 1 USDT = 0.99 USD；仅隔离环境",
    created_at: clock(),
  });
  // Upgrade the existing isolated control role once; never reset later permission edits.
  const p = principal(db, ns, "demo-controller");
  if (!p.permissions.includes("finance.price_manage"))
    db.prepare(
      "UPDATE ca_principals SET permissions_json=? WHERE namespace=? AND actor=?",
    ).run(
      JSON.stringify([...p.permissions, "finance.price_manage"]),
      ns,
      "demo-controller",
    );
  audit(
    db,
    null,
    "user-configured-default",
    "pricing_initialized",
    "v1 / 1 USDT = 0.99 USD",
  );
}
function quoteRecord(db, id) {
  const fixed = one(
    db,
    "SELECT * FROM fn_fixed_quotes WHERE namespace=? AND id=?",
    id,
  );
  return fixed
    ? { ...fixed, table: "fn_fixed_quotes" }
    : one(db, "SELECT * FROM fn_quotes WHERE namespace=? AND id=?", id);
}
function quoteUsable(db, q) {
  return (
    !!q &&
    (q.table === "fn_fixed_quotes"
      ? q.price_version === currentPrice(db).version
      : Date.parse(q.expires_at) > Date.now())
  );
}
export function quoteValue(
  sell,
  value,
  price = { version: 1, usdPerUsdt: "0.99" },
) {
  amount(value);
  if (!["USD", "USDT"].includes(sell)) fail("仅支持内部 USD ↔ USDT");
  const r = ratio(price.usdPerUsdt),
    total = BigInt(value),
    fee = (total * 5n + 999n) / 1000n,
    net = total - fee;
  const buy =
    sell === "USDT"
      ? (net * r.numerator * 100n) / (r.denominator * 1000000n)
      : (net * r.denominator * 1000000n) / (r.numerator * 100n);
  if (buy <= 0n) fail("兑换金额小于目标资产最小单位");
  return {
    sellAsset: sell,
    buyAsset: sell === "USD" ? "USDT" : "USD",
    sellMinor: value,
    buyMinor: String(buy),
    feeMinor: String(fee),
    mode: "fixed",
    priceVersion: price.version,
    usdPerUsdt: r.value,
    rate: sell === "USDT" ? r.value : null,
    rateNumerator: String(sell === "USDT" ? r.numerator : r.denominator),
    rateDenominator: String(sell === "USDT" ? r.denominator : r.numerator),
    rateDirection: `1 USDT = ${r.value} USD${sell === "USD" ? "（USD 转 USDT 按此比例反向计算）" : ""}`,
    source: "后台固定报价 / 非市场价格",
    lockCondition:
      "无倒计时；确认时校验报价版本，调价后未确认订单须重新报价；卖出总额含费，目标最小单位向下取整",
    expiresAt: null,
  };
}
function withdrawal(db, actor, b, id) {
  const customer = str(b.customer, "客户", 100);
  permit(db, actor, "finance.create", customer);
  addressCheck(b.asset, b.network, b.address);
  amount(b.amountMinor);
  if (
    BigInt(b.amountMinor) < BigInt(FINANCE_POLICY.minWithdraw) ||
    BigInt(b.amountMinor) > BigInt(FINANCE_POLICY.maxWithdraw)
  )
    fail("出金范围 10 至 100000 USDT");
  const o = fresh("withdrawal", customer, "USDT", b.amountMinor, actor, id);
  Object.assign(o, {
    source: `${customer}:USDT`,
    target: "external:USDT",
    address: b.address,
    memo: b.memo ? str(b.memo, "Memo", 100) : null,
    reason: str(b.reason, "原因"),
    evidence: b.evidence ? str(b.evidence, "凭证引用") : null,
    fee_minor: String(FINANCE_POLICY.withdrawalFee),
    state: "pending",
    chain: "not_broadcast",
    requiredNodes: policyNodes(db, b.amountMinor),
  });
  save(db, o, true);
  reserve(
    db,
    o,
    o.source,
    String(BigInt(o.amount_minor) + BigInt(o.fee_minor)),
  );
  audit(
    db,
    o.id,
    actor,
    "submitted",
    "预占本金及手续费；风险未检查；测试策略 sandbox-only-v1",
  );
  return o;
}
function dto(o) {
  const { channelMode, ...safe } = o;
  return {
    ...safe,
    remainingMinor: String(BigInt(o.amount_minor) - BigInt(o.deliveredMinor)),
    expectedReceiptMinor: o.kind === "otc" ? o.quote.buyMinor : o.amount_minor,
    actualReceiptMinor:
      o.kind === "otc"
        ? o.state === "completed"
          ? o.quote.buyMinor
          : "0"
        : o.deliveredMinor,
    feeTreatment:
      o.kind === "otc"
        ? "卖出总额含手续费；仅测试费率"
        : "额外收取；实际到账金额为申请本金；仅测试费率",
    dataMode: "sandbox",
    formalPolicy: "not_configured",
  };
}
function seedPolicy(db) {
  const result = run(
    db,
    "INSERT OR IGNORE INTO fn_policies VALUES(?,?,?,?,?,?)",
    "sandbox-only-v1",
    "USDT",
    "TRON",
    "sandbox",
    JSON.stringify([
      { upToMinor: "1000000000", nodes: ["reviewer"] },
      { upToMinor: "100000000000", nodes: ["reviewer", "controller"] },
    ]),
  );
  if (result.changes)
    audit(
      db,
      null,
      "test-fixture",
      "policy_seed",
      "仅创建本地多级测试审批策略；正式策略未配置",
    );
}
function policyNodes(db, value) {
  const policy = one(
    db,
    "SELECT * FROM fn_policies WHERE namespace=? AND version=?",
    "sandbox-only-v1",
  );
  if (
    !policy ||
    policy.mode !== "sandbox" ||
    policy.asset !== "USDT" ||
    policy.network !== "TRON"
  )
    fail("隔离审批策略未配置或不适用", 409);
  const tiers = JSON.parse(policy.tiers_json);
  let previous = 0n;
  for (const t of tiers) {
    if (
      !/^[1-9]\d{0,12}$/.test(t.upToMinor) ||
      BigInt(t.upToMinor) <= previous ||
      !Array.isArray(t.nodes) ||
      !t.nodes.length ||
      new Set(t.nodes).size !== t.nodes.length ||
      t.nodes.some((n) => !["reviewer", "controller"].includes(n))
    )
      fail("审批策略配置无效", 409);
    previous = BigInt(t.upToMinor);
  }
  const tier = tiers.find((t) => BigInt(value) <= BigInt(t.upToMinor));
  if (!tier) fail("金额超出已配置审批策略", 409);
  return tier.nodes;
}
export function seedFinance(db) {
  assertLocal();
  if (one(db, "SELECT 1 FROM demo_batches WHERE namespace=?")) {
    seedPolicy(db);
    seedPrice(db);
    return;
  }
  atomic(db, () => {
    db.prepare("INSERT INTO demo_batches VALUES(?,?,?)").run(
      ns,
      20260907,
      clock(),
    );
    seedPolicy(db);
    const grants = {
      "demo-operator": ["finance.read", "finance.export", "finance.create"],
      "demo-reviewer": [
        "finance.read",
        "finance.export",
        "finance.approve",
        "finance.execute",
        "finance.risk_check",
      ],
      "demo-controller": ["finance.read", "finance.control", "finance.execute"],
      "demo-viewer": ["finance.read"],
    };
    for (const [actor, p] of Object.entries(grants))
      db.prepare("INSERT INTO ca_principals VALUES(?,?,?,?)").run(
        ns,
        actor,
        JSON.stringify(p),
        "*",
      );
    seedPrice(db);
    for (const asset of ["USD", "USDT"])
      for (const [owner, kind] of [
        ["DEMO-C001", "customer"],
        ["DEMO-C002", "customer"],
        ["inventory", "system"],
        ["fees", "system"],
        ["external", "system"],
        ["equity", "system"],
      ]) {
        const id = `${owner}:${asset}`;
        db.prepare("INSERT INTO ca_accounts VALUES(?,?,?,?,?,?)").run(
          ns,
          id,
          owner,
          null,
          asset,
          kind,
        );
        insert(db, "fn_wallets", {
          namespace: ns,
          id,
          customer: owner,
          asset,
          network: asset === "USD" ? "FIAT" : "TRON",
          scale: asset === "USD" ? 2 : 6,
          kind,
        });
      }
    for (const asset of ["USD", "USDT"])
      for (const customer of ["DEMO-C001", "DEMO-C002", "inventory"])
        journal(
          db,
          ns,
          `FIN-OPEN-${customer}-${asset}`,
          null,
          "opening",
          `equity:${asset}`,
          `${customer}:${asset}`,
          asset === "USD" ? "10000000" : "100000000000",
        );
    const d = fresh(
      "deposit",
      "DEMO-C001",
      "USDT",
      "200000000",
      "test-fixture",
      "FIN-DEPOSIT-001",
    );
    Object.assign(d, {
      state: "completed",
      approval: "not_required",
      execution: "completed",
      accounting: "posted",
      chain: "confirmed",
      source: "external:USDT",
      target: "DEMO-C001:USDT",
      risk: "unchecked",
      reason: "隔离通道确认充值（合成记录）",
      address: "DEMO:TRON:DEPOSIT001",
      txHash: null,
      confirmations: 20,
      channelReference: "TEST-DEPOSIT-001",
      deliveredMinor: "200000000",
    });
    save(db, d, true);
    postTransfer(
      db,
      d,
      "FIN-DEPOSIT-001:principal",
      "deposit",
      d.source,
      d.target,
      d.amount_minor,
    );
    audit(
      db,
      d.id,
      "test-fixture",
      "confirmed",
      "本地合成通道确认；不是实际链上到账",
    );
    // A posted transfer and linked correction demonstrate immutable entry history.
    const t = fresh(
      "transfer",
      "DEMO-C001",
      "USDT",
      "50000000",
      "test-fixture",
      "FIN-TRANSFER-001",
    );
    Object.assign(t, {
      state: "completed",
      execution: "completed",
      approval: "approved",
      accounting: "posted",
      source: "DEMO-C001:USDT",
      target: "DEMO-C002:USDT",
      reason: "明确隔离测试客户间转账；非开放转账能力",
      deliveredMinor: "50000000",
    });
    save(db, t, true);
    postTransfer(
      db,
      t,
      "FIN-TRANSFER-001:principal",
      "transfer",
      t.source,
      t.target,
      t.amount_minor,
    );
    for (const [kind, value, id] of [
      ["refund", "10000000", "FIN-REFUND-001"],
      ["adjustment", "1000000", "FIN-ADJUST-001"],
    ]) {
      const c = fresh(kind, "DEMO-C001", "USDT", value, "test-fixture", id);
      Object.assign(c, {
        state: "completed",
        execution: "completed",
        approval: "approved",
        accounting: "posted",
        parent_id: t.id,
        source: t.target,
        target: t.source,
        reason: "对 FIN-TRANSFER-001 的隔离部分冲正；原分录保留",
        deliveredMinor: value,
        evidence: "TEST-REVERSAL-EVIDENCE",
      });
      save(db, c, true);
      postTransfer(db, c, `${id}:principal`, kind, c.source, c.target, value);
      audit(
        db,
        c.id,
        "test-fixture",
        "correction",
        "合成凭证 TEST-REVERSAL-EVIDENCE；关联原订单",
      );
    }
    for (const [id, value, mode] of [
      ["FIN-WITHDRAW-001", "100000000", "success"],
      ["FIN-WITHDRAW-TIMEOUT", "80000000", "timeout"],
      ["FIN-WITHDRAW-PARTIAL", "200000000", "partial"],
      ["FIN-WITHDRAW-FAILED", "70000000", "failure"],
      ["FIN-WITHDRAW-TIER2", "1500000000", "success"],
    ]) {
      const o = withdrawal(
        db,
        "demo-operator",
        {
          customer: "DEMO-C001",
          asset: "USDT",
          network: "TRON",
          amountMinor: value,
          address: `DEMO:TRON:${id}`,
          reason: `隔离场景 ${mode}`,
        },
        id,
      );
      o.channelMode = mode;
      update(db, o);
    }
  });
}
function detail(db, actor, id) {
  const o = load(db, id);
  const access = permit(db, actor, "finance.read", o.customer);
  return {
    order: dto(o),
    wallet: walletBalance(db, `${o.customer}:${o.asset}`),
    reviews: many(
      db,
      "SELECT revision,actor,node,decision,note,created_at FROM fn_reviews WHERE namespace=? AND order_id=? ORDER BY created_at",
      id,
    ),
    timeline: many(
      db,
      "SELECT id,actor,action,note,created_at FROM fn_audit WHERE namespace=? AND order_id=? ORDER BY created_at,rowid",
      id,
    ),
    events: many(
      db,
      "SELECT event_id,result,received_at,payload_json FROM fn_events WHERE namespace=? AND order_id=? ORDER BY received_at",
      id,
    ).map((e) => ({
      ...e,
      payload: JSON.parse(e.payload_json),
      payload_json: undefined,
    })),
    movements: many(
      db,
      "SELECT * FROM fn_movements WHERE namespace=? AND order_id=? ORDER BY created_at,rowid",
      id,
    )
      .filter(
        (m) => access.owner_scope === "*" || m.customer === access.owner_scope,
      )
      .map(({ namespace, ...m }) => m),
    related: many(
      db,
      "SELECT id FROM fn_orders WHERE namespace=? AND (parent_id=? OR id=?)",
      id,
      o.parent_id,
    ).map((r) => dto(load(db, r.id))),
    job:
      one(
        db,
        "SELECT submission_key,revision,queries FROM fn_jobs WHERE namespace=? AND order_id=?",
        id,
      ) || null,
  };
}
const views = {
  pending: "approval IN('pending','reviewing')",
  approved: "approval='approved' AND execution='not_submitted'",
  processing:
    "execution IN('submitting','channel_processing','chain_confirming')",
  completed: "execution='completed'",
  rejected: "approval='rejected'",
  exception: "execution IN('unknown','failed')",
};
function queryParts(db, actor, q, flows) {
  const allowed = [
    "page",
    "pageSize",
    "customer",
    "asset",
    "network",
    "kind",
    "state",
    "approval",
    "execution",
    "risk",
    "view",
    "from",
    "to",
    "keyword",
    "orderId",
    "txHash",
    "address",
    "minAmount",
    "maxAmount",
    "sort",
    "direction",
  ];
  for (const k of Object.keys(q))
    if (!allowed.includes(k)) fail(`不支持查询参数 ${k}`);
  let where = "o.namespace=?",
    args = [ns];
  const p = permit(db, actor, "finance.read");
  if (p.owner_scope !== "*") {
    where += " AND o.customer=?";
    args.push(p.owner_scope);
    if (flows) {
      where += " AND m.customer=?";
      args.push(p.owner_scope);
    }
  }
  for (const k of [
    "customer",
    "asset",
    "network",
    "kind",
    "state",
    "approval",
    "execution",
    "risk",
  ])
    if (q[k]) {
      const prefix =
        flows && ["customer", "asset", "network", "kind"].includes(k)
          ? "m"
          : "o";
      where += ` AND ${prefix}.${k}=?`;
      args.push(q[k]);
    }
  if (q.view) {
    if (!views[q.view]) fail("未知状态视图");
    where += ` AND (${views[q.view].replace(/\b(approval|execution)\b/g, "o.$1")})`;
  }
  for (const [k, op] of [
    ["from", ">="],
    ["to", "<"],
  ])
    if (q[k]) {
      if (
        !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d\d:\d\d)$/.test(q[k]) ||
        !Number.isFinite(Date.parse(q[k]))
      )
        fail("日期必须带时区");
      where += ` AND ${flows ? "m" : "o"}.created_at ${op} ?`;
      args.push(new Date(q[k]).toISOString());
    }
  if (q.from && q.to && Date.parse(q.from) >= Date.parse(q.to))
    fail("时间范围无效");
  for (const [k, op] of [
    ["minAmount", ">="],
    ["maxAmount", "<="],
  ])
    if (q[k]) {
      if (!q.asset) fail("金额范围必须选择资产");
      if (!/^\d{1,13}$/.test(q[k])) fail("金额范围须为最小单位整数");
      where += ` AND abs(CAST(${flows ? "m" : "o"}.amount_minor AS INTEGER)) ${op} CAST(? AS INTEGER)`;
      args.push(q[k]);
    }
  for (const k of ["address", "txHash"])
    if (q[k]) {
      where += ` AND instr(lower(coalesce(json_extract(o.data_json,'$.${k}'),'')),lower(?))>0`;
      args.push(q[k]);
    }
  if (q.orderId) {
    where += " AND (o.id=? OR o.parent_id=?)";
    args.push(q.orderId, q.orderId);
  }
  if (q.keyword) {
    where +=
      " AND (instr(lower(o.id),lower(?))>0 OR instr(lower(o.customer),lower(?))>0 OR instr(lower(coalesce(json_extract(o.data_json,'$.address'),'')),lower(?))>0 OR instr(lower(coalesce(json_extract(o.data_json,'$.txHash'),'')),lower(?))>0)";
    args.push(...Array(4).fill(String(q.keyword).slice(0, 200)));
  }
  const sort = {
    created_at: `${flows ? "m" : "o"}.created_at`,
    amount_minor: `CAST(${flows ? "m" : "o"}.amount_minor AS INTEGER)`,
    id: `${flows ? "m" : "o"}.id`,
  };
  if (q.sort && !sort[q.sort]) fail("不支持排序字段");
  if (q.sort === "amount_minor" && !q.asset) fail("金额排序需选择资产");
  const page = Math.max(0, Math.min(100000, Math.trunc(Number(q.page)) || 0)),
    pageSize = Math.max(1, Math.min(100, Math.trunc(Number(q.pageSize)) || 25));
  return {
    where,
    args,
    page,
    pageSize,
    order: `${sort[q.sort] || sort.created_at} ${q.direction === "asc" ? "ASC" : "DESC"},${flows ? "m" : "o"}.id ASC`,
  };
}
function list(db, actor, q, flows = false) {
  const { where, args, page, pageSize, order } = queryParts(
      db,
      actor,
      q,
      flows,
    ),
    from = flows
      ? "fn_movements m JOIN fn_orders o ON o.namespace=m.namespace AND o.id=m.order_id"
      : "fn_orders o";
  const total = db
    .prepare(`SELECT count(*) n FROM ${from} WHERE ${where}`)
    .get(...args).n;
  const rows = db
    .prepare(
      `SELECT ${flows ? "m.*" : "o.id"} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, page * pageSize)
    .map((r) =>
      flows
        ? {
            ...Object.fromEntries(
              Object.entries(r).filter(([k]) => k !== "namespace"),
            ),
            direction: BigInt(r.amount_minor) < 0n ? "out" : "in",
            order: dto(load(db, r.order_id)),
          }
        : dto(load(db, r.id)),
    );
  const sums = {};
  if (flows)
    for (const r of db
      .prepare(
        `SELECT m.asset,m.network,m.amount_minor FROM ${from} WHERE ${where}`,
      )
      .iterate(...args)) {
      const key = `${r.asset}/${r.network}`,
        s = (sums[key] ??= {
          asset: r.asset,
          network: r.network,
          inMinor: 0n,
          outMinor: 0n,
          netMinor: 0n,
        }),
        v = BigInt(r.amount_minor);
      s.netMinor += v;
      if (v > 0n) s.inMinor += v;
      else s.outMinor -= v;
    }
  return {
    rows,
    total,
    page,
    pageSize,
    totals: Object.values(sums).map((s) => ({
      ...s,
      inMinor: String(s.inMinor),
      outMinor: String(s.outMinor),
      netMinor: String(s.netMinor),
    })),
    meta: {
      dataMode: "sandbox",
      namespace: ns,
      asOf: clock(),
      timezone: "UTC",
      timeBasis: flows ? "分录实际入账时间" : "申请创建时间",
      complete: false,
      coverage: "仅独立本地测试账本；不含旧 Portal 预算和真实通道",
      pagination: "offset / 非跨页快照",
    },
  };
}
export function financeRead(db, actor, path, q = {}) {
  seedFinance(db);
  const identity = permit(db, actor, "finance.read");
  if (path === "context") {
    const wallets = many(
      db,
      "SELECT id FROM fn_wallets WHERE namespace=? AND kind='customer'",
    )
      .map((w) => walletBalance(db, w.id))
      .filter(
        (w) =>
          identity.owner_scope === "*" || w.customer === identity.owner_scope,
      );
    const count = {};
    for (const v of Object.keys(views))
      count[v] = list(db, actor, {
        kind: "withdrawal",
        view: v,
        pageSize: "1",
      }).total;
    return {
      actor,
      permissions: identity.permissions,
      wallets,
      counts: count,
      customers: [...new Set(wallets.map((w) => w.customer))],
      mode: "isolated-sandbox",
      formalPolicy: "not_configured",
      fixedPrice: currentPrice(db),
      withdrawalPolicy: {
        feeMinor: String(FINANCE_POLICY.withdrawalFee),
        minMinor: String(FINANCE_POLICY.minWithdraw),
        maxMinor: String(FINANCE_POLICY.maxWithdraw),
        asset: "USDT",
        network: "TRON",
      },
      policy:
        "本地多级策略 sandbox-only-v1（禁止自审）；具体节点以申请快照为准。正式策略未配置",
      approvalTiers: JSON.parse(
        one(
          db,
          "SELECT tiers_json FROM fn_policies WHERE namespace=? AND version=?",
          "sandbox-only-v1",
        ).tiers_json,
      ),
      directions: ["USD/USDT", "USDT/USD"],
      channel: "仅本地持久化测试通道，未接入真实出金",
      risk: "测试检查器不代表真实风险结果",
    };
  }
  if (path === "orders") return list(db, actor, q);
  if (path === "flows") return list(db, actor, q, true);
  if (path === "export") {
    permit(db, actor, "finance.export");
    const first = list(db, actor, { ...q, page: "0", pageSize: "100" }, true);
    if (first.total > 1000) fail("本地导出最多 1000 条，请缩小范围", 413);
    const rows = [...first.rows];
    for (let i = 1; i < Math.ceil(first.total / 100); i++)
      rows.push(
        ...list(db, actor, { ...q, page: String(i), pageSize: "100" }, true)
          .rows,
      );
    const fields = [
      "id",
      "customer",
      "kind",
      "asset",
      "network",
      "direction",
      "amount_minor",
      "order_id",
      "created_at",
    ];
    const csv = (v) =>
      `"${String(v ?? "")
        .replace(/^[=+\-@\t\r]/, "'$&")
        .replaceAll('"', '""')}"`;
    audit(
      db,
      null,
      actor,
      "export",
      `导出 ${rows.length} 条，筛选 ${JSON.stringify(q)}`,
    );
    return {
      filename: "demo-crypto-flows.csv",
      csv:
        "\uFEFF" +
        [
          fields.join(","),
          ...rows.map((r) => fields.map((k) => csv(r[k])).join(",")),
        ].join("\r\n"),
      count: rows.length,
      meta: first.meta,
    };
  }
  const [type, id, ...rest] = path.split("/");
  if (rest.length) fail("接口不存在", 404);
  if (type === "orders" && id) return detail(db, actor, id);
  if (type === "flows" && id) {
    const m = one(
      db,
      "SELECT * FROM fn_movements WHERE namespace=? AND id=?",
      id,
    );
    if (!m) fail("流水不存在", 404);
    permit(db, actor, "finance.read", m.customer);
    return {
      movement: Object.fromEntries(
        Object.entries(m).filter(([k]) => k !== "namespace"),
      ),
      ...detail(db, actor, m.order_id),
    };
  }
  fail("接口不存在", 404);
}
function allowRevision(o, b) {
  if (!Number.isInteger(b.revision) || b.revision !== o.revision)
    fail("订单已变化，请刷新后重新确认", 409);
}
function approve(db, actor, o, b) {
  allowRevision(o, b);
  if (!["reviewer", "controller"].includes(b.node)) fail("未知审批节点");
  const node = b.node === "controller" ? "controller" : "reviewer";
  permit(
    db,
    actor,
    node === "controller" ? "finance.control" : "finance.approve",
    o.customer,
  );
  if (o.requester === actor) fail("申请人不能审批自己的申请", 403);
  if (
    !["pending", "reviewing"].includes(o.approval) ||
    o.execution !== "not_submitted" ||
    o.state === "returned"
  )
    fail("当前状态不可审批", 409);
  if (!o.requiredNodes.includes(node)) fail("不是本单所需审批节点");
  if (!["approve", "reject"].includes(b.decision)) fail("审批决定无效");
  const note = str(b.note, "审批意见");
  if (b.decision === "approve" && o.risk !== "demo_checked")
    fail("风险未检查或有风险，禁止批准", 409);
  if (
    one(
      db,
      "SELECT 1 FROM fn_reviews WHERE namespace=? AND order_id=? AND revision=? AND actor=?",
      o.id,
      o.revision,
      actor,
    )
  )
    fail("当前版本已审批，不能重复审批", 409);
  insert(db, "fn_reviews", {
    namespace: ns,
    order_id: o.id,
    revision: o.revision,
    actor,
    node,
    decision: b.decision,
    note,
    created_at: clock(),
  });
  if (b.decision === "reject") {
    o.approval = "rejected";
    o.state = "rejected";
    release(db, o.id);
  } else {
    const nodes = many(
      db,
      "SELECT node FROM fn_reviews WHERE namespace=? AND order_id=? AND revision=? AND decision='approve'",
      o.id,
      o.revision,
    ).map((x) => x.node);
    o.approval = o.requiredNodes.every((n) => nodes.includes(n))
      ? "approved"
      : "reviewing";
    o.state = o.approval === "approved" ? "awaiting_execution" : "pending";
  }
  audit(db, o.id, actor, b.decision, note);
}
function amend(db, actor, o, b) {
  permit(db, actor, "finance.create", o.customer);
  if (actor !== o.requester) fail("仅发起人可以修改申请", 403);
  allowRevision(o, b);
  if (
    o.kind !== "withdrawal" ||
    o.execution !== "not_submitted" ||
    ["rejected", "cancelled"].includes(o.approval)
  )
    fail("当前状态不可修改", 409);
  addressCheck(b.asset, b.network, b.address);
  amount(b.amountMinor);
  if (
    BigInt(b.amountMinor) < BigInt(FINANCE_POLICY.minWithdraw) ||
    BigInt(b.amountMinor) > BigInt(FINANCE_POLICY.maxWithdraw)
  )
    fail("出金范围 10 至 100000 USDT");
  const before = {
    amount: o.amount_minor,
    address: o.address,
    memo: o.memo,
    revision: o.revision,
    evidence: o.evidence,
  };
  release(db, o.id);
  Object.assign(o, {
    amount_minor: b.amountMinor,
    address: b.address,
    memo: b.memo ? str(b.memo, "Memo", 100) : null,
    reason: str(b.reason, "修改原因"),
    evidence: b.evidence ? str(b.evidence, "凭证引用") : null,
    revision: o.revision + 1,
    approval: "pending",
    state: "pending",
    risk: "unchecked",
    requiredNodes: policyNodes(db, b.amountMinor),
  });
  reserve(
    db,
    o,
    o.source,
    String(BigInt(o.amount_minor) + BigInt(o.fee_minor)),
  );
  audit(
    db,
    o.id,
    actor,
    "amended",
    `旧审批失效；风险需重查。变更前 ${JSON.stringify(before)}；变更后 ${JSON.stringify({ amount: o.amount_minor, address: o.address, memo: o.memo, revision: o.revision, evidence: o.evidence })}`,
  );
}
function confirmOtc(db, actor, o, b) {
  permit(db, actor, "finance.create", o.customer);
  allowRevision(o, b);
  if (o.requester !== actor) fail("仅经办人可确认报价", 403);
  if (o.kind !== "otc" || o.state !== "draft") fail("此订单不能确认", 409);
  const q = quoteRecord(db, o.quoteId);
  if (!q || q.used_by !== o.id || !quoteUsable(db, q))
    fail("报价已更新或过期，请取消草稿并重新确认最新报价", 409);
  const quote = JSON.parse(q.data_json),
    sell = BigInt(o.amount_minor),
    fee = BigInt(o.fee_minor);
  reserve(db, o, o.source, o.amount_minor);
  if (
    BigInt(walletBalance(db, `inventory:${quote.buyAsset}`).availableMinor) <
    BigInt(quote.buyMinor)
  )
    fail("隔离兑换库存余额不足", 409);
  postTransfer(
    db,
    o,
    `${o.id}:sell`,
    "otc",
    o.source,
    `inventory:${o.asset}`,
    String(sell - fee),
  );
  if (fee > 0n)
    postTransfer(
      db,
      o,
      `${o.id}:fee`,
      "fee",
      o.source,
      `fees:${o.asset}`,
      String(fee),
    );
  postTransfer(
    db,
    o,
    `${o.id}:buy`,
    "otc",
    `inventory:${quote.buyAsset}`,
    o.target,
    quote.buyMinor,
  );
  release(db, o.id);
  Object.assign(o, {
    state: "completed",
    execution: "completed",
    approval: "not_required",
    accounting: "posted",
    receiptState: "received",
    paymentState: "paid",
    deliveredMinor: o.amount_minor,
    feePostedMinor: o.fee_minor,
  });
  audit(
    db,
    o.id,
    actor,
    "internal_settlement",
    "报价有效期内确认；同事务完成两种资产的双边账务；无外部银行交割",
  );
}
// Trusted adapter entry point, deliberately not exposed as an unauthenticated HTTP callback.
export function receiveFinanceEvent(db, event) {
  return atomic(db, () => applyEvent(db, event));
}
function applyEvent(db, e) {
  const o = load(db, e.orderId),
    j = one(db, "SELECT * FROM fn_jobs WHERE namespace=? AND order_id=?", o.id);
  if (!j || j.submission_key !== e.submissionKey || j.revision !== e.revision)
    fail("通道结果与提交版本不匹配", 409);
  str(e.eventId, "通道事件ID", 150);
  const digest = hash(e),
    seen = one(
      db,
      "SELECT * FROM fn_events WHERE namespace=? AND event_id=?",
      e.eventId,
    );
  if (seen) {
    if (seen.digest !== digest) fail("事件ID冲突", 409);
    return dto(o);
  }
  if (!["processing", "unknown", "confirmed", "failed"].includes(e.status))
    fail("未知通道结果");
  if (
    typeof e.cumulativeMinor !== "string" ||
    !/^(0|[1-9]\d{0,12})$/.test(e.cumulativeMinor)
  )
    fail("交割金额无效");
  const cumulative = BigInt(e.cumulativeMinor),
    previous = BigInt(o.deliveredMinor),
    total = BigInt(o.amount_minor);
  if (cumulative > total) fail("交割金额超过订单金额", 409);
  let result = "applied";
  if (
    cumulative < previous ||
    (e.status === "confirmed" &&
      cumulative === previous &&
      Number.isInteger(o.confirmations) &&
      e.confirmations < o.confirmations) ||
    ["completed", "failed"].includes(o.execution)
  ) {
    result = "stale_ignored";
  } else if (e.status === "confirmed") {
    if (!Number.isInteger(e.confirmations) || e.confirmations < 20) {
      o.chain = "confirming";
      o.execution = "chain_confirming";
      o.state = "processing";
    } else {
      const delta = cumulative - previous;
      if (delta > 0n) {
        postTransfer(
          db,
          o,
          `${o.id}:delivery:${cumulative}`,
          "withdrawal",
          o.source,
          o.target,
          String(delta),
        );
        const hold = one(
          db,
          "SELECT amount_minor FROM fn_holds WHERE namespace=? AND order_id=?",
          o.id,
        );
        if (!hold || BigInt(hold.amount_minor) < delta)
          fail("预占不足，需对账", 409);
        db.prepare(
          "UPDATE fn_holds SET amount_minor=? WHERE namespace=? AND order_id=?",
        ).run(String(BigInt(hold.amount_minor) - delta), ns, o.id);
        o.deliveredMinor = String(cumulative);
        o.accounting = cumulative === total ? "posted" : "partially_posted";
      }
      o.confirmations = e.confirmations;
      o.chain = "confirmed";
      o.channelReference = e.submissionKey;
      o.txHash = e.txHash || null;
      if (cumulative === total) {
        if (o.feePostedMinor === "0" && BigInt(o.fee_minor) > 0n)
          postTransfer(
            db,
            o,
            `${o.id}:fee`,
            "fee",
            o.source,
            "fees:USDT",
            o.fee_minor,
          );
        o.feePostedMinor = o.fee_minor;
        release(db, o.id);
        o.execution = "completed";
        o.state = "completed";
        o.error = null;
      } else {
        o.execution = "channel_processing";
        o.state = "processing";
      }
    }
  } else if (e.status === "failed") {
    if (cumulative !== previous)
      fail("失败结果含未核实交割金额，需先核对", 409);
    o.execution = "failed";
    o.state = "exception";
    o.error = str(e.reason, "失败原因");
    release(db, o.id);
    o.chain = previous > 0n ? "partially_confirmed" : "not_broadcast";
  } else {
    if (cumulative !== previous) fail("非确认结果不能更改交割金额", 409);
    o.execution = e.status === "unknown" ? "unknown" : "channel_processing";
    o.state = e.status === "unknown" ? "exception" : "processing";
    o.error =
      e.status === "unknown"
        ? "通道结果待确认；资金保持预占；仅查询原提交单"
        : null;
  }
  insert(db, "fn_events", {
    namespace: ns,
    event_id: e.eventId,
    order_id: o.id,
    digest,
    payload_json: JSON.stringify(e),
    result,
    received_at: clock(),
  });
  if (result === "applied") {
    o.updated_at = clock();
    update(db, o);
  }
  audit(
    db,
    o.id,
    "sandbox-channel",
    result,
    `${e.eventId} / ${e.status} / 已确认累计 ${e.cumulativeMinor}`,
  );
  return dto(o);
}
function execute(db, actor, o, b) {
  permit(db, actor, "finance.execute", o.customer);
  allowRevision(o, b);
  if (
    o.kind !== "withdrawal" ||
    o.approval !== "approved" ||
    o.risk !== "demo_checked"
  )
    fail("需批准且完成隔离风险检查后才能执行", 409);
  if (o.execution !== "not_submitted")
    fail("已提交；只能查询原结果，禁止重新出金", 409);
  addressCheck(o.asset, o.network, o.address);
  const h = one(
    db,
    "SELECT amount_minor FROM fn_holds WHERE namespace=? AND order_id=?",
    o.id,
  );
  if (
    !h ||
    BigInt(h.amount_minor) !== BigInt(o.amount_minor) + BigInt(o.fee_minor)
  )
    fail("预占不一致，禁止执行", 409);
  insert(db, "fn_jobs", {
    namespace: ns,
    order_id: o.id,
    revision: o.revision,
    submission_key: `SANDBOX-${o.id}-v${o.revision}`,
    mode: o.channelMode,
    queries: 0,
  });
  o.execution = "submitting";
  o.state = "processing";
  audit(
    db,
    o.id,
    actor,
    "execute",
    "已持久化唯一提交任务；仅本地测试通道，不发送网络付款",
  );
}
function reconcile(db, actor, o, b) {
  permit(db, actor, "finance.execute", o.customer);
  allowRevision(o, b);
  const j = one(
    db,
    "SELECT * FROM fn_jobs WHERE namespace=? AND order_id=?",
    o.id,
  );
  if (!j) fail("未提交执行", 409);
  if (["completed", "failed"].includes(o.execution)) return dto(o);
  const i = j.queries + 1;
  db.prepare(
    "UPDATE fn_jobs SET queries=? WHERE namespace=? AND order_id=?",
  ).run(i, ns, o.id);
  const base = {
    eventId: `${j.submission_key}:query:${i}`,
    orderId: o.id,
    submissionKey: j.submission_key,
    revision: j.revision,
    cumulativeMinor: o.deliveredMinor,
    confirmations: 20,
  };
  if (j.mode === "failure")
    return applyEvent(db, {
      ...base,
      status: "failed",
      reason: "隔离通道明确拒绝；未广播",
    });
  if (j.mode === "timeout" && i === 1)
    return applyEvent(db, { ...base, status: "unknown" });
  if (j.mode === "partial" && i === 1)
    return applyEvent(db, {
      ...base,
      status: "confirmed",
      cumulativeMinor: String(BigInt(o.amount_minor) / 2n),
    });
  return applyEvent(db, {
    ...base,
    status: "confirmed",
    cumulativeMinor: o.amount_minor,
  });
}
export function financeWrite(db, actor, path, b) {
  assertLocal();
  seedFinance(db);
  permit(db, actor, "finance.read");
  str(b.requestId, "幂等请求ID", 100);
  return atomic(db, () => {
    const digest = hash({ path, body: b }),
      old = one(
        db,
        "SELECT * FROM fn_requests WHERE namespace=? AND actor=? AND request_id=?",
        actor,
        b.requestId,
      );
    if (old) {
      if (old.digest !== digest) fail("幂等键已用于不同请求", 409);
      const cached = JSON.parse(old.result_json);
      if (cached.customer) permit(db, actor, "finance.read", cached.customer);
      return cached;
    }
    let result;
    const [type, id, action] = path.split("/");
    if (path === "pricing") {
      const identity = permit(db, actor, "finance.price_manage");
      if (identity.owner_scope !== "*") fail("仅全局报价管理员可调价", 403);
      const current = currentPrice(db),
        r = ratio(b.usdPerUsdt),
        reason = str(b.reason, "调价原因");
      if (b.version !== current.version)
        fail("报价配置已变化，请刷新后重试", 409);
      if (r.value === current.usdPerUsdt) fail("报价未变化");
      insert(db, "fn_fixed_prices", {
        namespace: ns,
        version: current.version + 1,
        usd_per_usdt: r.value,
        actor,
        reason,
        created_at: clock(),
      });
      audit(
        db,
        null,
        actor,
        "pricing_changed",
        JSON.stringify({ from: current, to: currentPrice(db), reason }),
      );
      result = currentPrice(db);
    } else if (path === "quotes") {
      permit(db, actor, "finance.create", b.customer);
      const w = wallet(db, `${str(b.customer, "客户", 100)}:${b.sellAsset}`);
      if (w.kind !== "customer") fail("客户钱包无效");
      const q = quoteValue(b.sellAsset, b.amountMinor, currentPrice(db)),
        qid = `QUOTE-${randomUUID()}`;
      insert(db, "fn_fixed_quotes", {
        namespace: ns,
        id: qid,
        actor,
        customer: b.customer,
        price_version: q.priceVersion,
        used_by: null,
        data_json: JSON.stringify(q),
      });
      audit(db, null, actor, "quote", `${qid} / ${b.customer}`);
      result = { ...q, id: qid };
    } else if (path === "orders") {
      if (b.kind === "withdrawal") result = dto(withdrawal(db, actor, b));
      else if (b.kind === "otc") {
        const q = quoteRecord(db, b.quoteId);
        if (!q || q.actor !== actor || q.used_by || !quoteUsable(db, q))
          fail("报价不可用或已更新，请重新报价", 409);
        permit(db, actor, "finance.create", q.customer);
        const v = JSON.parse(q.data_json),
          o = fresh("otc", q.customer, v.sellAsset, v.sellMinor, actor);
        Object.assign(o, {
          quoteId: q.id,
          quote: v,
          fee_minor: v.feeMinor,
          source: `${q.customer}:${v.sellAsset}`,
          target: `${q.customer}:${v.buyAsset}`,
          reason: str(b.reason, "兑换用途"),
          counterparty: "内部测试兑换库存（非外部交易对手）",
          receiptState: "not_received",
          paymentState: "not_paid",
        });
        save(db, o, true);
        db.prepare(
          `UPDATE ${q.table || "fn_quotes"} SET used_by=? WHERE namespace=? AND id=?`,
        ).run(o.id, ns, q.id);
        audit(db, o.id, actor, "draft", "锁定演示报价；尚未收付或交割");
        result = dto(o);
      } else
        fail("仅支持新建出金或内部 OTC；其他入账必须来自可信通道/调整流程");
    } else if (type === "orders" && id && action) {
      const o = load(db, id);
      permit(db, actor, "finance.read", o.customer);
      if (action === "confirm") confirmOtc(db, actor, o, b);
      else if (action === "review") approve(db, actor, o, b);
      else if (action === "amend") amend(db, actor, o, b);
      else if (action === "risk-check") {
        permit(db, actor, "finance.risk_check", o.customer);
        allowRevision(o, b);
        if (
          o.execution !== "not_submitted" ||
          !["pending", "reviewing"].includes(o.approval)
        )
          fail("当前状态不可重新检查", 409);
        addressCheck(o.asset, o.network, o.address);
        o.risk = o.address.includes("BLOCKED") ? "blocked" : "demo_checked";
        audit(
          db,
          o.id,
          actor,
          "risk_check",
          "仅隔离检查器：验证合成地址和 BLOCKED 测试规则；未接入真实 KYT",
        );
      } else if (["cancel", "return"].includes(action)) {
        permit(
          db,
          actor,
          action === "return" ? "finance.approve" : "finance.create",
          o.customer,
        );
        allowRevision(o, b);
        if (action === "cancel" && o.requester !== actor)
          fail("仅发起人可撤销", 403);
        if (action === "return" && o.requester === actor)
          fail("不能自行退回", 403);
        if (
          o.execution !== "not_submitted" ||
          !["pending", "reviewing", "approved"].includes(o.approval) ||
          BigInt(o.deliveredMinor) > 0n
        )
          fail("已提交或已交割不可撤销/退回", 409);
        str(b.note, "原因");
        if (action === "cancel") {
          o.approval = "cancelled";
          o.state = "cancelled";
          release(db, o.id);
        } else {
          o.state = "returned";
          o.approval = "pending";
          o.revision++;
          o.risk = "unchecked";
        }
        audit(db, o.id, actor, action, b.note);
      } else if (action === "execute") execute(db, actor, o, b);
      else if (action === "reconcile") {
        result = reconcile(db, actor, o, b);
      } else if (action === "payout") {
        permit(db, actor, "finance.create", o.customer);
        allowRevision(o, b);
        if (
          o.kind !== "otc" ||
          o.state !== "completed" ||
          o.quote.buyAsset !== "USDT"
        )
          fail("仅已完成且获得 USDT 的内部兑换可关联出金", 409);
        amount(b.amountMinor);
        let allocated = 0n;
        for (const c of many(
          db,
          "SELECT amount_minor FROM fn_orders WHERE namespace=? AND parent_id=? AND approval NOT IN('rejected','cancelled')",
          o.id,
        ))
          allocated += BigInt(c.amount_minor);
        if (allocated + BigInt(b.amountMinor) > BigInt(o.quote.buyMinor))
          fail("关联出金超过本订单获得资产", 409);
        const child = withdrawal(db, actor, {
          ...b,
          customer: o.customer,
          asset: "USDT",
          network: "TRON",
        });
        child.parent_id = o.id;
        update(db, child);
        audit(
          db,
          o.id,
          actor,
          "linked_payout",
          `关联 ${child.id}；兑换已内部结算，外部交割单独审批`,
        );
        result = dto(child);
      } else fail("操作不存在", 404);
      if (!result) {
        o.updated_at = clock();
        update(db, o);
        result = dto(o);
      }
    } else fail("接口不存在", 404);
    insert(db, "fn_requests", {
      namespace: ns,
      actor,
      request_id: b.requestId,
      digest,
      result_json: JSON.stringify(result),
    });
    return result;
  });
}

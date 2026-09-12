import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openStore,
  assertLocal,
  importDemo,
  DATA_DIR,
} from "../demo-server/slash/store.mjs";
import {
  FINANCE_NS as ns,
  seedFinance,
  financeRead as read,
  financeWrite as write,
  walletBalance,
  receiveFinanceEvent,
  validTronAddress,
  quoteValue,
} from "../demo-server/slash/crypto-finance.mjs";
import {
  seedFinanceScenarios,
  cleanFinance,
} from "../demo-server/slash/crypto-finance-cli.mjs";
import { createDemoServer } from "../demo-server/slash/server.mjs";
import { join } from "node:path";
import { rmSync } from "node:fs";
const maker = "demo-operator",
  reviewer = "demo-reviewer",
  controller = "demo-controller",
  viewer = "demo-viewer";
const setup = () => {
  const db = openStore(":memory:");
  seedFinance(db);
  return db;
};
const cmd = (db, actor, path, b = {}) =>
  write(db, actor, path, { requestId: crypto.randomUUID(), ...b });
const detail = (db, id) => read(db, maker, `orders/${id}`);
const balance = (db) => walletBalance(db, "DEMO-C001:USDT");
const ready = (db, id = "FIN-WITHDRAW-001") => {
  const p = `orders/${id}/`;
  cmd(db, reviewer, p + "risk-check", { revision: 1 });
  cmd(db, reviewer, p + "review", {
    revision: 1,
    decision: "approve",
    node: "reviewer",
    note: "核对隔离金额和地址",
  });
  return detail(db, id).order;
};
const execute = (db, id = "FIN-WITHDRAW-001") => {
  ready(db, id);
  cmd(db, reviewer, `orders/${id}/execute`, { revision: 1 });
  return detail(db, id);
};
const input = (extra = {}) => ({
  kind: "withdrawal",
  customer: "DEMO-C001",
  asset: "USDT",
  network: "TRON",
  amountMinor: "10000000",
  address: "DEMO:TRON:TESTADDRESS",
  reason: "隔离验收",
  ...extra,
});
const newOtc = (db, asset = "USD", amountMinor = "10000") => {
  const q = cmd(db, maker, "quotes", {
    customer: "DEMO-C001",
    sellAsset: asset,
    amountMinor,
  });
  const o = cmd(db, maker, "orders", {
    kind: "otc",
    quoteId: q.id,
    reason: "隔离兑换",
  });
  return { o, q };
};
test("finance: seed is idempotent, ledger balanced, no artificial inflow from opening or holds", () => {
  const db = setup(),
    before = balance(db);
  seedFinance(db);
  assert.deepEqual(balance(db), before);
  assert.equal(before.heldMinor, "1960000000");
  assert.equal(read(db, maker, "flows").total, 7);
  for (const j of db
    .prepare("SELECT id FROM ca_journals WHERE namespace=?")
    .all(ns)) {
    const sum = db
      .prepare(
        "SELECT amount_minor FROM ca_entries WHERE namespace=? AND journal_id=?",
      )
      .all(ns, j.id)
      .reduce((s, e) => s + BigInt(e.amount_minor), 0n);
    assert.equal(sum, 0n);
  }
  db.close();
});
test("finance: payout uses principal plus separate fee exactly once, approval is not payment", () => {
  const db = setup(),
    before = balance(db);
  ready(db);
  assert.equal(balance(db).postedMinor, before.postedMinor);
  assert.equal(detail(db, "FIN-WITHDRAW-001").movements.length, 0);
  cmd(db, reviewer, "orders/FIN-WITHDRAW-001/execute", { revision: 1 });
  const b = { requestId: "query-stable", revision: 1 };
  const a = write(db, reviewer, "orders/FIN-WITHDRAW-001/reconcile", b);
  assert.equal(a.execution, "completed");
  assert.equal(
    BigInt(before.postedMinor) - BigInt(balance(db).postedMinor),
    102000000n,
  );
  assert.equal(
    BigInt(before.heldMinor) - BigInt(balance(db).heldMinor),
    102000000n,
  );
  assert.deepEqual(
    write(db, reviewer, "orders/FIN-WITHDRAW-001/reconcile", b),
    a,
  );
  assert.equal(detail(db, a.id).movements.length, 2);
  db.close();
});
test("finance: exact quote and OTC settle two currencies independently without fee duplication", () => {
  const db = setup();
  assert.equal(quoteValue("USD", "10000").buyMinor, "100505050");
  assert.equal(quoteValue("USDT", "100000000").buyMinor, "9850");
  const usd = walletBalance(db, "DEMO-C001:USD"),
    usdt = balance(db);
  const { o } = newOtc(db);
  cmd(db, maker, `orders/${o.id}/confirm`, { revision: 1 });
  assert.equal(
    BigInt(usd.postedMinor) -
      BigInt(walletBalance(db, "DEMO-C001:USD").postedMinor),
    10000n,
  );
  assert.equal(
    BigInt(balance(db).postedMinor) - BigInt(usdt.postedMinor),
    100505050n,
  );
  const d = detail(db, o.id);
  assert.equal(d.order.receiptState, "received");
  assert.equal(d.order.paymentState, "paid");
  assert.equal(d.movements.length, 3);
  assert.equal(
    d.movements
      .filter((m) => m.asset === "USD")
      .reduce((s, m) => s + BigInt(m.amount_minor), 0n),
    -10000n,
  );
  assert.throws(
    () =>
      cmd(db, maker, `orders/${o.id}/cancel`, {
        revision: 1,
        note: "cancel settled",
      }),
    /不可|状态/,
  );
  db.close();
});
test("finance: expired quotes cannot be confirmed or reused, server time is authoritative", () => {
  const db = setup();
  const { o, q } = newOtc(db);
  // Legacy expiring quotes retain their original validity rule after additive migration.
  const old = db.prepare("SELECT * FROM fn_fixed_quotes WHERE id=?").get(q.id);
  db.prepare("INSERT INTO fn_quotes VALUES(?,?,?,?,?,?,?)").run(
    ns,
    q.id,
    old.actor,
    old.customer,
    "2000-01-01T00:00:00.000Z",
    o.id,
    old.data_json,
  );
  db.prepare("DELETE FROM fn_fixed_quotes WHERE id=?").run(q.id);
  const b = balance(db);
  assert.throws(
    () =>
      cmd(db, maker, `orders/${o.id}/confirm`, {
        revision: 1,
        now: "1999-01-01",
      }),
    /过期/,
  );
  assert.deepEqual(balance(db), b);
  assert.throws(
    () =>
      cmd(db, maker, "orders", { kind: "otc", quoteId: q.id, reason: "reuse" }),
    /报价不可用/,
  );
  db.close();
});
test("finance: quote direction precision and amount validation", () => {
  for (const v of ["0", "-1", "1.1", "1e6", "01", "1000000000001"])
    assert.throws(() => quoteValue("USD", v), /金额/);
  assert.throws(() => quoteValue("BTC", "1000"), /仅支持/);
  assert.throws(() => quoteValue("USDT", "1"), /最小单位/);
});
test("finance: permissions, customer scope, and no self approval enforced in backend", () => {
  const db = setup();
  assert.throws(() => cmd(db, viewer, "orders", input()), /权限/);
  assert.throws(
    () => cmd(db, maker, "orders/FIN-WITHDRAW-001/execute", { revision: 1 }),
    /权限/,
  );
  db.prepare(
    "UPDATE ca_principals SET permissions_json=? WHERE namespace=? AND actor=?",
  ).run(JSON.stringify(["finance.read", "finance.approve"]), ns, maker);
  assert.throws(
    () =>
      cmd(db, maker, "orders/FIN-WITHDRAW-001/review", {
        revision: 1,
        decision: "approve",
        node: "reviewer",
        note: "self",
      }),
    /申请人不能/,
  );
  db.prepare(
    "UPDATE ca_principals SET owner_scope=? WHERE namespace=? AND actor=?",
  ).run("DEMO-C002", ns, viewer);
  assert.throws(() => read(db, viewer, "orders/FIN-WITHDRAW-001"), /范围/);
  assert.equal(read(db, viewer, "orders").total, 0);
  assert.equal(read(db, viewer, "flows").total, 0);
  assert.throws(() => read(db, viewer, "export"), /权限/);
  assert.equal(read(db, viewer, "context").wallets.length, 2);
  db.close();
});
test("finance: reserve enforces available balance and concurrent applications cannot overbook", () => {
  const db = setup();
  const b = balance(db);
  const big = String(
    ((BigInt(b.availableMinor) - 2000000n) / 1000000n) * 1000000n,
  );
  cmd(db, maker, "orders", input({ amountMinor: big }));
  assert.throws(() => cmd(db, maker, "orders", input()), /余额不足/);
  assert.equal(balance(db).postedMinor, b.postedMinor);
  db.close();
});
test("finance: real or wrong-network addresses rejected, TRON checksum verified", () => {
  assert.equal(validTronAddress("TJRabPrwbZy45sbavfcjinPJC18kjpRTv8"), true);
  assert.equal(validTronAddress("TJRabPrwbZy45sbavfcjinPJC18kjpRTv9"), false);
  const db = setup();
  for (const extra of [
    { asset: "USD" },
    { network: "ETHEREUM" },
    { address: "0x1234" },
    { address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8" },
  ])
    assert.throws(() => cmd(db, maker, "orders", input(extra)), /支持|地址/);
  db.close();
});
test("finance: risk unchecked/blocked cannot approve, evidence cannot bypass checks", () => {
  const db = setup();
  assert.equal(detail(db, "FIN-WITHDRAW-001").order.risk, "unchecked");
  assert.throws(
    () =>
      cmd(db, reviewer, "orders/FIN-WITHDRAW-001/review", {
        revision: 1,
        node: "reviewer",
        decision: "approve",
        note: "approve",
        risk: "passed",
      }),
    /风险未检查/,
  );
  const o = cmd(
    db,
    maker,
    "orders",
    input({ address: "DEMO:TRON:BLOCKED_ADDRESS", evidence: "receipt.pdf" }),
  );
  cmd(db, reviewer, `orders/${o.id}/risk-check`, { revision: 1 });
  assert.equal(detail(db, o.id).order.risk, "blocked");
  assert.throws(
    () =>
      cmd(db, reviewer, `orders/${o.id}/review`, {
        revision: 1,
        node: "reviewer",
        decision: "approve",
        note: "approve",
      }),
    /风险/,
  );
  db.close();
});
test("finance: amount tiers need two distinct role nodes, duplicate approval rejected", () => {
  const db = setup();
  ready(db, "FIN-WITHDRAW-TIER2");
  const p = "orders/FIN-WITHDRAW-TIER2/";
  assert.equal(detail(db, "FIN-WITHDRAW-TIER2").order.approval, "reviewing");
  assert.throws(
    () => cmd(db, reviewer, p + "execute", { revision: 1 }),
    /批准/,
  );
  assert.throws(
    () =>
      cmd(db, reviewer, p + "review", {
        revision: 1,
        node: "reviewer",
        decision: "approve",
        note: "repeat",
      }),
    /重复/,
  );
  assert.throws(
    () =>
      cmd(db, reviewer, p + "review", {
        revision: 1,
        node: "controller",
        decision: "approve",
        note: "forged role",
      }),
    /权限/,
  );
  cmd(db, controller, p + "review", {
    revision: 1,
    node: "controller",
    decision: "approve",
    note: "second controller",
  });
  assert.equal(detail(db, "FIN-WITHDRAW-TIER2").order.approval, "approved");
  db.close();
});
test("finance: rejected/cancelled release holds once, no postings", () => {
  const db = setup(),
    before = balance(db);
  const path = "orders/FIN-WITHDRAW-001/review";
  const b = {
    requestId: "reject",
    revision: 1,
    node: "reviewer",
    decision: "reject",
    note: "资料不足",
  };
  write(db, reviewer, path, b);
  write(db, reviewer, path, b);
  assert.equal(
    BigInt(before.heldMinor) - BigInt(balance(db).heldMinor),
    102000000n,
  );
  assert.equal(balance(db).postedMinor, before.postedMinor);
  assert.equal(detail(db, "FIN-WITHDRAW-001").movements.length, 0);
  assert.throws(
    () => cmd(db, reviewer, "orders/FIN-WITHDRAW-001/execute", { revision: 1 }),
    /批准/,
  );
  db.close();
});
test("finance: amend invalidates prior approvals atomically and rechecks risk/reserves", () => {
  const db = setup();
  ready(db);
  const p = "orders/FIN-WITHDRAW-001/",
    before = balance(db);
  const o = cmd(db, maker, p + "amend", {
    revision: 1,
    asset: "USDT",
    network: "TRON",
    amountMinor: "120000000",
    address: "DEMO:TRON:CHANGED",
    reason: "new beneficiary",
  });
  assert.equal(o.revision, 2);
  assert.equal(o.approval, "pending");
  assert.equal(o.risk, "unchecked");
  assert.equal(detail(db, o.id).reviews.length, 1);
  assert.equal(
    BigInt(balance(db).heldMinor) - BigInt(before.heldMinor),
    20000000n,
  );
  assert.throws(
    () => cmd(db, reviewer, p + "execute", { revision: 1 }),
    /已变化/,
  );
  assert.throws(
    () =>
      cmd(db, maker, p + "amend", {
        revision: 2,
        asset: "USDT",
        network: "TRON",
        amountMinor: "100000000000",
        address: "DEMO:TRON:CHANGED",
        reason: "overdraw",
      }),
    /余额不足/,
  );
  assert.equal(detail(db, o.id).order.revision, 2);
  db.close();
});
test("finance: return requires revision resubmission and cannot release still-open holds", () => {
  const db = setup();
  const before = balance(db);
  cmd(db, reviewer, "orders/FIN-WITHDRAW-001/return", {
    revision: 1,
    note: "补充凭证",
  });
  const o = detail(db, "FIN-WITHDRAW-001").order;
  assert.equal(o.state, "returned");
  assert.equal(o.revision, 2);
  assert.deepEqual(balance(db), before);
  assert.throws(
    () =>
      cmd(db, reviewer, `orders/${o.id}/review`, {
        revision: 2,
        node: "reviewer",
        decision: "approve",
        note: "bad",
      }),
    /状态/,
  );
  db.close();
});
test("finance: timeout retains funds and query original submission resolves without repeat sending", () => {
  const db = setup(),
    before = balance(db);
  execute(db, "FIN-WITHDRAW-TIMEOUT");
  const p = "orders/FIN-WITHDRAW-TIMEOUT/";
  cmd(db, reviewer, p + "reconcile", { revision: 1 });
  assert.equal(detail(db, "FIN-WITHDRAW-TIMEOUT").order.execution, "unknown");
  assert.deepEqual(balance(db), before);
  assert.throws(
    () => cmd(db, reviewer, p + "execute", { revision: 1 }),
    /已提交/,
  );
  assert.throws(
    () => cmd(db, maker, p + "cancel", { revision: 1, note: "timeout" }),
    /不可/,
  );
  cmd(db, reviewer, p + "reconcile", { revision: 1 });
  assert.equal(detail(db, "FIN-WITHDRAW-TIMEOUT").order.execution, "completed");
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM fn_jobs WHERE namespace=? AND order_id=?",
      )
      .get(ns, "FIN-WITHDRAW-TIMEOUT").n,
    1,
  );
  db.close();
});
test("finance: partial settlement cannot be cancelled and final settlement only posts delta/one fee", () => {
  const db = setup(),
    before = balance(db);
  execute(db, "FIN-WITHDRAW-PARTIAL");
  const p = "orders/FIN-WITHDRAW-PARTIAL/";
  cmd(db, reviewer, p + "reconcile", { revision: 1 });
  let d = detail(db, "FIN-WITHDRAW-PARTIAL");
  assert.equal(d.order.deliveredMinor, "100000000");
  assert.equal(d.order.remainingMinor, "100000000");
  assert.equal(d.order.feePostedMinor, "0");
  assert.equal(
    BigInt(before.postedMinor) - BigInt(balance(db).postedMinor),
    100000000n,
  );
  assert.throws(
    () => cmd(db, maker, p + "cancel", { revision: 1, note: "cancel partial" }),
    /不可/,
  );
  cmd(db, reviewer, p + "reconcile", { revision: 1 });
  d = detail(db, d.order.id);
  assert.equal(d.order.deliveredMinor, "200000000");
  assert.equal(d.movements.length, 3);
  assert.equal(
    BigInt(before.postedMinor) - BigInt(balance(db).postedMinor),
    202000000n,
  );
  db.close();
});
test("finance: duplicate/stale/conflicting/mismatched callbacks never double-post or roll back amount", () => {
  const db = setup();
  const d = execute(db),
    key = d.job.submission_key,
    id = d.order.id;
  const event = {
    eventId: "cb-1",
    orderId: id,
    submissionKey: key,
    revision: 1,
    status: "confirmed",
    cumulativeMinor: "100000000",
    confirmations: 20,
  };
  receiveFinanceEvent(db, event);
  const b = balance(db);
  receiveFinanceEvent(db, event);
  receiveFinanceEvent(db, {
    ...event,
    eventId: "cb-old",
    status: "unknown",
    cumulativeMinor: "0",
  });
  assert.deepEqual(balance(db), b);
  assert.equal(detail(db, id).order.execution, "completed");
  assert.throws(
    () => receiveFinanceEvent(db, { ...event, cumulativeMinor: "1" }),
    /冲突/,
  );
  assert.throws(
    () =>
      receiveFinanceEvent(db, {
        ...event,
        eventId: "bad",
        submissionKey: "other",
      }),
    /版本不匹配/,
  );
  assert.equal(detail(db, id).events.length, 2);
  db.close();
});
test("finance: insufficient chain confirmations do not post; confirmed callback completes", () => {
  const db = setup(),
    b = balance(db),
    d = execute(db);
  const e = {
    eventId: "confirm-1",
    orderId: d.order.id,
    submissionKey: d.job.submission_key,
    revision: 1,
    status: "confirmed",
    cumulativeMinor: "100000000",
    confirmations: 2,
  };
  receiveFinanceEvent(db, e);
  assert.deepEqual(balance(db), b);
  assert.equal(detail(db, d.order.id).order.execution, "chain_confirming");
  receiveFinanceEvent(db, { ...e, eventId: "confirm-2", confirmations: 20 });
  assert.equal(detail(db, d.order.id).order.execution, "completed");
  db.close();
});
test("finance: confirmed failure releases unspent holds, never posts or retries", () => {
  const db = setup(),
    before = balance(db);
  execute(db, "FIN-WITHDRAW-FAILED");
  cmd(db, reviewer, "orders/FIN-WITHDRAW-FAILED/reconcile", { revision: 1 });
  const o = detail(db, "FIN-WITHDRAW-FAILED").order;
  assert.equal(o.execution, "failed");
  assert.equal(balance(db).postedMinor, before.postedMinor);
  assert.equal(
    BigInt(before.heldMinor) - BigInt(balance(db).heldMinor),
    72000000n,
  );
  assert.throws(
    () => cmd(db, reviewer, `orders/${o.id}/execute`, { revision: 1 }),
    /已提交/,
  );
  db.close();
});
test("finance: downstream ledger failure rolls back posting/event/order/hold together", () => {
  const db = setup(),
    d = execute(db),
    before = balance(db);
  db.exec(
    "CREATE TRIGGER fn_fault BEFORE INSERT ON ca_entries WHEN NEW.account_id='external:USDT' BEGIN SELECT RAISE(ABORT,'injected failure'); END",
  );
  assert.throws(
    () => cmd(db, reviewer, `orders/${d.order.id}/reconcile`, { revision: 1 }),
    /injected/,
  );
  assert.deepEqual(balance(db), before);
  assert.equal(detail(db, d.order.id).events.length, 0);
  assert.equal(detail(db, d.order.id).order.execution, "submitting");
  db.exec("DROP TRIGGER fn_fault");
  cmd(db, reviewer, `orders/${d.order.id}/reconcile`, { revision: 1 });
  assert.equal(detail(db, d.order.id).order.execution, "completed");
  db.close();
});
test("finance: linked OTC payout is capped and cannot bypass approval", () => {
  const db = setup(),
    { o } = newOtc(db);
  cmd(db, maker, `orders/${o.id}/confirm`, { revision: 1 });
  const body = {
    revision: 1,
    amountMinor: "60000000",
    address: "DEMO:TRON:OTCPAYOUT",
    reason: "deliver acquired USDT",
  };
  const p = cmd(db, maker, `orders/${o.id}/payout`, body);
  assert.equal(p.parent_id, o.id);
  assert.equal(p.approval, "pending");
  assert.equal(p.execution, "not_submitted");
  assert.throws(() => cmd(db, maker, `orders/${o.id}/payout`, body), /超过/);
  assert.throws(
    () => cmd(db, reviewer, `orders/${p.id}/execute`, { revision: 1 }),
    /批准/,
  );
  db.close();
});
test("finance: immutable movements retain corrections and query/filter/export totals agree", () => {
  const db = setup();
  const p = read(db, maker, "flows", {
    asset: "USDT",
    customer: "DEMO-C001",
    pageSize: "1",
    sort: "amount_minor",
    direction: "asc",
  });
  assert.equal(p.total, 4);
  assert.equal(p.rows.length, 1);
  assert.equal(p.totals[0].netMinor, "161000000");
  const ex = read(db, maker, "export", {
    asset: "USDT",
    customer: "DEMO-C001",
  });
  assert.equal(ex.count, p.total);
  assert.ok(ex.csv.includes("FIN-REFUND-001"));
  assert.throws(
    () =>
      db
        .prepare("UPDATE fn_movements SET amount_minor='0' WHERE namespace=?")
        .run(ns),
    /immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM ca_entries WHERE namespace=?").run(ns),
    /immutable/,
  );
  assert.throws(() => read(db, maker, "flows", { minAmount: "1" }), /选择资产/);
  assert.throws(() => read(db, maker, "flows", { from: "2026-09-07" }), /时区/);
  assert.throws(() => read(db, maker, "flows", { unknown: "x" }), /不支持/);
  assert.throws(() => read(db, maker, "orders/id/extra"), /不存在/);
  db.close();
});
test("finance: request-id payload conflict rejected and unknown callback API absent", () => {
  const db = setup(),
    b = { ...input(), requestId: "same" };
  const o = write(db, maker, "orders", b);
  assert.deepEqual(write(db, maker, "orders", b), o);
  assert.throws(
    () => write(db, maker, "orders", { ...b, amountMinor: "20000000" }),
    /幂等键/,
  );
  assert.throws(
    () => cmd(db, maker, "callback", { status: "completed" }),
    /不存在/,
  );
  db.close();
});
test("finance: scoped clean/reimport preserves source and card ledger data", () => {
  const db = setup();
  importDemo(db, { namespace: "finance-source-control", persist: false });
  const old = db.prepare("SELECT count(*) n FROM source_records").get().n;
  seedFinanceScenarios(db);
  const count = db.prepare("SELECT count(*) n FROM fn_movements").get().n;
  seedFinanceScenarios(db);
  assert.equal(
    db.prepare("SELECT count(*) n FROM fn_movements").get().n,
    count,
  );
  cleanFinance(db);
  assert.equal(
    db.prepare("SELECT count(*) n FROM source_records").get().n,
    old,
  );
  seedFinance(db);
  assert.equal(read(db, maker, "orders").total, 9);
  db.close();
});
test("finance: persisted submit survives reopen and does not create another payment", () => {
  const path = join(DATA_DIR, `finance-test-${crypto.randomUUID()}.sqlite`);
  let db = openStore(path);
  try {
    seedFinance(db);
    execute(db);
    db.close();
    db = openStore(path);
    cmd(db, reviewer, "orders/FIN-WITHDRAW-001/reconcile", { revision: 1 });
    const p = balance(db).postedMinor;
    db.close();
    db = openStore(path);
    cmd(db, reviewer, "orders/FIN-WITHDRAW-001/reconcile", { revision: 1 });
    assert.equal(balance(db).postedMinor, p);
    assert.equal(detail(db, "FIN-WITHDRAW-001").movements.length, 2);
  } finally {
    db.close();
    for (const f of [path, path + "-wal", path + "-shm"])
      rmSync(f, { force: true });
  }
});
test("finance: production configurations are refused before writes", () => {
  assert.throws(() => assertLocal({ NODE_ENV: "production" }), /production/);
  assert.throws(
    () => assertLocal({ DATABASE_URL: "https://example.com/db" }),
    /non-local/,
  );
});
test("finance HTTP: authenticated cookie, origin, role enforcement and JSON money contract", async () => {
  const db = openStore(":memory:");
  importDemo(db, { namespace: "finance-http-test", persist: false });
  const server = createDemoServer(db, "finance-http-test");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo/management/`;
  try {
    let r = await fetch(url + "finance/context");
    assert.equal(r.status, 401);
    r = await fetch(url + "session", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:8852",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "viewer@example.com",
        password: "demo-only",
      }),
    });
    const cookie = r.headers.get("set-cookie").split(";")[0];
    r = await fetch(url + "finance/context", { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const c = (await r.json()).data;
    assert.equal(typeof c.wallets[0].availableMinor, "string");
    r = await fetch(url + "finance/orders", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://127.0.0.1:8852",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...input(), requestId: "http-create" }),
    });
    assert.equal(r.status, 403);
    r = await fetch(url + "finance/quotes", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://example.com" },
      body: "{}",
    });
    assert.equal(r.status, 403);
    r = await fetch(url + "finance/callback", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:8852" },
      body: JSON.stringify({ requestId: "cb" }),
    });
    assert.equal(r.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test("finance: account-scoped details never reveal counterparty balances or postings", () => {
  const db = setup();
  db.prepare(
    "UPDATE ca_principals SET owner_scope=? WHERE namespace=? AND actor=?",
  ).run("DEMO-C001", ns, viewer);
  const d = read(db, viewer, "orders/FIN-REFUND-001");
  assert.equal(d.wallet.customer, "DEMO-C001");
  assert.ok(d.movements.every((m) => m.customer === "DEMO-C001"));
  db.close();
});
test("finance: configured tiers snapshot to new requests, invalid/unconfigured policy fails closed", () => {
  const db = setup();
  db.prepare("UPDATE fn_policies SET tiers_json=? WHERE namespace=?").run(
    JSON.stringify([
      { upToMinor: "100000000000", nodes: ["reviewer", "controller"] },
    ]),
    ns,
  );
  const o = cmd(db, maker, "orders", input());
  assert.deepEqual(o.requiredNodes, ["reviewer", "controller"]);
  assert.deepEqual(detail(db, "FIN-WITHDRAW-001").order.requiredNodes, [
    "reviewer",
  ]);
  db.prepare("UPDATE fn_policies SET mode='disabled' WHERE namespace=?").run(
    ns,
  );
  assert.throws(() => cmd(db, maker, "orders", input()), /策略未配置/);
  db.close();
});
test("finance: critical-field audit retains old and new values, attachment is only reference", () => {
  const db = setup();
  cmd(db, maker, "orders/FIN-WITHDRAW-001/amend", {
    revision: 1,
    asset: "USDT",
    network: "TRON",
    amountMinor: "120000000",
    address: "DEMO:TRON:NEW_BENEFICIARY",
    reason: "修改金额及地址",
    evidence: "DEMO-EVIDENCE-v2",
  });
  const d = detail(db, "FIN-WITHDRAW-001"),
    t = d.timeline.find((t) => t.action === "amended");
  assert.ok(t.note.includes("100000000"));
  assert.ok(t.note.includes("120000000"));
  assert.ok(t.note.includes("DEMO:TRON:NEW_BENEFICIARY"));
  assert.equal(d.order.evidence, "DEMO-EVIDENCE-v2");
  assert.equal(d.order.accounting, "unposted");
  assert.equal(d.order.risk, "unchecked");
  db.close();
});
test("finance: partial delivery then definite failure preserves delivered money and releases only remainder", () => {
  const db = setup(),
    before = balance(db);
  execute(db, "FIN-WITHDRAW-PARTIAL");
  cmd(db, reviewer, "orders/FIN-WITHDRAW-PARTIAL/reconcile", { revision: 1 });
  const d = detail(db, "FIN-WITHDRAW-PARTIAL");
  receiveFinanceEvent(db, {
    eventId: "partial-final-fail",
    orderId: d.order.id,
    revision: 1,
    submissionKey: d.job.submission_key,
    status: "failed",
    cumulativeMinor: "100000000",
    reason: "隔离通道确认剩余部分未发送",
  });
  const after = balance(db);
  assert.equal(
    BigInt(before.postedMinor) - BigInt(after.postedMinor),
    100000000n,
  );
  assert.equal(BigInt(before.heldMinor) - BigInt(after.heldMinor), 202000000n);
  assert.equal(detail(db, d.order.id).order.deliveredMinor, "100000000");
  assert.equal(detail(db, d.order.id).order.remainingMinor, "100000000");
  db.close();
});
test("finance: half-open UTC filters and page order remain backend-controlled", () => {
  const db = setup();
  const first = read(db, maker, "flows", {
    pageSize: "1",
    sort: "id",
    direction: "asc",
  }).rows[0];
  const all = read(db, maker, "flows", {
    from: first.created_at,
    to: new Date(Date.parse(first.created_at) + 86400000).toISOString(),
  });
  assert.ok(all.rows.some((r) => r.id === first.id));
  assert.equal(
    read(db, maker, "flows", { to: first.created_at }).rows.some(
      (r) => r.id === first.id,
    ),
    false,
  );
  const p1 = read(db, maker, "flows", {
      pageSize: "2",
      page: "0",
      sort: "id",
      direction: "asc",
    }),
    p2 = read(db, maker, "flows", {
      pageSize: "2",
      page: "1",
      sort: "id",
      direction: "asc",
    });
  assert.ok(!p1.rows.some((r) => p2.rows.some((s) => s.id === r.id)));
  db.close();
});
test("finance: all payout operations remain offline and never call a real transport", () => {
  const db = setup(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw new Error("network forbidden");
  };
  try {
    execute(db);
    cmd(db, reviewer, "orders/FIN-WITHDRAW-001/reconcile", { revision: 1 });
    assert.equal(calls, 0);
    assert.equal(detail(db, "FIN-WITHDRAW-001").order.execution, "completed");
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test("finance: same-millisecond ledger display preserves insertion sequence and balance changes", () => {
  const db = setup(),
    { o } = newOtc(db);
  cmd(db, maker, `orders/${o.id}/confirm`, { revision: 1 });
  const rows = detail(db, o.id).movements;
  assert.deepEqual(
    rows.map((r) => r.journal_id.split(":").at(-1)),
    ["sell", "fee", "buy"],
  );
  assert.equal(rows[0].after_minor, rows[1].before_minor);
  db.close();
});

test("finance fixed pricing: user default 0.99 is exact in both directions and never expires with clock", () => {
  const db = setup(),
    { o, q } = newOtc(db, "USDT", "100000000"),
    now = Date.now;
  assert.equal(q.usdPerUsdt, "0.99");
  assert.equal(q.expiresAt, null);
  assert.equal(q.buyMinor, "9850");
  assert.equal(q.feeMinor, "500000");
  try {
    Date.now = () => now() + 864000000;
    cmd(db, maker, `orders/${o.id}/confirm`, { revision: 1 });
  } finally {
    Date.now = now;
  }
  assert.equal(detail(db, o.id).order.state, "completed");
  assert.equal(quoteValue("USD", "9900").buyMinor, "99494949");
  assert.equal(
    quoteValue("USDT", "100000000", { version: 2, usdPerUsdt: "0.99000001" })
      .buyMinor,
    "9850",
  );
  db.close();
});
test("finance fixed pricing: permissions, decimal validation, version conflicts and idempotency", () => {
  const db = setup(),
    input = { usdPerUsdt: "0.98", version: 1, reason: "isolated custom price" };
  for (const actor of [maker, reviewer, viewer])
    assert.throws(() => cmd(db, actor, "pricing", input), /权限/);
  for (const value of [
    "0",
    "-1",
    "NaN",
    "1e-2",
    "0.123456789",
    0.99,
    "1001",
    "01.0",
  ])
    assert.throws(
      () => cmd(db, controller, "pricing", { ...input, usdPerUsdt: value }),
      /比例/,
    );
  const body = { ...input, requestId: "price-idempotency" };
  const result = write(db, controller, "pricing", body);
  assert.equal(result.version, 2);
  assert.deepEqual(write(db, controller, "pricing", body), result);
  assert.throws(
    () => cmd(db, controller, "pricing", { ...input, usdPerUsdt: "0.97" }),
    /刷新/,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM fn_fixed_prices WHERE namespace=?")
      .get(ns).n,
    2,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM fn_audit WHERE namespace=? AND action='pricing_changed'",
      )
      .get(ns).n,
    1,
  );
  seedFinance(db);
  assert.equal(read(db, maker, "context").fixedPrice.usdPerUsdt, "0.98");
  db.close();
});
test("finance fixed pricing: repricing invalidates unconfirmed versions but never rewrites completed money", () => {
  const db = setup(),
    completed = newOtc(db, "USDT", "100000000"),
    draft = newOtc(db, "USDT", "100000000");
  cmd(db, maker, `orders/${completed.o.id}/confirm`, { revision: 1 });
  const snapshot = detail(db, completed.o.id),
    before = balance(db);
  const unused = cmd(db, maker, "quotes", {
    customer: "DEMO-C001",
    sellAsset: "USDT",
    amountMinor: "100000000",
  });
  cmd(db, controller, "pricing", {
    version: 1,
    usdPerUsdt: "0.95",
    reason: "new fixed ratio",
  });
  assert.throws(
    () => cmd(db, maker, `orders/${draft.o.id}/confirm`, { revision: 1 }),
    /已更新/,
  );
  assert.throws(
    () =>
      cmd(db, maker, "orders", {
        kind: "otc",
        quoteId: unused.id,
        reason: "old quote",
      }),
    /已更新/,
  );
  assert.deepEqual(balance(db), before);
  assert.deepEqual(detail(db, completed.o.id).movements, snapshot.movements);
  assert.equal(detail(db, completed.o.id).order.quote.usdPerUsdt, "0.99");
  const next = newOtc(db, "USDT", "100000000");
  assert.equal(next.q.buyMinor, "9452");
  assert.equal(next.q.priceVersion, 2);
  cmd(db, maker, `orders/${next.o.id}/confirm`, { revision: 1 });
  assert.equal(detail(db, next.o.id).order.state, "completed");
  db.close();
});

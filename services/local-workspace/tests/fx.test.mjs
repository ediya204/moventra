import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  openStore,
  importDemo,
  counts,
  assertLocal,
} from "../demo-server/slash/store.mjs";
import { NAMESPACE as legacyNS } from "../demo-server/slash/generate.mjs";
import {
  NS,
  integer,
  rate,
  parseSourceJSON,
  normalize,
  rowDTO,
} from "../demo-server/slash/fx/model.mjs";
import { importFX, fxCounts, cleanFX } from "../demo-server/slash/fx/demo.mjs";
import {
  register,
  beginRead,
  applyRead,
  receiveEvent,
  addRelation,
} from "../demo-server/slash/fx/store.mjs";
import {
  detail,
  report,
  list,
  balances,
  exportCSV,
  fxRead,
} from "../demo-server/slash/fx/query.mjs";
import { createDemoServer } from "../demo-server/slash/server.mjs";
const id = (scenario, suffix = "T1") => `FX-R001-${scenario}-${suffix}`;
function setup(t) {
  const db = openStore(":memory:");
  importFX(db);
  t.after(() => db.close());
  return db;
}
function source(db, i = id("FX01")) {
  return JSON.parse(
    db
      .prepare("SELECT source_json FROM fx_records WHERE namespace=? AND id=?")
      .get(NS, i).source_json,
  );
}
function add(db, i, amount, extra = {}, inside = {}) {
  const s = { ...source(db), id: i, amountCents: amount, ...extra };
  register(db, NS, i, s, {
    connectionId: "DEMO-SLASH-CONNECTION",
    entityId: "DEMO-FX-ENTITY",
    scenario: "TEST",
    category: "purchase",
    feeTreatment: "included",
    matching: "demo_verified",
    ...inside,
  });
  applyRead(db, NS, i, beginRead(db, NS, i), s);
  return s;
}
test("Canonical dual-currency net is CNY360 and USD52.21, not authorization plus posting nor duplicate fee", (t) => {
  const db = setup(t),
    d = detail(db, id("FX01"));
  assert.equal(d.authorizationAmount.minor, "-10000");
  assert.equal(d.record.accountAmount.minor, "-10100");
  assert.equal(d.net.original.minor, "36000");
  assert.equal(d.net.account.minor, "5221");
  assert.equal(d.net.refund.minor, "4980");
  assert.equal(d.fees.fx, "101");
  assert.equal(d.feeDetails[0].feeAmountCents, "101");
  assert.equal(d.net.confirmedWithinDemo, true);
  assert.equal(d.history.rows.length, 4);
  assert.equal(
    d.history.rows.filter((r) => r.result === "superseded_request").length,
    1,
  );
  const r = report(db, { scenario: "FX01" });
  assert.equal(r.accounts[0].outflow, "10201");
  assert.equal(r.accounts[0].inflow, "4980");
  assert.equal(r.accounts[0].net, "5221");
  assert.equal(r.originals[0].net, "36000");
  assert.equal(list(db, { scenario: "FX01" }).total, 3);
  assert.equal(
    balances(db, { account: d.record.source.accountId }).rows[0].difference
      .minor,
    "0",
  );
});
test("Original currencies stay separate; multiple refunds retain IDs and actual amounts", (t) => {
  const db = setup(t),
    d = detail(db, id("FX02"));
  assert.equal(d.net.account.minor, "5950");
  assert.equal(d.net.original.minor, "21725");
  assert.equal(d.net.refund.minor, "4050");
  assert.equal(d.relations.filter((r) => r.kind === "refund").length, 2);
  assert.equal(d.record.originalAmount.minor, "-36725");
  const codes = report(db).originals.map((r) => r.currency);
  assert.ok(codes.includes("AED") && codes.includes("CNY"));
});
test("Full original refund leaves USD1 residual without fabricated FX gain classification", (t) => {
  const d = detail(setup(t), id("FX03"));
  assert.equal(d.net.original.minor, "0");
  assert.equal(d.net.account.minor, "100");
  assert.ok(!("fxGain" in d.net));
});
test("Cross-month reporting supports posted-date and original consumption attribution with timezone boundaries", (t) => {
  const db = setup(t);
  assert.equal(
    report(db, { scenario: "FX01", from: "2026-08-01", to: "2026-08-31" })
      .accounts[0].net,
    "10201",
  );
  assert.equal(
    report(db, { scenario: "FX01", from: "2026-09-01", to: "2026-09-30" })
      .accounts[0].net,
    "-4980",
  );
  assert.equal(
    report(db, {
      scenario: "FX01",
      basis: "order",
      from: "2026-08-01",
      to: "2026-08-31",
    }).accounts[0].net,
    "5221",
  );
  assert.equal(
    report(db, {
      scenario: "FX01",
      basis: "order",
      from: "2026-09-01",
      to: "2026-09-30",
    }).accounts.length,
    0,
  );
  assert.equal(
    report(db, {
      scenario: "FX02",
      timezone: "UTC",
      from: "2026-08-01",
      to: "2026-08-31",
    }).accounts[0].net,
    "7300",
  );
  assert.equal(
    report(db, {
      scenario: "FX02",
      timezone: "Asia/Hong_Kong",
      from: "2026-08-01",
      to: "2026-08-31",
    }).accounts[0].net,
    "10000",
  );
});
test("Included fee annotation has no additional debit, pending cashback not income, reversal separate", (t) => {
  const db = setup(t);
  assert.equal(detail(db, id("FX04")).net.account.minor, "10100");
  const r = report(db, { scenario: "FX05" }).accounts[0];
  assert.equal(r.pending.cashback, "20");
  assert.equal(r.posted.cashback, "50");
  assert.equal(r.posted.cashback_adjustment, "-50");
  assert.equal(r.net, "2000");
});
test("Null rate, missing authorization and fee are not zero; zero and non-Slash scale0 remain valid", (t) => {
  const db = setup(t),
    d = detail(db, id("FX06"));
  assert.equal(d.record.providerRate, null);
  assert.equal(d.fees.fx, null);
  assert.equal(d.authorizationAmount, null);
  assert.equal(d.net.confirmedWithinDemo, false);
  assert.ok(d.net.issues.includes("来源汇率缺失"));
  const zero = detail(db, id("FX10"));
  assert.equal(zero.record.accountAmount.minor, "0");
  assert.equal(zero.record.accountAmount.scale, 0);
  const n = normalize(
    {
      id: "other",
      amountCents: "-1234",
      status: "posted",
      detailedStatus: "settled",
    },
    {
      platform: "another",
      accountCurrency: "KWD",
      accountScale: 3,
      category: "purchase",
    },
  );
  assert.equal(n.scale, 3);
  assert.equal(n.original, null);
  assert.equal(
    normalize(
      { originalCurrency: { code: "JPY", amountCents: "12" } },
      { category: "purchase" },
    ).originalScale,
    null,
  );
});
test("Unmatched refund is account credit but not assigned to original order; inconsistent and incomplete balances await review", (t) => {
  const db = setup(t),
    d = detail(db, id("FX07", "R1"));
  assert.equal(d.record.matching, "unmatched");
  assert.equal(d.net.confirmedWithinDemo, false);
  assert.equal(report(db, { scenario: "FX07" }).accounts[0].net, "-150");
  const r = report(db, { scenario: "FX07", basis: "order" });
  assert.equal(r.accounts.length, 0);
  assert.equal(r.unassigned, 1);
  assert.ok(
    list(db, { issues: "yes" }).rows.some((r) => r.scenario === "FX07"),
  );
  const b = balances(db).rows;
  assert.equal(
    b.find((r) => r.accountId.includes("FX08-ACCOUNT")).difference.minor,
    "10",
  );
  assert.equal(
    b.find((r) => r.accountId.includes("FX06-ACCOUNT")).state,
    "待确认",
  );
  assert.equal(b.filter((r) => r.accountId.includes("CHARGE")).length, 2);
});
test("Authorization hold releases on posting and pending never becomes posted expenditure", (t) => {
  const db = setup(t),
    r = report(db, { scenario: "FX09" }).accounts[0],
    b = balances(db, { account: "FX-R001-FX09-ACCOUNT" }).rows[0];
  assert.equal(r.net, "0");
  assert.equal(r.pending.purchase, "-10000");
  assert.equal(r.outflow, "0");
  assert.equal(b.posted.minor, "100000");
  assert.equal(b.available.minor, "90000");
  const canonical = balances(db, { account: "FX-R001-FX01-ACCOUNT" }).rows[0];
  assert.equal(canonical.available.minor, "94779");
  assert.equal(canonical.available.minor, canonical.posted.minor);
});
test("Duplicate and late notifications do not double count; old responses quarantine and trigger aggregate refresh", (t) => {
  const db = setup(t),
    i = id("FX01"),
    s = source(db),
    before = report(db, { scenario: "FX01" }).accounts[0].net;
  assert.equal(fxCounts(db).events, 2);
  assert.equal(fxCounts(db).deliveries, 3);
  const ev = {
    event: "aggregated_transaction.update",
    eventId: "repeat",
    entityId: i,
    eventTimestamp: "2026-08-31T10:00:00.000Z",
  };
  assert.equal(
    receiveEvent(db, NS, "DEMO-SLASH-CONNECTION", ev, "d1"),
    "refresh_required",
  );
  assert.equal(
    receiveEvent(db, NS, "DEMO-SLASH-CONNECTION", ev, "d2"),
    "duplicate_event",
  );
  const a = beginRead(db, NS, i),
    b = beginRead(db, NS, i);
  applyRead(db, NS, i, b, s);
  applyRead(db, NS, i, a, {
    ...s,
    status: "pending",
    detailedStatus: "pending",
    amountCents: "-10000",
  });
  assert.equal(detail(db, i).record.accountAmount.minor, "-10100");
  assert.equal(detail(db, i).record.syncState, "resync_required");
  assert.equal(report(db, { scenario: "FX01" }).accounts[0].net, before);
  assert.ok(report(db, { scenario: "FX01" }).accounts[0].issues > 0);
  const seq = beginRead(db, NS, i);
  applyRead(db, NS, i, seq, s);
  assert.equal(applyRead(db, NS, i, seq, s), "duplicate_response");
  assert.equal(report(db, { scenario: "FX01" }).accounts[0].issues, 0);
  const newSeq = beginRead(db, NS, i);
  applyRead(db, NS, i, newSeq, { ...s, amountCents: "-10200" });
  assert.equal(report(db, { scenario: "FX01" }).accounts[0].net, "5321");
  assert.throws(
    () =>
      receiveEvent(
        db,
        NS,
        "DEMO-SLASH-CONNECTION",
        { ...ev, event: "transaction.updated" },
        "d3",
      ),
    /Unsupported/,
  );
});
test("No source version means even a newer local request cannot silently roll posted back to pending", (t) => {
  const db = setup(t),
    i = id("FX01");
  assert.equal(
    applyRead(db, NS, i, beginRead(db, NS, i), {
      ...source(db),
      status: "pending",
    }),
    "superseded_request",
  );
  assert.equal(detail(db, i).record.status, "posted");
});
test("Amounts and decimal rates roundtrip beyond JS safe range, sorting and sum remain exact", (t) => {
  const db = setup(t);
  const parsed = parseSourceJSON(
    '{"amountCents":900719925474099312345,"originalCurrency":{"conversionRate":0.140277777777777778}}',
  );
  assert.equal(parsed.amountCents, "900719925474099312345");
  assert.equal(parsed.originalCurrency.conversionRate, "0.140277777777777778");
  assert.throws(() => integer(9007199254740992));
  assert.throws(() => rate("1e-6"));
  add(db, "EXACT-1", "-900719925474099312345");
  add(db, "EXACT-2", "-900719925474099312346");
  add(db, "EXACT-3", "1");
  const sorted = list(db, {
    scenario: "TEST",
    sort: "amount",
    direction: "asc",
  }).rows;
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["EXACT-2", "EXACT-1", "EXACT-3"],
  );
  assert.equal(
    report(db, { scenario: "TEST" }).accounts[0].net,
    "1801439850948198624690",
  );
});
test("Filtering, stable pagination, export and source whitelist are consistent; query input validated", (t) => {
  const db = setup(t);
  const q = { scenario: "FX01", sort: "amount", direction: "asc" };
  const all = list(db, q).rows,
    a = list(db, { ...q, pageSize: 1 }),
    b = list(db, { ...q, pageSize: 1, page: 1 });
  assert.equal(a.rows[0].id, all[0].id);
  assert.equal(b.rows[0].id, all[1].id);
  const csv = exportCSV(db, q);
  assert.equal(csv.count, 3);
  assert.ok(csv.csv.includes('"-10100"'));
  assert.equal(list(db, { q: "' OR 1=1 --" }).total, 0);
  assert.throws(() => list(db, { sort: "DROP TABLE" }));
  assert.throws(() => report(db, { from: "2026-02-30" }));
  const s = add(db, "SAFE", "-1", {
    cvv: "never-store",
    pan: "never-store",
    merchantData: { description: "Demo", secret: "never-store" },
    originalCurrency: {
      code: "CNY",
      amountCents: "-2",
      conversionRate: "0.5",
      secret: "never-store",
    },
  });
  assert.ok(s.cvv);
  assert.ok(!JSON.stringify(detail(db, "SAFE")).includes("never-store"));
  assert.throws(
    () =>
      addRelation(db, NS, id("FX02", "R1"), id("FX01"), "refund", "invalid"),
    /范围/,
  );
});
test("UTC normalization keeps raw date, offset timestamps filter by actual instant", (t) => {
  const db = setup(t);
  add(db, "OFFSET", "-1", { date: "2026-09-01T02:00:00+08:00" });
  assert.equal(
    list(db, { scenario: "TEST", from: "2026-08-31", to: "2026-08-31" }).total,
    1,
  );
  assert.equal(
    detail(db, "OFFSET").record.sourceDate,
    "2026-09-01T02:00:00+08:00",
  );
  assert.equal(
    detail(db, "OFFSET").record.postedAt,
    "2026-08-31T18:00:00.000Z",
  );
});
test("Unknown source enums stay raw and unresolved", (t) => {
  const db = setup(t);
  add(db, "UNKNOWN", "0", { status: "future", detailedStatus: "future" });
  const d = detail(db, "UNKNOWN");
  assert.match(d.record.statusLabel, /未知状态/);
  assert.equal(d.record.status, "future");
  assert.ok(
    list(db, { issues: "yes", scenario: "TEST" }).rows.some(
      (r) => r.id === "UNKNOWN",
    ),
  );
  assert.equal(d.record.postedAt, null);
});
test("Incremental import is repeatable, batched replicas do not overwrite legacy or prior observations, cleanup isolated", (t) => {
  const db = setup(t);
  importDemo(db, { persist: false });
  const old = counts(db, legacyNS),
    first = fxCounts(db);
  assert.deepEqual(importFX(db), first);
  const second = importFX(db, { replicas: 3, batchSize: 1 });
  assert.equal(second.records, 54);
  assert.equal(report(db, { scenario: "FX01" }).accounts.length, 3);
  assert.deepEqual(counts(db, legacyNS), old);
  cleanFX(db);
  assert.equal(fxCounts(db).records, 0);
  assert.deepEqual(counts(db, legacyNS), old);
  assert.throws(() => assertLocal({ NODE_ENV: "production" }));
  assert.throws(() =>
    assertLocal({ DATABASE_URL: "https://production.example.com" }),
  );
});
test("Management API gates all FX reads and exposes list/detail/timeline/relations/report/export with string amounts", async (t) => {
  const db = setup(t);
  importDemo(db, { persist: false });
  const server = createDemoServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const base = `http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo/management`;
    assert.equal((await fetch(base + "/fx/transactions")).status, 401);
    const auth = await fetch(base + "/session", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:8852",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "demo@adsflow.local",
        password: "demo-only",
      }),
    });
    assert.equal(auth.status, 200);
    const cookie = auth.headers.get("set-cookie").split(";")[0];
    for (const path of [
      "transactions?scenario=FX01",
      `transactions/${id("FX01")}`,
      `transactions/${id("FX01")}/timeline`,
      `transactions/${id("FX01")}/relations`,
      "report?scenario=FX01",
      "balances",
      "differences",
      "meta",
      "export?scenario=FX01",
    ]) {
      const r = await fetch(base + "/fx/" + path, { headers: { cookie } });
      assert.equal(r.status, 200, path);
      const body = await r.json();
      assert.equal(body.success, true);
      if (path.startsWith("transactions?"))
        assert.equal(typeof body.data.rows[0].source.amountCents, "string");
    }
    assert.equal(
      (
        await fetch(base + "/fx/transactions", {
          method: "POST",
          headers: { cookie, origin: "http://127.0.0.1:8852" },
          body: "{}",
        })
      ).status,
      405,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("Unified card list includes legacy and FX without copying, cross-currency filter and paginated export share one query", (t) => {
  const db = setup(t);
  importDemo(db, { persist: false });
  const q = { unified: "yes" },
    all = list(db, q),
    cross = list(db, { ...q, crossCurrency: "cross" }),
    same = list(db, { ...q, crossCurrency: "same" }),
    unknown = list(db, { ...q, crossCurrency: "unknown" });
  assert.equal(all.total, cross.total + same.total + unknown.total);
  assert.equal(list(db, { ...q, catalog: "fx" }).total, 18);
  assert.equal(
    list(db, { ...q, catalog: "legacy" }).total,
    db
      .prepare(
        "SELECT count(*) n FROM source_records WHERE namespace=? AND kind='transaction'",
      )
      .get(legacyNS).n,
  );
  assert.ok(
    cross.rows.some(
      (r) => r.sourceKind === "legacy" && r.originalCurrency === "EUR",
    ),
  );
  assert.ok(
    cross.rows.some(
      (r) => r.sourceKind === "fx" && r.originalCurrency === "CNY",
    ),
  );
  assert.equal(
    exportCSV(db, { ...q, crossCurrency: "cross" }).count,
    cross.total,
  );
  for (const r of all.rows) assert.equal(typeof r.source.amountCents, "string");
  const first = list(db, { ...q, pageSize: 5, page: 0 }),
    second = list(db, { ...q, pageSize: 5, page: 1 });
  assert.equal(
    new Set(
      [...first.rows, ...second.rows].map((r) => r.sourceKind + ":" + r.id),
    ).size,
    10,
  );
  const failed = list(db, { ...q, status: "failed", category: "refund" });
  assert.ok(
    failed.rows.some(
      (r) => r.sourceKind === "legacy" && r.detailedStatus === "failed",
    ),
  );
  assert.equal(fxCounts(db).records, 18);
});
test("Refund detail uses its evidenced original order, includes sibling refunds and has the same net as purchase detail", (t) => {
  const db = setup(t),
    a = detail(db, id("FX02")),
    b = detail(db, id("FX02", "R2"));
  assert.equal(b.net.scopeId, a.record.id);
  assert.equal(b.net.refund.minor, "4050");
  assert.equal(b.net.account.minor, a.net.account.minor);
  assert.equal(b.net.original.minor, a.net.original.minor);
  const orphan = detail(db, id("FX07", "R1"));
  assert.equal(orphan.net.scopeKind, "record");
  assert.equal(orphan.net.refund.minor, "150");
});
test("Observation currency precision is interpreted per historical observation, not by current transaction currency", (t) => {
  const db = setup(t),
    s = add(db, "HISTORY-UNIT", "-100", {
      originalCurrency: {
        code: "JPY",
        amountCents: "-720",
        conversionRate: "0.1",
      },
    });
  const v = {
    ...s,
    originalCurrency: {
      code: "CNY",
      amountCents: "-72000",
      conversionRate: "0.1",
    },
  };
  applyRead(db, NS, s.id, beginRead(db, NS, s.id), v);
  const d = detail(db, s.id);
  assert.equal(d.history.rows[0].originalAmount, null);
  assert.equal(d.history.rows[1].originalAmount.scale, 2);
});
test("Large generated report groups are paginated on the server and original currency totals retain full filter scope", (t) => {
  const db = setup(t);
  importFX(db, { replicas: 4, batchSize: 1 });
  const a = report(db),
    b = report(db, { page: 1 });
  assert.equal(a.accountTotal, 40);
  assert.equal(a.accounts.length, 25);
  assert.equal(b.accounts.length, 15);
  assert.deepEqual(a.originals, b.originals);
  assert.ok(a.daily.length <= 50);
  assert.equal(
    new Set(
      [...a.accounts, ...b.accounts].map(
        (r) => r.accountId + ":" + r.balanceType,
      ),
    ).size,
    40,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore, importDemo } from "../demo-server/slash/store.mjs";
import {
  seedPortal,
  portalState,
  portalAction,
} from "../demo-server/slash/portal.mjs";
import {
  seedCardAdmin,
  balance,
  previewCardOperation,
  requestCardOperation,
  reviewCardOperation,
  processCardJob,
  cardAdminRead,
  overlayCardAdmin,
} from "../demo-server/slash/card-admin.mjs";
import { createDemoServer } from "../demo-server/slash/server.mjs";
const ns = "card-admin-test",
  maker = "demo-operator",
  checker = "demo-reviewer";
function setup() {
  const db = openStore(":memory:");
  importDemo(db, { namespace: ns, persist: false });
  seedPortal(db, ns);
  seedCardAdmin(db, ns);
  return db;
}
function input(db, kind, card = "CARDOPS-001", extra = {}) {
  return {
    requestId: crypto.randomUUID(),
    kind,
    reason: "隔离验收：应收款收取",
    evidence: "DEMO-INVOICE-001",
    amountMinor: "1000",
    currency: "USD",
    counterpartyAccount: "CARDOPS-WALLET",
    cardRevision: cardAdminRead(db, ns, maker, `cards/${card}`).card.revision,
    confirmed: true,
    ...extra,
  };
}
function approve(db, o) {
  return reviewCardOperation(db, ns, checker, o.id, {
    decision: "approve",
    note: "核对金额、用途与业务凭证通过",
  });
}
function execute(db, kind, card = "CARDOPS-001") {
  const o = requestCardOperation(db, ns, maker, card, input(db, kind, card));
  if (kind !== "freeze") approve(db, o);
  return processCardJob(db, ns, o.id);
}
test("card ledger: exact debit has two entries, platform ownership, available preview and no legacy mutation", () => {
  const db = setup(),
    old = db
      .prepare("SELECT state_json FROM portal_state WHERE namespace=?")
      .get(ns).state_json;
  const q = previewCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-001",
    input(db, "debit"),
  );
  assert.equal(q.sourceAfterMinor, "49000");
  const o = execute(db, "debit");
  assert.equal(o.execution_status, "succeeded");
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "49000");
  assert.equal(balance(db, ns, "CARDOPS-RECEIVABLE").postedMinor, "1000");
  const rows = cardAdminRead(db, ns, maker, `operations/${o.id}`).entries;
  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((s, r) => s + BigInt(r.amount_minor), 0n),
    0n,
  );
  assert.equal(
    db.prepare("SELECT state_json FROM portal_state WHERE namespace=?").get(ns)
      .state_json,
    old,
  );
  db.close();
});
test("transfers preserve customer funds and do not act as external deposit/withdrawal", () => {
  const db = setup();
  execute(db, "transfer_in");
  assert.equal(balance(db, ns, "CARDOPS-WALLET").postedMinor, "99000");
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "51000");
  execute(db, "transfer_out");
  assert.equal(balance(db, ns, "CARDOPS-WALLET").postedMinor, "100000");
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "50000");
  db.close();
});
test("risk freeze syncs Portal, cannot be removed by client, second operator unfreezes", () => {
  const db = setup();
  execute(db, "freeze");
  let s = portalState(db, ns);
  const c = s.cards.find((c) => c.id === "CARDOPS-001");
  assert.equal(c.riskFrozen, true);
  assert.equal(c.management.providerStatus, "paused");
  assert.throws(
    () =>
      portalAction(db, ns, {
        requestId: "DEMO-CLIENT-BYPASS",
        revision: s.revision,
        action: { type: "freeze", id: c.id },
      }),
    /风控冻结/,
  );
  const o = requestCardOperation(db, ns, maker, c.id, input(db, "unfreeze"));
  assert.throws(
    () =>
      reviewCardOperation(db, ns, maker, o.id, {
        decision: "approve",
        note: "self",
      }),
    /权限|发起人/,
  );
  approve(db, o);
  assert.equal(
    portalState(db, ns).cards.find((x) => x.id === c.id)?.riskFrozen,
    true,
  );
  processCardJob(db, ns, o.id);
  assert.equal(
    portalState(db, ns).cards.find((c) => c.id === "CARDOPS-001").riskFrozen,
    false,
  );
  db.close();
});
test("self freeze persists independently through risk freeze/unfreeze, cannot route old budget money into managed card", () => {
  const db = setup();
  let s = portalState(db, ns);
  const r = portalAction(db, ns, {
    requestId: "DEMO-SELF-FREEZE",
    revision: s.revision,
    action: { type: "freeze", id: "CARDOPS-001" },
  });
  processCardJob(db, ns, r.id);
  execute(db, "freeze");
  execute(db, "unfreeze");
  s = portalState(db, ns);
  const c = s.cards.find((c) => c.id === "CARDOPS-001");
  assert.equal(c.frozen, true);
  assert.equal(c.riskFrozen, false);
  assert.throws(
    () =>
      portalAction(db, ns, {
        requestId: "DEMO-OLD-TOPUP",
        revision: s.revision,
        action: { type: "topup", id: c.id, amount: 1000 },
      }),
    /独立资金账本/,
  );
  db.close();
});
test("permissions and scoped ownership enforced server side", () => {
  const db = setup();
  assert.throws(
    () =>
      requestCardOperation(
        db,
        ns,
        "demo-viewer",
        "CARDOPS-001",
        input(db, "debit"),
      ),
    /权限/,
  );
  assert.throws(
    () =>
      previewCardOperation(
        db,
        ns,
        maker,
        "CARDOPS-001",
        input(db, "transfer_in", "CARDOPS-001", {
          counterpartyAccount: "CARDOPS-OTHER-WALLET",
        }),
      ),
    /同一客户/,
  );
  db.prepare(
    "UPDATE ca_principals SET owner_scope='other-owner' WHERE namespace=? AND actor=?",
  ).run(ns, maker);
  assert.throws(
    () => cardAdminRead(db, ns, maker, "cards/CARDOPS-001"),
    /权限/,
  );
  assert.equal(cardAdminRead(db, ns, maker, "cards").total, 0);
  db.close();
});
test("maker cannot self approve even if granted approval permissions", () => {
  const db = setup();
  const o = requestCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-001",
    input(db, "debit"),
  );
  db.prepare(
    "UPDATE ca_principals SET permissions_json=? WHERE namespace=? AND actor=?",
  ).run(
    JSON.stringify(["card.read", "card.approve", "card.execute"]),
    ns,
    maker,
  );
  assert.throws(() => approveAsMaker(), /发起人/);
  function approveAsMaker() {
    reviewCardOperation(db, ns, maker, o.id, {
      decision: "approve",
      note: "self",
    });
  }
  db.close();
});
test("insufficient balance, currency, closed status, evidence and confirmation rejected", () => {
  const db = setup();
  for (const [extra, re] of [
    [{ amountMinor: "50001" }, /余额不足/],
    [{ currency: "CNY" }, /USD/],
    [{ amountMinor: 10 }, /字符串/],
    [{ confirmed: false }, /二次确认/],
    [{ evidence: "" }, /凭证/],
    [{ actor: checker }, /未允许字段/],
  ])
    assert.throws(
      () =>
        requestCardOperation(
          db,
          ns,
          maker,
          "CARDOPS-001",
          input(db, "debit", "CARDOPS-001", extra),
        ),
      re,
    );
  db.prepare(
    "UPDATE ca_cards SET provider_status='closed' WHERE namespace=? AND id='CARDOPS-001'",
  ).run(ns);
  assert.throws(() => execute(db, "debit"), /状态/);
  db.close();
});
test("replayed request/review/provider response never double post, conflicting key rejected", () => {
  const db = setup(),
    b = input(db, "debit");
  const a = requestCardOperation(db, ns, maker, "CARDOPS-001", b);
  assert.equal(requestCardOperation(db, ns, maker, "CARDOPS-001", b).id, a.id);
  assert.throws(
    () =>
      requestCardOperation(db, ns, maker, "CARDOPS-001", {
        ...b,
        amountMinor: "2000",
      }),
    /幂等/,
  );
  approve(db, a);
  approve(db, a);
  processCardJob(db, ns, a.id);
  processCardJob(db, ns, a.id);
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "49000");
  db.close();
});
test("approval rejection and provider failure do not post; failed freeze retains restriction", () => {
  const db = setup(),
    o = requestCardOperation(db, ns, maker, "CARDOPS-001", input(db, "debit"));
  reviewCardOperation(db, ns, checker, o.id, {
    decision: "reject",
    note: "凭证不符",
  });
  processCardJob(db, ns, o.id);
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "50000");
  const fail = execute(db, "debit", "CARDOPS-002");
  assert.equal(fail.approval_status, "approved");
  assert.equal(fail.execution_status, "failed");
  assert.equal(balance(db, ns, "CARDOPS-002-FUNDS").heldMinor, "0");
  execute(db, "freeze", "CARDOPS-002");
  assert.equal(
    cardAdminRead(db, ns, maker, "cards/CARDOPS-002").card.risk_frozen,
    1,
  );
  db.close();
});
test("pending provider holds funds; another request cannot spend reserved money; restart processing is idempotent", () => {
  const db = setup();
  const o = requestCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-003",
    input(db, "debit", "CARDOPS-003", { amountMinor: "40000" }),
  );
  approve(db, o);
  processCardJob(db, ns, o.id);
  assert.equal(balance(db, ns, "CARDOPS-003-FUNDS").availableMinor, "10000");
  assert.equal(balance(db, ns, "CARDOPS-003-FUNDS").postedMinor, "50000");
  assert.throws(
    () =>
      requestCardOperation(
        db,
        ns,
        maker,
        "CARDOPS-003",
        input(db, "debit", "CARDOPS-003"),
      ),
    /处理中/,
  );
  processCardJob(db, ns, o.id);
  assert.equal(balance(db, ns, "CARDOPS-003-FUNDS").heldMinor, "40000");
  db.close();
});
test("balance rechecked at approval and stale card changes cannot execute approved request", () => {
  const db = setup();
  const a = requestCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-001",
    input(db, "debit", "CARDOPS-001", { amountMinor: "40000" }),
  );
  const b = requestCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-001",
    input(db, "debit", "CARDOPS-001", { amountMinor: "40000" }),
  );
  approve(db, a);
  processCardJob(db, ns, a.id);
  assert.equal(approve(db, b).execution_status, "failed");
  const u = requestCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-001",
    input(db, "transfer_in"),
  );
  execute(db, "freeze");
  assert.equal(approve(db, u).execution_status, "failed");
  db.close();
});
test("HTTP requires origin, authenticated operator, separate permissions; read cannot select an actor", async () => {
  const db = setup(),
    server = createDemoServer(db, ns);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo/management/`;
  try {
    assert.equal((await fetch(base + "card-admin/cards")).status, 401);
    const login = await fetch(base + "session", {
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
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const r = await fetch(base + "card-admin/cards/CARDOPS-001/operations", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://127.0.0.1:8852",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input(db, "debit")),
    });
    assert.equal(r.status, 403);
    assert.equal(
      (await fetch(base + "card-admin/cards", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "card-admin/cards/CARDOPS-001/operations", {
          method: "POST",
          headers: { Cookie: cookie },
          body: "{}",
        })
      ).status,
      403,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test("a new risk freeze stops a queued transfer before posting", () => {
  const db = setup();
  const o = requestCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-001",
    input(db, "transfer_out"),
  );
  approve(db, o);
  execute(db, "freeze");
  assert.equal(processCardJob(db, ns, o.id).execution_status, "failed");
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "50000");
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").heldMinor, "0");
  db.close();
});
test("ledger insert failure rolls back both legs and preserves the retryable execution hold", () => {
  const db = setup();
  const o = requestCardOperation(
    db,
    ns,
    maker,
    "CARDOPS-001",
    input(db, "debit"),
  );
  approve(db, o);
  db.exec(
    "CREATE TRIGGER test_fail_credit BEFORE INSERT ON ca_entries WHEN NEW.account_id='CARDOPS-RECEIVABLE' BEGIN SELECT RAISE(ABORT,'injected ledger failure'); END;",
  );
  assert.throws(() => processCardJob(db, ns, o.id), /injected/);
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "50000");
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").heldMinor, "1000");
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM ca_journals WHERE operation_id=?")
      .get(o.id).n,
    0,
  );
  db.exec("DROP TRIGGER test_fail_credit");
  processCardJob(db, ns, o.id);
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "49000");
  assert.throws(
    () =>
      db
        .prepare("UPDATE ca_entries SET amount_minor='1' WHERE namespace=?")
        .run(ns),
    /immutable/,
  );
  db.close();
});
test("cleanup is scoped, preserves old business records and can initialize again", async () => {
  const { cleanCardAdmin } = await import(
    "../demo-server/slash/card-admin-cli.mjs"
  );
  const db = setup();
  execute(db, "debit");
  const sources = db.prepare("SELECT count(*) n FROM source_records").get().n;
  cleanCardAdmin(db, ns);
  assert.equal(db.prepare("SELECT count(*) n FROM ca_operations").get().n, 0);
  assert.equal(
    db.prepare("SELECT count(*) n FROM source_records").get().n,
    sources,
  );
  assert.equal(portalState(db, ns).cards.length, 23);
  seedCardAdmin(db, ns);
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "50000");
  seedCardAdmin(db, ns);
  assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "50000");
  db.close();
});
test("persisted execution resumes after reopening without duplicate posting", async () => {
  const { join } = await import("node:path");
  const { rmSync } = await import("node:fs");
  const { DATA_DIR } = await import("../demo-server/slash/store.mjs");
  const path = join(DATA_DIR, `test-cardops-${crypto.randomUUID()}.sqlite`);
  let db = openStore(path);
  try {
    importDemo(db, { namespace: ns, persist: false });
    seedPortal(db, ns);
    seedCardAdmin(db, ns);
    const o = requestCardOperation(
      db,
      ns,
      maker,
      "CARDOPS-001",
      input(db, "debit"),
    );
    approve(db, o);
    db.close();
    db = openStore(path);
    assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").heldMinor, "1000");
    processCardJob(db, ns, o.id);
    db.close();
    db = openStore(path);
    processCardJob(db, ns, o.id);
    assert.equal(balance(db, ns, "CARDOPS-001-FUNDS").postedMinor, "49000");
  } finally {
    db.close();
    for (const file of [path, path + "-wal", path + "-shm"])
      rmSync(file, { force: true });
  }
});
test("Portal financial group and detail preserve card ledger amounts and separate approval/execution status", async () => {
  const { portalList, portalEntry } = await import(
    "../demo-server/slash/portal.mjs"
  );
  const db = setup();
  const debit = execute(db, "debit");
  const freeze = execute(db, "freeze");
  const list = portalList(db, ns, { cardId: "CARDOPS-001", group: "funds" });
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].id, debit.id);
  assert.equal(list.rows[0].amount, -1000);
  assert.match(list.rows[0].statusText, /审批通过.*执行成功/);
  assert.equal(portalEntry(db, ns, freeze.id).nonFinancial, true);
  assert.equal(
    portalList(db, ns, { cardId: "CARDOPS-001" }).groupCounts.funds,
    1,
  );
  assert.equal(
    portalState(db, ns).cards.find((c) => c.id === "CARDOPS-001").balance,
    49000,
  );
  db.close();
});
test('existing client risk card can be reviewed and unfrozen without inventing a funded balance',()=>{const db=setup();const c=cardAdminRead(db,ns,maker,'cards/1003').card;assert.equal(c.balance,null);assert.equal(c.actions.unfreeze.allowed,true);const o=requestCardOperation(db,ns,maker,'1003',input(db,'unfreeze','1003'));approve(db,o);processCardJob(db,ns,o.id);assert.equal(portalState(db,ns).cards.find(c=>c.id==='1003').riskFrozen,false);seedCardAdmin(db,ns);assert.equal(cardAdminRead(db,ns,maker,'cards/1003').card.risk_frozen,0);assert.throws(()=>requestCardOperation(db,ns,maker,'1003',input(db,'debit','1003')),/账本/);db.close();});
test('late client unfreeze cannot remove or overwrite a newer risk restriction',()=>{const db=setup();let s=portalState(db,ns);let self=portalAction(db,ns,{requestId:'DEMO-RACE-SELF-FREEZE',revision:s.revision,action:{type:'freeze',id:'CARDOPS-001'}});processCardJob(db,ns,self.id);s=portalState(db,ns);self=portalAction(db,ns,{requestId:'DEMO-RACE-SELF-UNFREEZE',revision:s.revision,action:{type:'freeze',id:'CARDOPS-001'}});const risk=requestCardOperation(db,ns,maker,'CARDOPS-001',input(db,'freeze','CARDOPS-001',{reason:'新风控限制优先'}));processCardJob(db,ns,self.id);processCardJob(db,ns,risk.id);const c=cardAdminRead(db,ns,maker,'cards/CARDOPS-001').card;assert.equal(c.risk_frozen,1);assert.equal(c.provider_status,'paused');assert.equal(c.reason,'新风控限制优先');assert.equal(c.actor,maker);db.close();});
test('execution scheduling failure keeps approval but rolls back its hold and job',()=>{const db=setup();const o=requestCardOperation(db,ns,maker,'CARDOPS-001',input(db,'debit'));db.exec("CREATE TRIGGER test_fail_job BEFORE INSERT ON ca_jobs BEGIN SELECT RAISE(ABORT,'injected scheduling failure'); END;");const result=approve(db,o);assert.equal(result.approval_status,'approved');assert.equal(result.execution_status,'failed');assert.equal(balance(db,ns,'CARDOPS-001-FUNDS').heldMinor,'0');assert.equal(balance(db,ns,'CARDOPS-001-FUNDS').postedMinor,'50000');assert.equal(db.prepare('SELECT count(*) n FROM ca_jobs').get().n,0);db.close();});

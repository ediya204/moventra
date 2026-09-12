import { readFileSync } from "node:fs";
import { openStore, assertLocal } from "./store.mjs";
import {
  FINANCE_NS,
  seedFinance,
  financeWrite,
  financeRead,
} from "./crypto-finance.mjs";
export function cleanFinance(db) {
  assertLocal();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "DROP TRIGGER IF EXISTS ca_entries_immutable_delete; DROP TRIGGER IF EXISTS fn_movement_no_delete;",
    );
    for (const table of [
      "fn_fixed_quotes",
      "fn_fixed_prices",
      "fn_policies",
      "fn_requests",
      "fn_audit",
      "fn_movements",
      "fn_events",
      "fn_jobs",
      "fn_reviews",
      "fn_holds",
      "fn_quotes",
    ])
      db.prepare(`DELETE FROM ${table} WHERE namespace=?`).run(FINANCE_NS);
    db.prepare("UPDATE fn_orders SET parent_id=NULL WHERE namespace=?").run(
      FINANCE_NS,
    );
    for (const table of [
      "fn_orders",
      "fn_wallets",
      "ca_entries",
      "ca_journals",
      "ca_accounts",
      "ca_principals",
      "demo_batches",
    ])
      db.prepare(`DELETE FROM ${table} WHERE namespace=?`).run(FINANCE_NS);
    for (const file of [
      "009_card_administration.sql",
      "010_crypto_finance.sql",
    ])
      db.exec(
        readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"),
      );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function seedFinanceScenarios(db) {
  seedFinance(db);
  const write = (actor, path, body, id) =>
    financeWrite(db, actor, path, { ...body, requestId: `fixture-${id}` });
  // A completed OTC quote is created and confirmed once, never repriced on re-import.
  if (
    !db
      .prepare("SELECT 1 FROM fn_orders WHERE namespace=? AND kind='otc'")
      .get(FINANCE_NS)
  ) {
    const q = write(
      "demo-operator",
      "quotes",
      { customer: "DEMO-C001", sellAsset: "USD", amountMinor: "100000" },
      "otc-quote",
    );
    const o = write(
      "demo-operator",
      "orders",
      {
        kind: "otc",
        quoteId: q.id,
        reason: "FIN-OTC-SCENARIO：内部 USD 1000 兑换；获得 USDT 995.995000",
      },
      "otc-create",
    );
    write(
      "demo-operator",
      `orders/${o.id}/confirm`,
      { revision: 1 },
      "otc-confirm",
    );
  }
  for (const [id, mode] of [
    ["FIN-WITHDRAW-001", "completed"],
    ["FIN-WITHDRAW-TIMEOUT", "unknown"],
    ["FIN-WITHDRAW-PARTIAL", "partial"],
    ["FIN-WITHDRAW-FAILED", "failed"],
  ]) {
    const p = `orders/${id}/`;
    write("demo-reviewer", p + "risk-check", { revision: 1 }, `${id}-risk`);
    write(
      "demo-reviewer",
      p + "review",
      {
        revision: 1,
        node: "reviewer",
        decision: "approve",
        note: "隔离夹具复核，不代表实际资金授权",
      },
      `${id}-review`,
    );
    write("demo-reviewer", p + "execute", { revision: 1 }, `${id}-execute`);
    write("demo-reviewer", p + "reconcile", { revision: 1 }, `${id}-query`);
  }
  for (const decision of ["approve", "reject"]) {
    const o = write(
      "demo-operator",
      "orders",
      {
        kind: "withdrawal",
        customer: "DEMO-C001",
        asset: "USDT",
        network: "TRON",
        amountMinor: "25000000",
        address: `DEMO:TRON:FIXTURE_${decision.toUpperCase()}`,
        reason: `隔离视图样本：${decision}`,
      },
      `view-${decision}-create`,
    );
    if (decision === "approve")
      write(
        "demo-reviewer",
        `orders/${o.id}/risk-check`,
        { revision: 1 },
        `view-${decision}-risk`,
      );
    write(
      "demo-reviewer",
      `orders/${o.id}/review`,
      { revision: 1, node: "reviewer", decision, note: "隔离状态视图验收" },
      `view-${decision}-review`,
    );
  }
  return financeRead(db, "demo-operator", "orders", { pageSize: "100" });
}
if (process.argv[1]?.endsWith("crypto-finance-cli.mjs")) {
  const db = openStore();
  try {
    const cmd = process.argv[2];
    if (cmd === "init") seedFinanceScenarios(db);
    else if (cmd === "clean") cleanFinance(db);
    else if (cmd !== "status") throw new Error("Use init | clean | status");
    console.log(
      JSON.stringify(
        {
          namespace: FINANCE_NS,
          counts: Object.fromEntries(
            [
              "fn_orders",
              "fn_movements",
              "fn_reviews",
              "fn_jobs",
              "fn_events",
              "fn_holds",
              "ca_entries",
            ].map((t) => [
              t,
              db
                .prepare(`SELECT count(*) n FROM ${t} WHERE namespace=?`)
                .get(FINANCE_NS).n,
            ]),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

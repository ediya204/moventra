import { NS, AS_OF } from "./model.mjs";
import {
  register,
  beginRead,
  applyRead,
  receiveEvent,
  addRelation,
  rebuildDaily,
} from "./store.mjs";
import { assertLocal } from "../store.mjs";
export const scenarios = [
  ["FX01", "CNY 部分退款与独立费用"],
  ["FX02", "AED 多次部分退款"],
  ["FX03", "原币全额退款 / 美元残差"],
  ["FX04", "费用已包含"],
  ["FX05", "返现待入账、入账及冲回"],
  ["FX06", "缺少汇率与费用"],
  ["FX07", "未匹配退款"],
  ["FX08", "旧响应隔离与缺失通知"],
  ["FX09", "待入账授权"],
  ["FX10", "其他平台与零值"],
];
export function importFX(db, { replicas = 1, batchSize = 10 } = {}) {
  assertLocal();
  if (
    !Number.isInteger(replicas) ||
    replicas < 1 ||
    replicas > 1000 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100
  )
    throw new Error("replicas 1..1000; batchSize 1..100");
  db.prepare("INSERT OR IGNORE INTO demo_batches VALUES(?,?,?)").run(
    NS,
    20260906,
    AS_OF,
  );
  for (let start = 1; start <= replicas; start += batchSize) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (
        let rep = start;
        rep < Math.min(start + batchSize, replicas + 1);
        rep++
      ) {
        const prefix = `FX-R${String(rep).padStart(3, "0")}`;
        // An existing replica is immutable: repeated import never rewrites observed state.
        if (
          db
            .prepare("SELECT 1 FROM fx_records WHERE namespace=? AND id=?")
            .get(NS, `${prefix}-FX01-T1`)
        )
          continue;
        for (const [scenario] of scenarios) {
          const base = `${prefix}-${scenario}`,
            accountId = `${base}-ACCOUNT`,
            cardId = `${base}-CARD`,
            connectionId = "DEMO-SLASH-CONNECTION",
            entityId = "DEMO-FX-ENTITY";
          const i = {
            connectionId,
            entityId,
            scenario,
            category: "purchase",
            balanceType: "debit",
            feeTreatment: "unknown",
            matching: "demo_verified",
            assumption: "内部 Demo 假设；金额、关联及费用入账方式待 Slash 确认",
          };
          const baseSource = {
            accountId,
            cardId,
            virtualAccountId: `${base}-VA`,
            accountSubtype: "cash",
            description: `Demo ${scenario} 商户`,
            status: "posted",
            detailedStatus: "settled",
            date: "2026-08-31T10:00:00.000Z",
            authorizedAt: "2026-08-30T10:00:00.000Z",
            orderId: `DEMO-ORDER-${rep}`,
            referenceNumber: `${base}-REF`,
            providerAuthorizationId: `${base}-AUTH`,
            merchantData: {
              description: "Demo Synthetic Merchant",
              categoryCode: "7311",
              location: {
                city: "Demo City",
                state: "Demo State",
                country: "US",
                zip: "00000",
              },
            },
          };
          const tx = (suffix, amount, orig, more = {}, inside = {}) => {
            const id = `${base}-${suffix}`,
              s = {
                ...baseSource,
                id,
                amountCents: String(amount),
                ...(orig
                  ? {
                      originalCurrency: {
                        code: orig[0],
                        amountCents: String(orig[1]),
                        ...(orig[2] != null ? { conversionRate: orig[2] } : {}),
                      },
                    }
                  : {}),
                ...more,
              };
            register(db, NS, id, s, { ...i, ...inside });
            applyRead(db, NS, id, beginRead(db, NS, id), s);
            return s;
          };
          const rel = (child, parent, kind) =>
            addRelation(
              db,
              NS,
              child.id,
              parent.id,
              kind,
              `Demo fixture ${scenario}: 显式配对；非 Slash 自动关联规则`,
            );
          const refund = (suffix, amount, orig, date) =>
            tx(
              suffix,
              amount,
              orig,
              {
                status: "posted",
                detailedStatus: "refund",
                date,
                authorizedAt: undefined,
              },
              { category: "refund" },
            );
          let p;
          if (scenario === "FX01") {
            p = tx(
              "T1",
              -10000,
              ["CNY", -72000, "0.138888888888888889"],
              {
                status: "pending",
                detailedStatus: "pending",
                date: "2026-08-30T10:00:00.000Z",
              },
              { feeTreatment: "separate" },
            );
            const a = beginRead(db, NS, p.id),
              b = beginRead(db, NS, p.id),
              posted = {
                ...p,
                amountCents: "-10100",
                status: "posted",
                detailedStatus: "settled",
                date: "2026-08-31T10:00:00.000Z",
                originalCurrency: {
                  ...p.originalCurrency,
                  conversionRate: "0.140277777777777778",
                },
                fxFeeInfo: { amountCents: "101" },
              };
            const event = {
              event: "aggregated_transaction.update",
              eventId: `${base}-EV2`,
              entityId: p.id,
              eventTimestamp: "2026-08-31T10:00:00.000Z",
            };
            receiveEvent(db, NS, connectionId, event, `${base}-DEL1`);
            receiveEvent(db, NS, connectionId, event, `${base}-DEL2`);
            applyRead(db, NS, p.id, b, posted);
            applyRead(db, NS, p.id, a, p);
            receiveEvent(
              db,
              NS,
              connectionId,
              {
                ...event,
                eventId: `${base}-EV1`,
                eventTimestamp: "2026-08-30T10:00:00.000Z",
              },
              `${base}-DEL3`,
            );
            applyRead(db, NS, p.id, beginRead(db, NS, p.id), posted);
            p = posted;
            const fee = tx(
              "F1",
              -101,
              null,
              {
                authorizedAt: undefined,
                feeInfo: { relatedTransaction: { id: p.id, amount: "101" } },
              },
              { category: "fee", feeTreatment: "separate" },
            );
            rel(fee, p, "fee");
            db.prepare("INSERT INTO fx_assets VALUES(?,?,?,?)").run(
              NS,
              fee.id,
              "fee-detail",
              JSON.stringify({
                id: fee.id,
                dateCharged: fee.date,
                feeAmountCents: "101",
                feeType: "demo_fx_fee",
                accountId,
                originalTransaction: p,
              }),
            );
            rel(
              refund(
                "R1",
                4980,
                ["CNY", 36000, "0.138333333333333333"],
                "2026-09-03T10:00:00.000Z",
              ),
              p,
              "refund",
            );
          } else if (scenario === "FX02") {
            p = tx(
              "T1",
              -10000,
              ["AED", -36725, "0.272294077603812117"],
              {},
              { feeTreatment: "included" },
            );
            rel(
              refund(
                "R1",
                2700,
                ["AED", 10000, "0.27"],
                "2026-08-31T18:00:00.000Z",
              ),
              p,
              "refund",
            );
            rel(
              refund(
                "R2",
                1350,
                ["AED", 5000, "0.27"],
                "2026-09-02T10:00:00.000Z",
              ),
              p,
              "refund",
            );
          } else if (scenario === "FX03") {
            p = tx(
              "T1",
              -10100,
              ["CNY", -72000, "0.140277777777777778"],
              {},
              { feeTreatment: "included" },
            );
            rel(
              refund(
                "R1",
                10000,
                ["CNY", 72000, "0.138888888888888889"],
                "2026-09-01T10:00:00.000Z",
              ),
              p,
              "refund",
            );
          } else if (scenario === "FX04")
            p = tx(
              "T1",
              -10100,
              ["CNY", -72000, "0.14"],
              { fxFeeInfo: { amountCents: "101" } },
              { feeTreatment: "included" },
            );
          else if (scenario === "FX05") {
            p = tx(
              "T1",
              -2000,
              ["USD", -2000, "1"],
              { cashbackInfo: { amountCents: "50", rate: "0.025" } },
              { feeTreatment: "included" },
            );
            rel(
              tx(
                "C1",
                20,
                null,
                {
                  status: "pending",
                  detailedStatus: "pending",
                  authorizedAt: undefined,
                },
                { category: "cashback" },
              ),
              p,
              "cashback",
            );
            rel(
              tx(
                "C2",
                50,
                null,
                { authorizedAt: undefined },
                { category: "cashback" },
              ),
              p,
              "cashback",
            );
            rel(
              tx(
                "CA1",
                -50,
                null,
                { authorizedAt: undefined, date: "2026-09-02T10:00:00.000Z" },
                { category: "cashback_adjustment" },
              ),
              p,
              "cashback_adjustment",
            );
          } else if (scenario === "FX06")
            p = tx(
              "T1",
              -1500,
              ["CNY", -10000, null],
              { authorizedAt: undefined },
              {
                fault:
                  "故障注入：originalCurrency 不完整，不是合法完整 Slash 示例",
              },
            );
          else if (scenario === "FX07")
            p = tx(
              "R1",
              150,
              ["CNY", 1000, "0.15"],
              {
                detailedStatus: "refund",
                authorizedAt: undefined,
                date: "2026-09-02T10:00:00.000Z",
              },
              { category: "refund", matching: "unmatched" },
            );
          else if (scenario === "FX08") {
            p = tx(
              "T1",
              -10100,
              ["AED", -36725, "0.275017018379850238"],
              {},
              { feeTreatment: "included" },
            );
            const old = beginRead(db, NS, p.id);
            beginRead(db, NS, p.id);
            applyRead(db, NS, p.id, old, {
              ...p,
              status: "pending",
              detailedStatus: "pending",
              amountCents: "-10000",
            });
          } else if (scenario === "FX09")
            p = tx(
              "T1",
              -10000,
              ["CNY", -72000, "0.138888888888888889"],
              {
                status: "pending",
                detailedStatus: "pending",
                date: "2026-09-04T10:00:00.000Z",
              },
              { feeTreatment: "unknown" },
            );
          else
            p = tx(
              "T1",
              0,
              ["JPY", 0, "1"],
              { authorizedAt: undefined },
              {
                platform: "demo-secondary",
                connectionId: "DEMO-SECONDARY-CONNECTION",
                accountCurrency: "JPY",
                accountScale: 0,
                originalScale: 0,
                feeTreatment: "included",
              },
            );
          for (const [kind, id, obj] of [
            [
              "account",
              accountId,
              { id: accountId, type: "debit", name: `Demo ${scenario}` },
            ],
            [
              "card",
              cardId,
              {
                id: cardId,
                accountId,
                last4: String(
                  4000 + rep * 10 + Number(scenario.slice(2)),
                ).slice(-4),
                status: "active",
              },
            ],
            ["virtual-account", `${base}-VA`, { id: `${base}-VA`, accountId }],
          ])
            db.prepare("INSERT INTO fx_assets VALUES(?,?,?,?)").run(
              NS,
              id,
              kind,
              JSON.stringify(obj),
            );
          const rows = db
              .prepare(
                "SELECT amount_minor,status FROM fx_records WHERE namespace=? AND account_id=?",
              )
              .all(NS, accountId),
            posted =
              100000n +
              rows
                .filter((r) => r.status === "posted")
                .reduce((n, r) => n + BigInt(r.amount_minor), 0n),
            held = rows
              .filter(
                (r) => r.status === "pending" && BigInt(r.amount_minor) < 0n,
              )
              .reduce((n, r) => n - BigInt(r.amount_minor), 0n);
          db.prepare(
            "INSERT INTO fx_balances VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            NS,
            `${base}-BAL`,
            scenario === "FX10" ? "DEMO-SECONDARY-CONNECTION" : connectionId,
            accountId,
            "debit",
            scenario === "FX10" ? "JPY" : "USD",
            scenario === "FX10" ? 0 : 2,
            String(posted - held),
            String(posted + (scenario === "FX08" ? 10n : 0n)),
            AS_OF,
            AS_OF,
            "100000",
            "2026-08-01T00:00:00.000Z",
            scenario === "FX06" ? 0 : 1,
          );
          // Credit and cash remain separate snapshot scopes, never added to a debit balance.
          if (scenario === "FX05")
            db.prepare("INSERT INTO fx_assets VALUES(?,?,?,?)").run(
              NS,
              `${base}-CHARGE-ACCOUNT`,
              "account",
              JSON.stringify({
                id: `${base}-CHARGE-ACCOUNT`,
                type: "charge_card",
                name: "Demo cash / credit scopes",
              }),
            );
          if (scenario === "FX05")
            for (const type of ["cash", "credit"])
              db.prepare(
                "INSERT INTO fx_balances VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              ).run(
                NS,
                `${base}-${type}-BAL`,
                connectionId,
                `${base}-CHARGE-ACCOUNT`,
                type,
                "USD",
                2,
                type === "credit" ? "200000" : "50000",
                type === "credit" ? "25000" : "50000",
                AS_OF,
                AS_OF,
                null,
                null,
                0,
              );
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  rebuildDaily(db, NS);
  return fxCounts(db);
}
export function fxCounts(db) {
  return {
    namespace: NS,
    seed: 20260906,
    ...Object.fromEntries(
      [
        "records",
        "observations",
        "relations",
        "events",
        "deliveries",
        "balances",
        "daily",
      ].map((t) => [
        t,
        db.prepare(`SELECT count(*) n FROM fx_${t} WHERE namespace=?`).get(NS)
          .n,
      ]),
    ),
  };
}
export function cleanFX(db) {
  assertLocal();
  db.prepare("DELETE FROM demo_batches WHERE namespace=?").run(NS);
}

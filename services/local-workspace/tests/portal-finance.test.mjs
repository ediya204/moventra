import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  transition,
  units,
  FINANCE_POLICY,
} from "../../../apps/client/src/portal/model.ts";
let seq = 0;
const act = (s, a) => transition(s, a, `order-${++seq}`, "2026-09-06 12:00:00");
const event = (s, id, event, eventId = `event-${++seq}`) =>
  act(s, { type: "finance/simulate", orderId: id, event, eventId });
const addAddress = (s) =>
  act(s, {
    type: "finance/address",
    label: "Treasury",
    address: "DEMO:TRON:treasury",
  });
const withdraw = (s) =>
  act(s, {
    type: "finance/withdraw",
    addressId: s.finance.addresses[0].id,
    amount: 100_000000,
    verified: true,
  });
const latest = (s) => s.finance.orders[0];
const usdTotal = (s) =>
  s.balance +
  s.finance.heldUsd +
  s.cards.reduce((n, c) => n + c.balance, 0) +
  Object.values(s.finance.subBalances).reduce((n, v) => n + v, 0) +
  s.finance.orders
    .filter(
      (o) => o.kind === "卡片转回" && ["处理中", "待核实"].includes(o.status),
    )
    .reduce((n, o) => n + o.amount, 0);
test("USDT parsing is exact to six places and rejects excess precision", () => {
  assert.equal(units("12.000001", "USDT"), 12000001);
  assert.equal(units("0.01", "USD"), 1);
  for (const v of ["1e3", "-1", "0", "0.0000001", "Infinity", "1000001"])
    assert.throws(() => units(v, "USDT"));
  assert.throws(() => units("0.001", "USD"));
});
test("deposit requires detection before settlement; repeats cannot credit twice", () => {
  const s = initialState();
  let n = act(s, { type: "finance/deposit", amount: 100_000000 });
  const id = latest(n).id;
  assert.equal(n.finance.usdt, s.finance.usdt);
  assert.throws(() => event(n, id, "complete"));
  n = event(n, id, "detect");
  n = event(n, id, "review");
  n = event(n, id, "complete", "settlement-1");
  assert.equal(n.finance.usdt, s.finance.usdt + 100_000000);
  assert.equal(n.balance, s.balance);
  assert.deepEqual(event(n, id, "complete", "settlement-1"), n);
  assert.throws(() => event(n, id, "complete"));
  assert.equal(latest(n).status, "已完成");
  assert.equal(n.entries[0].currency, "USDT");
});
test("invalid and below-minimum deposits leave state unchanged", () => {
  const s = initialState();
  for (const amount of [0, -1, NaN, 1.5, 9_000000])
    assert.throws(() => act(s, { type: "finance/deposit", amount }));
  assert.equal(s.finance.orders.length, 0);
});
test("quote expires at exact boundary, is consumed only once and immutable", () => {
  let s = act(initialState(), {
    type: "finance/quote",
    from: "USDT",
    amount: 100_000000,
    now: 1000,
  });
  const q = s.finance.quotes[0];
  assert.equal(q.fee, 500000);
  assert.equal(q.receive, 9920);
  assert.throws(() =>
    act(s, { type: "finance/exchange", quoteId: q.id, now: q.expires }),
  );
  s = act(s, { type: "finance/exchange", quoteId: q.id, now: 1001 });
  assert.equal(s.finance.heldUsdt, 100_000000);
  assert.equal(s.balance, 2845000);
  assert.throws(() =>
    act(s, { type: "finance/exchange", quoteId: q.id, now: 1002 }),
  );
  const n = event(s, latest(s).id, "complete");
  assert.equal(n.balance, 2845000 + 9920);
  assert.equal(n.finance.heldUsdt, 0);
  assert.equal(q.used, false);
});
test("reverse quote uses USD cents and returns USDT micro units", () => {
  let s = act(initialState(), {
    type: "finance/quote",
    from: "USD",
    amount: 10000,
    now: 0,
  });
  const q = s.finance.quotes[0];
  assert.equal(q.fee, 50);
  assert.equal(q.receive, 99599500);
  s = act(s, { type: "finance/exchange", quoteId: q.id, now: 1 });
  assert.equal(s.finance.heldUsd, 10000);
  s = event(s, latest(s).id, "complete");
  assert.equal(s.finance.usdt, 5000_000000 + 99599500);
  assert.equal(s.finance.heldUsd, 0);
});
test("unknown exchange retains reserve, confirmed failure restores original currency", () => {
  const original = initialState();
  let s = act(original, {
    type: "finance/quote",
    from: "USDT",
    amount: 100_000000,
    now: 0,
  });
  s = act(s, {
    type: "finance/exchange",
    quoteId: s.finance.quotes[0].id,
    now: 1,
  });
  const id = latest(s).id;
  s = event(s, id, "unknown");
  assert.equal(s.finance.heldUsdt, 100_000000);
  s = event(s, id, "fail");
  assert.equal(s.finance.usdt, original.finance.usdt);
  assert.equal(s.balance, original.balance);
  assert.equal(s.finance.heldUsdt, 0);
});
test("quote acceptance rechecks available balance", () => {
  let s = act(initialState(), {
    type: "finance/quote",
    from: "USDT",
    amount: 6000_000000,
    now: 0,
  });
  assert.throws(() =>
    act(s, {
      type: "finance/exchange",
      quoteId: s.finance.quotes[0].id,
      now: 1,
    }),
  );
  assert.equal(s.finance.quotes[0].used, false);
});
test("address rejects real-looking input and duplicate; disabled address cannot withdraw", () => {
  let s = initialState();
  assert.throws(() =>
    act(s, {
      type: "finance/address",
      label: "Real",
      address: "TRealWalletAddress",
    }),
  );
  s = addAddress(s);
  assert.throws(() => addAddress(s));
  s = act(s, {
    type: "finance/address-toggle",
    addressId: s.finance.addresses[0].id,
  });
  assert.throws(() => withdraw(s));
});
test("withdrawal reserves amount plus fee and can cancel only once before approval", () => {
  const original = addAddress(initialState());
  let s = withdraw(original);
  const id = latest(s).id;
  assert.equal(s.finance.heldUsdt, 102_000000);
  assert.equal(s.finance.usdt, original.finance.usdt - 102_000000);
  s = act(s, { type: "finance/cancel", orderId: id });
  assert.equal(s.finance.usdt, original.finance.usdt);
  assert.equal(s.finance.heldUsdt, 0);
  assert.throws(() => act(s, { type: "finance/cancel", orderId: id }));
  assert.throws(() => event(s, id, "approve"));
});
test("withdrawal approval and unknown do not settle; final success deducts once", () => {
  let s = withdraw(addAddress(initialState()));
  const id = latest(s).id;
  s = event(s, id, "approve");
  assert.equal(s.finance.heldUsdt, 102_000000);
  assert.throws(() => act(s, { type: "finance/cancel", orderId: id }));
  s = event(s, id, "unknown");
  assert.equal(s.finance.heldUsdt, 102_000000);
  s = event(s, id, "complete");
  assert.equal(s.finance.heldUsdt, 0);
  assert.equal(s.finance.usdt, 4898_000000);
  assert.match(latest(s).tx, /^DEMO-TX/);
  assert.throws(() => event(s, id, "complete"));
  assert.throws(() => event(s, id, "fail"));
});
test("rejection and confirmed failure release reserved withdrawal funds", () => {
  for (const final of ["reject", "fail"]) {
    let s = withdraw(addAddress(initialState()));
    const id = latest(s).id;
    if (final === "fail") s = event(s, id, "approve");
    s = event(s, id, final);
    assert.equal(s.finance.usdt, 5000_000000);
    assert.equal(s.finance.heldUsdt, 0);
  }
});
test("withdrawal validates confirmation, limits and fee-inclusive balance", () => {
  const s = addAddress(initialState());
  for (const [amount, verified] of [
    [100_000000, false],
    [9_000000, true],
    [5000_000000, true],
    [100001_000000, true],
  ])
    assert.throws(() =>
      act(s, {
        type: "finance/withdraw",
        addressId: s.finance.addresses[0].id,
        amount,
        verified,
      }),
    );
  assert.equal(s.finance.heldUsdt, 0);
});
test("card return keeps funds in transit until final result", () => {
  const original = initialState();
  for (const final of ["complete", "fail"]) {
    let s = act(original, {
      type: "finance/card-return",
      cardId: "1001",
      amount: 10000,
    });
    const id = latest(s).id;
    assert.equal(s.balance, original.balance);
    assert.equal(usdTotal(s), usdTotal(original));
    s = event(s, id, "unknown");
    assert.equal(usdTotal(s), usdTotal(original));
    s = event(s, id, final);
    assert.equal(usdTotal(s), usdTotal(original));
    assert.equal(
      s.balance,
      original.balance + (final === "complete" ? 10000 : 0),
    );
    assert.throws(() => event(s, id, final));
  }
  assert.throws(() =>
    act(original, { type: "finance/card-return", cardId: "1003", amount: 100 }),
  );
});
test("V1 retired team funding cannot spend or move legacy balances", () => {
 const s=initialState();s.finance.subBalances={"archived":20000};s.cards[0].team="archived";
 const before=structuredClone(s);
 for(const a of [{type:"finance/transfer",team:"archived",direction:"to-main",amount:10000},{type:"finance/transfer",team:"archived",direction:"to-team",amount:10000},{type:"topup",id:"1001",source:"team",amount:10000}])assert.throws(()=>act(s,a),/V1/);
 assert.deepEqual(s,before);
 const next=act(s,{type:"topup",id:"1001",amount:10000});
 assert.equal(next.balance,s.balance-10000);assert.deepEqual(next.finance.subBalances,s.finance.subBalances);
 assert.equal(usdTotal(next),usdTotal(s));
});
test('quote response supplies the same rate and fee policy used by exact calculation',()=>{
 for(const [from,amount,rate,receive]of [['USDT',100_000000,'0.997',9920],['USD',10000,'1.001',99599500]]){
  const state=act(initialState(),{type:'finance/quote',from,amount,now:Date.now()});
  const q=state.finance.quotes[0];assert.equal(q.rate,rate);assert.equal(q.feeBps,50);assert.equal(q.rateSource,'portal-legacy-demo-v1');assert.equal(q.receive,receive);
 }
});

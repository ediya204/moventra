import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { issuingRoute } from "../../deploy/cloudflare/issuing.mjs";
import { handle } from "../../deploy/cloudflare/gateway.mjs";
const compiled = ts.transpileModule(
  readFileSync(
    new URL("../../packages/shared/src/issuing/contract.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { money, toMinor, issuingPath } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const id = "10000000-0000-4000-8000-000000000001";
test("issuing money preserves precision and rejects malformed input", () => {
  assert.equal(money("9007199254740993"), "90071992547409.93");
  assert.equal(toMinor("90071992547409.93"), "9007199254740993");
  assert.equal(toMinor("0"), "0");
  assert.equal(money(null), "未知");
  for (const v of ["-1", "1e3", "1.001", "NaN", "01", ""])
    assert.throws(() => toMinor(v));
});
test("gateway and transport agree on exact mutation boundaries", async () => {
  for (const path of [
    "/admin-api/v1/card-issuing/products",
    "/admin-api/v1/card-issuing/products/" + id,
    "/admin-api/v1/card-issuing/prices",
    `/client-api/v1/customers/${id}/card-issuing/orders`,
    `/admin-api/v1/customers/${id}/card-issuing/deposit-reviews/${id}`,
  ]) {
    assert.equal(issuingRoute("POST", path), true);
    assert.equal(issuingPath("POST", path), true);
    let calls = 0;
    const r = await handle(
      new Request("https://web.invalid" + path, {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture",
          "Content-Type": "application/json",
          "Idempotency-Key": id,
        },
        body: '{"test":true}',
      }),
      {
        SITE_KIND: path.startsWith("/admin") ? "admin" : "client",
        API_ORIGIN: "https://api.invalid",
      },
      async (u, o) => {
        calls++;
        assert.equal(o.method, "POST");
        assert.equal(o.headers.get("Idempotency-Key"), id);
        assert.equal(await new Response(o.body).text(), '{"test":true}');
        return Response.json({ data: { saved: true } });
      },
    );
    assert.equal(r.status, 200);
    assert.equal(calls, 1);
  }
  for (const path of [
    `/client-api/v1/customers/${id}/card-issuing/deposits`,
    `/admin-api/v1/customers/${id}/card-issuing/orders`,
    "/admin-api/v1/card-issuing/grants",
    `/admin-api/v1/card-issuing/products/${id}/execute`,
  ]) {
    assert.equal(issuingRoute("POST", path), false);
    assert.equal(issuingPath("POST", path), false);
  }
  assert.equal(
    issuingPath("POST", "/admin-api/v1/card-issuing/products?destination=x"),
    false,
  );
  assert.equal(
    issuingPath("GET", "/admin-api/v1/card-issuing/products?q=a&q=b"),
    false,
  );
  const cross = await handle(
    new Request("https://web.invalid/admin-api/v1/card-issuing/products", {
      method: "POST",
    }),
    { SITE_KIND: "client" },
    () => assert.fail("cross-site call"),
  );
  assert.equal(cross.status, 404);
});
test('new card and terms routes are read-only with exact singleton boundaries', () => {
 const base=`/client-api/v1/customers/${id}/card-issuing`;
 for(const path of [base+'/terms',base+'/products/'+id,base+'/cards',base+'/cards/'+id]){
  assert.equal(issuingRoute('GET',path),true);assert.equal(issuingPath('GET',path),true);
  assert.equal(issuingRoute('POST',path),false);assert.equal(issuingPath('POST',path),false);
 }
 for(const path of [base+'/terms/'+id,base+'/wallet/'+id]){
  assert.equal(issuingRoute('GET',path),false);assert.equal(issuingPath('GET',path),false);
 }
});

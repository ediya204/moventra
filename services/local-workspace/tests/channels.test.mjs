import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  openStore,
  importDemo,
  cleanDemo,
} from "../demo-server/slash/store.mjs";
import { NAMESPACE as ns } from "../demo-server/slash/generate.mjs";
import {
  seedManagement,
  createSession,
} from "../demo-server/slash/management.mjs";
import {
  channelDetail,
  saveChannel,
  importChannelProducts,
  channelCatalog,
} from "../demo-server/slash/channels.mjs";
import { saveBin, binProduct, binsList } from "../demo-server/slash/bins.mjs";
import { portalState, portalAction } from "../demo-server/slash/portal.mjs";
import { createDemoServer } from "../demo-server/slash/server.mjs";
import { consoleRead } from "../demo-server/slash/console.mjs";
const config = {
  name: "Demo Slash eight products",
  provider: "Slash",
  entityRef: "DEMO-ENTITY-EIGHT",
  accountRef: "DEMO-ACCOUNT-EIGHT",
  status: "active",
  notes: "Synthetic isolated test",
};
const items = Array.from({ length: 8 }, (_, i) => ({
  id: `DEMO-UPSTREAM-${i + 1}`,
  prefix: `99020${i + 1}`,
  status: "active",
}));
function setup(t) {
  const db = openStore(":memory:");
  importDemo(db, { persist: false });
  seedManagement(db, ns);
  t.after(() => db.close());
  const c = saveChannel(db, ns, null, config);
  importChannelProducts(db, ns, c.id, { revision: c.revision, items });
  return { db, c: channelDetail(db, ns, c.id) };
}
function product(c, i = 0, patch = {}) {
  return {
    name: `Demo card ${i + 1}`,
    binPrefix: items[i].prefix,
    network: "Visa",
    currency: "USD",
    platform: "Slash",
    upstreamProductId: items[i].id,
    channelId: c.id,
    status: "draft",
    maxCards: 10,
    description: "Demo",
    internalNote: "",
    ...patch,
  };
}
function open(db, id, key = "DEMO-open-channel") {
  const s = portalState(db, ns),
    p = binProduct(db, ns, id);
  return portalAction(db, ns, {
    requestId: key,
    revision: s.revision,
    action: {
      type: "open",
      productId: id,
      productRevision: p.revision,
      name: "Channel card",

    },
  });
}
test("Eight-source catalog can link one then more products without duplicates or removing omitted pages", (t) => {
  const { db, c } = setup(t);
  assert.equal(c.total, 8);
  const p = saveBin(db, ns, null, product(c));
  assert.equal(channelDetail(db, ns, c.id).linked, 1);
  assert.equal(channelDetail(db, ns, c.id).unlinked, 7);
  assert.equal(channelCatalog(db, ns, c.id, { linked: "no" }).total, 7);
  assert.equal(binsList(db, ns, { channelId: c.id }).rows[0].id, p.id);
  assert.equal(
    importChannelProducts(db, ns, c.id, { revision: c.revision, items })
      .unchanged,
    8,
  );
  saveBin(db, ns, null, product(c, 1));
  assert.equal(channelDetail(db, ns, c.id).linked, 2);
  importChannelProducts(db, ns, c.id, {
    revision: c.revision,
    items: [{ ...items[7], status: "inactive" }],
  });
  assert.equal(channelDetail(db, ns, c.id).total, 8);
  assert.equal(
    consoleRead(db, ns, "audit", { action: "channel.import" }).rows[0]
      .targetType,
    "channels",
  );
});
test("Binding validates scope and prefix atomically; catalogs and issued identities cannot be silently reassigned", (t) => {
  const { db, c } = setup(t),
    other = saveChannel(db, ns, null, { ...config, entityRef: "DEMO-OTHER" });
  assert.throws(() => saveBin(db, ns, null, product(other)), /此渠道目录/);
  assert.throws(
    () => saveBin(db, ns, null, product(c, 0, { binPrefix: "990999" })),
    /prefix/,
  );
  assert.throws(
    () =>
      saveChannel(db, ns, c.id, {
        ...config,
        entityRef: "new",
        revision: c.revision,
      }),
    /范围/,
  );
  const p = saveBin(db, ns, null, product(c, 0, { status: "active" }));
  const issued = open(db, p.id);
  assert.throws(
    () =>
      saveBin(
        db,
        ns,
        p.id,
        product(c, 0, {
          status: "active",
          channelId: other.id,
          revision: p.revision,
        }),
      ),
    /重新关联/,
  );
  assert.equal(
    portalState(db, ns).cards.find((x) => x.id === issued.id).binProduct.id,
    p.id,
  );
  const before = channelDetail(db, ns, c.id);
  assert.throws(
    () =>
      importChannelProducts(db, ns, c.id, {
        revision: before.revision,
        items: [
          { ...items[1], status: "inactive" },
          { ...items[0], prefix: "999999" },
        ],
      }),
    /prefix/,
  );
  assert.equal(
    channelCatalog(db, ns, c.id, { keyword: items[1].id }).rows[0].status,
    "active",
  );
  assert.equal(channelDetail(db, ns, c.id).revision, before.revision);
});
test("Paused channel and unknown upstream status block client opening while retaining original product status", (t) => {
  const { db, c } = setup(t),
    p = saveBin(db, ns, null, product(c, 0, { status: "active" }));
  const s = portalState(db, ns);
  saveChannel(db, ns, c.id, {
    ...config,
    status: "paused",
    revision: c.revision,
  });
  assert.throws(() => open(db, p.id), /渠道已暂停/);
  assert.equal(portalState(db, ns).revision, s.revision);
  const publicRow = binsList(db, ns, { keyword: p.id }, true).rows[0];
  assert.equal(publicRow.status, "active");
  assert.match(publicRow.openingBlockedReason, /暂停/);
  assert.ok(!("channelId" in publicRow));
  let current = channelDetail(db, ns, c.id);
  saveChannel(db, ns, c.id, {
    ...config,
    status: "active",
    revision: current.revision,
  });
  current = channelDetail(db, ns, c.id);
  importChannelProducts(db, ns, c.id, {
    revision: current.revision,
    items: [{ ...items[0], status: "future_unknown" }],
  });
  assert.throws(() => open(db, p.id), /待确认/);
  assert.equal(
    channelCatalog(db, ns, c.id, { keyword: items[0].id }).rows[0].status,
    "future_unknown",
  );
});
test("Catalog import rejects secrets, full PAN, duplicates and stale updates; scoped cleanup preserves other channel data", (t) => {
  const { db, c } = setup(t);
  for (const bad of [
    [{ ...items[0], apiKey: "example" }],
    [{ ...items[0], prefix: "9".repeat(16) }],
    [items[0], items[0]],
  ])
    assert.throws(() =>
      importChannelProducts(db, ns, c.id, { revision: c.revision, items: bad }),
    );
  assert.throws(
    () => saveChannel(db, ns, null, { ...config, apiKey: "example" }),
    /凭据/,
  );
  assert.throws(
    () => importChannelProducts(db, ns, c.id, { revision: 0, items }),
    /更新/,
  );
  importDemo(db, { namespace: "channel-other", persist: false });
  saveChannel(db, "channel-other", null, config);
  cleanDemo(db, ns, { persist: false });
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM card_channels WHERE namespace=?")
      .get("channel-other").n,
    1,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM channel_products WHERE namespace=?")
      .get(ns).n,
    0,
  );
});
test("Channel HTTP endpoints require operator session and local Origin; paginated source details match imports", async (t) => {
  const { db, c } = setup(t),
    server = createDemoServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo/management/channels`,
    cookie = `adsflow_demo_ops=${createSession(db, ns, "operator", "demo-operator")}`;
  assert.equal((await fetch(base)).status, 401);
  const data = (
    await (
      await fetch(`${base}/${c.id}/products?pageSize=2&page=1`, {
        headers: { Cookie: cookie },
      })
    ).json()
  ).data;
  assert.equal(data.total, 8);
  assert.equal(data.rows.length, 2);
  assert.equal(
    (
      await fetch(`${base}/${c.id}/import`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://example.com" },
        body: JSON.stringify({ revision: c.revision, items }),
      })
    ).status,
    403,
  );
  const r = await fetch(`${base}/${c.id}/import`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: "http://127.0.0.1:8852" },
    body: JSON.stringify({ revision: c.revision, items }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.unchanged, 8);
});

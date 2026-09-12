import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  openStore,
  importDemo,
  cleanDemo,
} from "../demo-server/slash/store.mjs";
import { NAMESPACE as ns } from "../demo-server/slash/generate.mjs";
import { createDemoServer } from "../demo-server/slash/server.mjs";
import {
  seedManagement,
  managementRead as read,
  managementWrite as write,
  effectiveFees,
  previewFee,
  completeReset,
  memberLogin,
  session,
} from "../demo-server/slash/management.mjs";

const group = "DEMO-GROUP-STANDARD",
  user = "DEMO-USER-001";
function setup(t) {
  const db = openStore(":memory:");
  importDemo(db, { persist: false });
  seedManagement(db, ns);
  t.after(() => db.close());
  return db;
}
function update(db, path, body) {
  const owner = path.split("/").slice(0, 2).join("/");
  return write(db, ns, path, {
    revision: read(db, ns, owner).revision,
    ...body,
  });
}
function fees(db, scope, id, kind, bps, fixedMinor, inherit = false) {
  return effectiveFees(db, ns, scope, id).map((f) => ({
    kind: f.kind,
    inherit: f.kind === kind ? inherit : !f.overridden,
    bps: f.kind === kind ? bps : f.bps,
    fixedMinor: f.kind === kind ? fixedMinor : f.fixedMinor,
  }));
}
const reset = (db) =>
  update(db, `users/${user}/reset-password`, { reason: "自动化本地凭证验证" });

test("Management seeds are idempotent; server filters and paginates and whitelists user fields", (t) => {
  const db = setup(t);
  seedManagement(db, ns);
  assert.equal(read(db, ns, "groups").total, 2);
  assert.equal(read(db, ns, "users").total, 2);
  assert.equal(
    read(db, ns, "users", {
      status: "pending",
      groupId: "DEMO-GROUP-PARTNER",
      keyword: "studio",
    }).rows[0].id,
    "DEMO-USER-002",
  );
  assert.equal(read(db, ns, "users", { pageSize: 1, page: 1 }).rows.length, 1);
  assert.equal(read(db, ns, "users", { keyword: "' OR 1=1 --" }).total, 0);
  const detail = read(db, ns, `users/${user}`);
  assert.equal(detail.password_set, 0);
  assert.ok(!("password_hash" in detail));
  assert.deepEqual(
    detail.accounts.map((a) => [a.available_minor, a.posted_minor]),
    [
      [0, 0],
      [0, 0],
    ],
  );
});

test("Opening requires approval and creates exactly two zero-balance local accounts", (t) => {
  const db = setup(t);
  const { id } = write(db, ns, "users", {
    name: "Demo Test",
    email: "opening@example.com",
    groupId: group,
  });
  assert.equal(read(db, ns, `users/${id}`).status, "pending");
  assert.equal(read(db, ns, `users/${id}`).accounts.length, 0);
  assert.throws(
    () =>
      update(db, `users/${id}/status`, { status: "active", reason: "bypass" }),
    /审核/,
  );
  update(db, `users/${id}/review`, {
    decision: "approve",
    reason: "资料已核对",
  });
  const detail = read(db, ns, `users/${id}`);
  assert.equal(detail.status, "active");
  assert.equal(detail.accounts.length, 2);
  assert.ok(
    detail.accounts.every(
      (a) => a.available_minor === 0 && a.posted_minor === 0,
    ),
  );
  assert.throws(
    () =>
      write(db, ns, `users/${id}/review`, {
        revision: 0,
        decision: "approve",
        reason: "duplicate",
      }),
    /已更新/,
  );
  assert.throws(
    () =>
      update(db, `users/${id}/review`, {
        decision: "approve",
        reason: "duplicate",
      }),
    /已处理/,
  );
  update(db, "users/DEMO-USER-002/review", {
    decision: "reject",
    reason: "演示资料不完整",
  });
  assert.equal(read(db, ns, "users/DEMO-USER-002").accounts.length, 0);
  assert.throws(
    () =>
      write(db, ns, "users", {
        name: "Demo",
        email: "real@somewhere.invalid",
        groupId: group,
      }),
    /example.com/,
  );
});

test("Group fees inherit dynamically; user override, true zero, reversion and exact rounding", (t) => {
  const db = setup(t);
  update(db, `groups/${group}/fees`, {
    fees: fees(db, "group", group, "withdraw", 125, 2000000),
  });
  let f = previewFee(db, ns, {
    userId: user,
    kind: "withdraw",
    amountMinor: 100000001,
  });
  assert.equal(f.feeMinor, 3250001);
  assert.equal(f.source, "group");
  update(db, `users/${user}/fees`, {
    fees: fees(db, "user", user, "withdraw", 0, 0),
  });
  f = previewFee(db, ns, {
    userId: user,
    kind: "withdraw",
    amountMinor: 100000001,
  });
  assert.equal(f.feeMinor, 0);
  assert.equal(f.source, "user");
  update(db, `groups/${group}/fees`, {
    fees: fees(db, "group", group, "withdraw", 200, 1000000),
  });
  assert.equal(
    previewFee(db, ns, {
      userId: user,
      kind: "withdraw",
      amountMinor: 100000001,
    }).feeMinor,
    0,
  );
  update(db, `users/${user}/fees`, {
    fees: fees(db, "user", user, "withdraw", 0, 0, true),
  });
  f = previewFee(db, ns, {
    userId: user,
    kind: "withdraw",
    amountMinor: 100000001,
  });
  assert.equal(f.feeMinor, 3000001);
  assert.equal(f.precision, 6);
  const before = read(db, ns, `groups/${group}`);
  const invalid = fees(db, "group", group, "withdraw", 10001, 0);
  assert.throws(
    () => update(db, `groups/${group}/fees`, { fees: invalid }),
    /基点/,
  );
  assert.deepEqual(read(db, ns, `groups/${group}`), before);
  assert.throws(
    () =>
      previewFee(db, ns, { userId: user, kind: "withdraw", amountMinor: 0.1 }),
    /整数/,
  );
});

test("Moving a user changes inherited fees while keeping their own overrides", (t) => {
  const db = setup(t);
  update(db, `groups/${group}/fees`, {
    fees: fees(db, "group", group, "withdraw", 100, 0),
  });
  update(db, `users/${user}/fees`, {
    fees: fees(db, "user", user, "card_open", 0, 999),
  });
  update(db, `users/${user}/profile`, {
    name: "Demo Moved",
    groupId: "DEMO-GROUP-PARTNER",
  });
  const f = effectiveFees(db, ns, "user", user);
  assert.equal(f.find((x) => x.kind === "withdraw").fixedMinor, 2000000);
  assert.equal(f.find((x) => x.kind === "card_open").fixedMinor, 999);
});

test("Reset tokens are hashed, expire, are single-use, and revoke old authenticated sessions", (t) => {
  const db = setup(t),
    password = "Demo-password-1!",
    next = "Demo-password-2!";
  const first = reset(db);
  assert.ok(
    !JSON.stringify(db.prepare("SELECT * FROM mg_resets").all()).includes(
      first.token,
    ),
  );
  completeReset(db, ns, { token: first.token, password });
  assert.throws(
    () => completeReset(db, ns, { token: first.token, password }),
    /无效/,
  );
  const oldSession = memberLogin(db, ns, {
    email: "northstar@example.com",
    password,
  });
  assert.equal(session(db, ns, oldSession, "member").subject, user);
  const replaced = reset(db),
    replacement = reset(db);
  assert.throws(
    () => completeReset(db, ns, { token: replaced.token, password: next }),
    /无效/,
  );
  completeReset(db, ns, { token: replacement.token, password: next });
  assert.equal(session(db, ns, oldSession, "member"), null);
  assert.throws(
    () => memberLogin(db, ns, { email: "northstar@example.com", password }),
    /账号或密码错误/,
  );
  assert.ok(
    memberLogin(db, ns, { email: "northstar@example.com", password: next }),
  );
  const expiring = reset(db);
  db.prepare(
    "UPDATE mg_resets SET expires_at=0 WHERE consumed_at IS NULL",
  ).run();
  assert.throws(
    () => completeReset(db, ns, { token: expiring.token, password: next }),
    /过期/,
  );
  const output = JSON.stringify(read(db, ns, `users/${user}`));
  for (const secret of [password, next, replacement.token, "password_hash"])
    assert.ok(!output.includes(secret));
  assert.equal(read(db, ns, `users/${user}`).credential_version, 2);
});

test("Disabled groups block creation, approval, reset and member access", (t) => {
  const db = setup(t);
  const { token } = reset(db);
  completeReset(db, ns, { token, password: "Demo-password-1!" });
  const auth = memberLogin(db, ns, {
    email: "northstar@example.com",
    password: "Demo-password-1!",
  });
  const pending = write(db, ns, "users", {
    name: "Pending",
    email: "pending@example.com",
    groupId: group,
  });
  update(db, `groups/${group}/status`, {
    status: "disabled",
    reason: "暂停服务",
  });
  assert.equal(session(db, ns, auth, "member"), null);
  assert.throws(
    () =>
      write(db, ns, "users", {
        name: "Blocked",
        email: "blocked@example.com",
        groupId: group,
      }),
    /停用/,
  );
  assert.throws(
    () =>
      update(db, `users/${pending.id}/review`, {
        decision: "approve",
        reason: "test",
      }),
    /停用/,
  );
  assert.throws(() => reset(db), /启用/);
  assert.throws(
    () =>
      memberLogin(db, ns, {
        email: "northstar@example.com",
        password: "Demo-password-1!",
      }),
    /密码错误/,
  );
});

test("HTTP management requires its own operator session and local Origin; member cannot administer", async (t) => {
  const db = setup(t),
    server = createDemoServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/admin-api/settlement-management/demo/management/`;
  const request = (path, body, cookie = "", origin = "http://127.0.0.1:8852") =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await request("users")).status, 401);
  assert.equal(
    (
      await request(
        "session",
        { username: "demo@adsflow.local", password: "demo-only" },
        "",
        "https://evil.example",
      )
    ).status,
    403,
  );
  const login = await request("session", {
    username: "demo@adsflow.local",
    password: "demo-only",
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("users", undefined, cookie)).status, 200);
  const create = await request(
    "groups",
    { name: "HTTP group", description: "Test" },
    cookie,
  );
  assert.equal(create.status, 200);
  assert.equal(
    (await request("groups", { name: "HTTP group", description: "" }, cookie))
      .status,
    409,
  );
  const r = reset(db);
  assert.equal(
    (
      await request("reset/complete", {
        token: r.token,
        password: "Demo-http-password!",
      })
    ).status,
    200,
  );
  const member = await request("member-login", {
    email: "northstar@example.com",
    password: "Demo-http-password!",
  });
  assert.equal(member.status, 200);
  const memberCookie = member.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await request("member/me", undefined, memberCookie)).status,
    200,
  );
  assert.equal((await request("users", undefined, memberCookie)).status, 401);
  assert.equal(
    (await request("groups", { name: "Forbidden" }, memberCookie)).status,
    401,
  );
  const detail = await (
    await request(`users/${user}`, undefined, cookie)
  ).json();
  assert.ok(!("password_hash" in detail.data));
  for (let i = 0; i < 15; i++)
    await request("session", { username: "wrong", password: "wrong" });
  assert.equal(
    (await request("session", { username: "wrong", password: "wrong" })).status,
    429,
  );
});

test("Batch cleanup cascades management state and preserves another namespace", (t) => {
  const db = setup(t);
  importDemo(db, { namespace: "other-demo", persist: false });
  seedManagement(db, "other-demo");
  reset(db);
  cleanDemo(db, ns, { persist: false });
  for (const table of [
    "mg_groups",
    "mg_users",
    "mg_fees",
    "mg_accounts",
    "mg_resets",
    "mg_audit",
    "mg_sessions",
  ])
    assert.equal(
      db.prepare(`SELECT count(*) n FROM ${table} WHERE namespace=?`).get(ns).n,
      0,
    );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM mg_users WHERE namespace=?")
      .get("other-demo").n,
    2,
  );
});

test('current Moventra local login name opens the recovered management session', async t => {
 const db=setup(t),server=createDemoServer(db,ns);server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/admin-api/settlement-management/demo/management/session',{method:'POST',headers:{Origin:'http://127.0.0.1:8850','Content-Type':'application/json'},body:JSON.stringify({username:'demo@moventra.local',password:'demo-only'})});
  assert.equal(response.status,200);assert.equal((await response.json()).data.actor,'demo-operator');
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const check=await fetch(base+'/admin-api/settlement-management/demo/management/session',{headers:{Cookie:cookie}});assert.equal(check.status,200);
 } finally {server.close();}
});

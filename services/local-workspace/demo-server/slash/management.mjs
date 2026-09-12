import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export const feeKinds = [
  ["deposit", "USDT充值", "USDT", 6, 0, 0],
  ["exchange_usdt", "USDT兑换USD", "USDT", 6, 50, 0],
  ["exchange_usd", "USD兑换USDT", "USD", 2, 50, 0],
  ["withdraw", "USDT提现", "USDT", 6, 0, 2000000],
  ["card_open", "开卡", "USD", 2, 0, 0],
  ["card_topup", "卡片充值", "USD", 2, 0, 0],
  ["card_return", "卡片转回", "USD", 2, 0, 0],
  ["transfer", "内部划拨", "USD", 2, 0, 0],
  ["card_spend", "卡片消费", "USD", 2, 0, 0],
  ["fx", "外汇消费", "USD", 2, 200, 0],
].map(([kind, label, currency, precision, bps, fixedMinor]) => ({
  kind,
  label,
  currency,
  precision,
  bps,
  fixedMinor,
}));
const now = () => new Date().toISOString(),
  hash = (v) => createHash("sha256").update(v).digest("hex"),
  uid = (prefix) => `DEMO-${prefix}-${randomUUID()}`;
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
function value(v, label, max = 150) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    fail(`${label}无效`);
  return v.trim();
}
function fields(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    fail("包含未支持的字段");
}
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const v = fn();
    db.exec("COMMIT");
    return v;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function audit(db, ns, action, target, description) {
  db.prepare("INSERT INTO mg_audit VALUES(?,?,?,?,?,?,?)").run(
    ns,
    uid("AUDIT"),
    "demo-operator",
    action,
    target,
    description,
    now(),
  );
}
export function seedManagement(db, ns) {
  if (db.prepare("SELECT id FROM mg_groups WHERE namespace=? LIMIT 1").get(ns))
    return;
  transaction(db, () => {
    for (const [id, name, description] of [
      ["DEMO-GROUP-STANDARD", "标准客户", "适用于常规投放客户"],
      ["DEMO-GROUP-PARTNER", "合作伙伴", "独立商业分组，可单独设置费率"],
    ])
      db.prepare("INSERT INTO mg_groups VALUES(?,?,?,'active',?,0,?)").run(
        ns,
        id,
        name,
        description,
        now(),
      );
    for (const [id, group, name, email, status] of [
      [
        "DEMO-USER-001",
        "DEMO-GROUP-STANDARD",
        "Demo Northstar",
        "northstar@example.com",
        "active",
      ],
      [
        "DEMO-USER-002",
        "DEMO-GROUP-PARTNER",
        "Demo Studio",
        "studio@example.com",
        "pending",
      ],
    ]) {
      db.prepare(
        "INSERT INTO mg_users(namespace,id,group_id,name,email,status,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(ns, id, group, name, email, status, now());
      if (status === "active") accounts(db, ns, id);
    }
  });
}
function accounts(db, ns, userId) {
  for (const currency of ["USD", "USDT"])
    db.prepare("INSERT OR IGNORE INTO mg_accounts VALUES(?,?,?,?,0,0,?)").run(
      ns,
      userId,
      uid("ACCOUNT"),
      currency,
      now(),
    );
}
function group(db, ns, id) {
  const r = db
    .prepare("SELECT * FROM mg_groups WHERE namespace=? AND id=?")
    .get(ns, id);
  if (!r) fail("用户组不存在", 404);
  return r;
}
function user(db, ns, id) {
  const r = db
    .prepare(
      "SELECT id,group_id,name,email,status,review_note,revision,credential_version,created_at,password_hash IS NOT NULL AS password_set FROM mg_users WHERE namespace=? AND id=?",
    )
    .get(ns, id);
  if (!r) fail("用户不存在", 404);
  return r;
}
export function effectiveFees(db, ns, scope, id) {
  const owner = scope === "user" ? user(db, ns, id) : group(db, ns, id),
    groupId = scope === "user" ? owner.group_id : id;
  return feeKinds.map((def) => {
    const base = db
      .prepare(
        "SELECT bps,fixed_minor FROM mg_fees WHERE namespace=? AND scope='group' AND owner_id=? AND kind=?",
      )
      .get(ns, groupId, def.kind);
    const own =
      scope === "user"
        ? db
            .prepare(
              "SELECT bps,fixed_minor FROM mg_fees WHERE namespace=? AND scope='user' AND owner_id=? AND kind=?",
            )
            .get(ns, id, def.kind)
        : base;
    const selected = own || base;
    return {
      ...def,
      bps: selected?.bps ?? def.bps,
      fixedMinor: selected?.fixed_minor ?? def.fixedMinor,
      overridden: Boolean(own),
      source: own ? scope : base ? "group" : "default",
    };
  });
}
function page(q) {
  const size = Math.min(100, Math.max(1, Number(q.pageSize) || 10)),
    p = Math.max(0, Number(q.page) || 0);
  if (!Number.isInteger(p) || !Number.isInteger(size)) fail("分页参数无效");
  return { page: p, pageSize: size };
}
export function managementRead(db, ns, path, q = {}) {
  seedManagement(db, ns);
  if (path === "catalog") return { feeKinds };
  if (path === "groups") {
    const p = page(q),
      args = [ns, `%${q.keyword || ""}%`],
      where = "g.namespace=? AND g.name LIKE ?";
    return {
      ...p,
      total: db
        .prepare(`SELECT count(*) n FROM mg_groups g WHERE ${where}`)
        .get(...args).n,
      rows: db
        .prepare(
          `SELECT g.*, (SELECT count(*) FROM mg_users u WHERE u.namespace=g.namespace AND u.group_id=g.id) memberCount FROM mg_groups g WHERE ${where} ORDER BY g.created_at,g.id LIMIT ? OFFSET ?`,
        )
        .all(...args, p.pageSize, p.page * p.pageSize),
    };
  }
  if (path === "users") {
    const p = page(q),
      clauses = [
        "u.namespace=?",
        "(u.name LIKE ? OR u.email LIKE ? OR u.id LIKE ?)",
      ],
      search = `%${q.keyword || ""}%`,
      args = [ns, search, search, search];
    for (const [param, col] of [
      ["groupId", "group_id"],
      ["status", "status"],
    ])
      if (q[param]) {
        clauses.push(`u.${col}=?`);
        args.push(q[param]);
      }
    const where = clauses.join(" AND ");
    return {
      ...p,
      total: db
        .prepare(`SELECT count(*) n FROM mg_users u WHERE ${where}`)
        .get(...args).n,
      rows: db
        .prepare(
          `SELECT u.id,u.group_id,u.name,u.email,u.status,u.revision,u.created_at,g.name groupName FROM mg_users u JOIN mg_groups g ON g.namespace=u.namespace AND g.id=u.group_id WHERE ${where} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`,
        )
        .all(...args, p.pageSize, p.page * p.pageSize),
    };
  }
  const match = path.match(/^(groups|users)\/([^/]+)$/);
  if (match) {
    const isUser = match[1] === "users",
      id = match[2],
      owner = isUser ? user(db, ns, id) : group(db, ns, id);
    return {
      ...owner,
      fees: effectiveFees(db, ns, isUser ? "user" : "group", id),
      ...(isUser
        ? {
            groupName: group(db, ns, owner.group_id).name,
            accounts: db
              .prepare(
                "SELECT id,currency,available_minor,posted_minor FROM mg_accounts WHERE namespace=? AND user_id=?",
              )
              .all(ns, id),
          }
        : {}),
      audit: db
        .prepare(
          "SELECT actor,action,description,created_at FROM mg_audit WHERE namespace=? AND target_id=? ORDER BY created_at DESC,id DESC LIMIT 50",
        )
        .all(ns, id),
    };
  }
  fail("接口不存在", 404);
}
function revision(current, requested) {
  if (!Number.isInteger(requested) || current.revision !== requested)
    fail("记录已更新，请刷新后重试", 409);
}
export function managementWrite(db, ns, path, body) {
  seedManagement(db, ns);
  return transaction(db, () => {
    if (path === "groups") {
      fields(body, ["name", "description"]);
      const name = value(body.name, "用户组名称", 60),
        id = uid("GROUP");
      db.prepare("INSERT INTO mg_groups VALUES(?,?,?,'active',?,0,?)").run(
        ns,
        id,
        name,
        String(body.description || "").slice(0, 300),
        now(),
      );
      audit(db, ns, "group.create", id, `创建用户组 ${name}`);
      return { id };
    }
    if (path === "users") {
      fields(body, ["name", "email", "groupId"]);
      const g = group(db, ns, body.groupId);
      if (g.status !== "active") fail("停用用户组不能开户");
      const name = value(body.name, "姓名", 80),
        email = value(body.email, "邮箱").toLowerCase();
      if (!/^[a-z0-9._+-]+@example\.com$/.test(email))
        fail("本地Demo仅接受 example.com 合成邮箱");
      const id = uid("USER");
      db.prepare(
        "INSERT INTO mg_users(namespace,id,group_id,name,email,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
      ).run(ns, id, g.id, name, email, now());
      audit(db, ns, "user.opening", id, "提交本地开户申请");
      return { id };
    }
    const match = path.match(
      /^(groups|users)\/([^/]+)\/(fees|status|review|reset-password|profile)$/,
    );
    if (!match) fail("接口不存在", 404);
    const [, resource, id, operation] = match,
      isUser = resource === "users",
      owner = isUser ? user(db, ns, id) : group(db, ns, id);
    revision(owner, body.revision);
    if (operation === "fees") {
      fields(body, ["revision", "fees"]);
      if (!Array.isArray(body.fees) || body.fees.length !== feeKinds.length)
        fail("需要完整费率配置");
      const seen = new Set();
      for (const f of body.fees) {
        fields(f, ["kind", "inherit", "bps", "fixedMinor"]);
        if (
          !feeKinds.some((k) => k.kind === f.kind) ||
          seen.has(f.kind) ||
          typeof f.inherit !== "boolean"
        )
          fail("费率类型或继承选项无效");
        seen.add(f.kind);
        if (
          !f.inherit &&
          (!Number.isSafeInteger(f.bps) ||
            f.bps < 0 ||
            f.bps > 10000 ||
            !Number.isSafeInteger(f.fixedMinor) ||
            f.fixedMinor < 0 ||
            f.fixedMinor > 1e12)
        )
          fail("费率须为0–10000基点，固定费须为有效整数最小单位");
      }
      for (const f of body.fees) {
        db.prepare(
          "DELETE FROM mg_fees WHERE namespace=? AND scope=? AND owner_id=? AND kind=?",
        ).run(ns, isUser ? "user" : "group", id, f.kind);
        if (!f.inherit)
          db.prepare("INSERT INTO mg_fees VALUES(?,?,?,?,?,?)").run(
            ns,
            isUser ? "user" : "group",
            id,
            f.kind,
            f.bps,
            f.fixedMinor,
          );
      }
      audit(
        db,
        ns,
        "fees.update",
        id,
        body.fees
          .map(
            (f) =>
              `${f.kind}: ${f.inherit ? "继承" : `${f.bps}bps + ${f.fixedMinor}最小单位`}`,
          )
          .join("；"),
      );
    } else if (operation === "profile") {
      fields(
        body,
        isUser
          ? ["revision", "name", "groupId"]
          : ["revision", "name", "description"],
      );
      const name = value(body.name, "名称", 80);
      if (isUser) {
        const g = group(db, ns, body.groupId);
        if (g.status !== "active") fail("不能转入停用用户组");
        db.prepare(
          "UPDATE mg_users SET name=?,group_id=? WHERE namespace=? AND id=?",
        ).run(name, g.id, ns, id);
        audit(
          db,
          ns,
          "user.profile",
          id,
          `更新姓名及用户组 ${owner.group_id} → ${g.id}`,
        );
      } else {
        db.prepare(
          "UPDATE mg_groups SET name=?,description=? WHERE namespace=? AND id=?",
        ).run(name, String(body.description || "").slice(0, 300), ns, id);
        audit(
          db,
          ns,
          "group.profile",
          id,
          `更新用户组 ${owner.name} → ${name}`,
        );
      }
    } else if (operation === "status") {
      fields(body, ["revision", "status", "reason"]);
      if (!["active", "disabled"].includes(body.status)) fail("状态无效");
      if (isUser && !["active", "disabled"].includes(owner.status))
        fail("待审核用户需先完成开户审核");
      const reason = value(body.reason, "操作原因", 200);
      db.prepare(
        `UPDATE ${isUser ? "mg_users" : "mg_groups"} SET status=? WHERE namespace=? AND id=?`,
      ).run(body.status, ns, id);
      if (isUser && body.status === "disabled")
        db.prepare(
          "DELETE FROM mg_sessions WHERE namespace=? AND role='member' AND subject=?",
        ).run(ns, id);
      if (!isUser && body.status === "disabled")
        db.prepare(
          "DELETE FROM mg_sessions WHERE namespace=? AND role='member' AND subject IN (SELECT id FROM mg_users WHERE namespace=? AND group_id=?)",
        ).run(ns, ns, id);
      audit(
        db,
        ns,
        "status.update",
        id,
        `${body.status === "active" ? "启用" : "停用"}：${reason}`,
      );
    } else if (operation === "review" && isUser) {
      fields(body, ["revision", "decision", "reason"]);
      if (owner.status !== "pending") fail("该申请已处理");
      if (!["approve", "reject"].includes(body.decision)) fail("审核结果无效");
      const reason = value(body.reason, "审核意见", 200);
      if (
        body.decision === "approve" &&
        group(db, ns, owner.group_id).status !== "active"
      )
        fail("所属用户组已停用");
      db.prepare(
        "UPDATE mg_users SET status=?,review_note=? WHERE namespace=? AND id=?",
      ).run(
        body.decision === "approve" ? "active" : "rejected",
        reason,
        ns,
        id,
      );
      if (body.decision === "approve") accounts(db, ns, id);
      audit(
        db,
        ns,
        "opening.review",
        id,
        `${body.decision === "approve" ? "批准本地开户" : "拒绝开户"}：${reason}`,
      );
    } else if (operation === "reset-password" && isUser) {
      fields(body, ["revision", "reason"]);
      if (
        owner.status !== "active" ||
        group(db, ns, owner.group_id).status !== "active"
      )
        fail("仅启用用户及用户组可重置密码");
      const reason = value(body.reason, "重置原因", 200),
        token = randomBytes(32).toString("base64url"),
        expires = Date.now() + 15 * 60000;
      db.prepare(
        "UPDATE mg_resets SET consumed_at=? WHERE namespace=? AND user_id=? AND consumed_at IS NULL",
      ).run(Date.now(), ns, id);
      db.prepare("INSERT INTO mg_resets VALUES(?,?,?,?,?,NULL,?)").run(
        ns,
        id,
        uid("RESET"),
        hash(token),
        expires,
        now(),
      );
      audit(db, ns, "password.reset_requested", id, reason);
      db.prepare(
        "UPDATE mg_users SET revision=revision+1 WHERE namespace=? AND id=?",
      ).run(ns, id);
      return { token, expiresAt: new Date(expires).toISOString() };
    } else fail("不支持该操作");
    db.prepare(
      `UPDATE ${isUser ? "mg_users" : "mg_groups"} SET revision=revision+1 WHERE namespace=? AND id=?`,
    ).run(ns, id);
    return { id };
  });
}
export function previewFee(db, ns, body) {
  fields(body, ["userId", "kind", "amountMinor"]);
  if (
    !Number.isSafeInteger(body.amountMinor) ||
    body.amountMinor < 0 ||
    body.amountMinor > 1e12
  )
    fail("金额需为整数最小单位");
  const f = effectiveFees(db, ns, "user", body.userId).find(
    (f) => f.kind === body.kind,
  );
  if (!f) fail("费率类型无效");
  return {
    ...f,
    amountMinor: body.amountMinor,
    feeMinor:
      Number((BigInt(body.amountMinor) * BigInt(f.bps) + 9999n) / 10000n) +
      f.fixedMinor,
  };
}
export function completeReset(db, ns, body) {
  fields(body, ["token", "password"]);
  if (
    typeof body.token !== "string" ||
    body.token.length > 100 ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128
  )
    fail("重置链接无效或密码不符合12–128位要求");
  return transaction(db, () => {
    const r = db
      .prepare(
        "SELECT * FROM mg_resets WHERE namespace=? AND token_hash=? AND consumed_at IS NULL AND expires_at>?",
      )
      .get(ns, hash(body.token), Date.now());
    if (!r) fail("重置链接无效或已过期");
    const u = user(db, ns, r.user_id);
    if (u.status !== "active" || group(db, ns, u.group_id).status !== "active")
      fail("该用户当前不可重置");
    const salt = randomBytes(16).toString("hex"),
      digest = scryptSync(body.password, salt, 64).toString("hex");
    db.prepare(
      "UPDATE mg_users SET password_hash=?,credential_version=credential_version+1,revision=revision+1 WHERE namespace=? AND id=?",
    ).run(`${salt}:${digest}`, ns, u.id);
    db.prepare(
      "UPDATE mg_resets SET consumed_at=? WHERE namespace=? AND user_id=? AND consumed_at IS NULL",
    ).run(Date.now(), ns, u.id);
    db.prepare(
      "DELETE FROM mg_sessions WHERE namespace=? AND role='member' AND subject=?",
    ).run(ns, u.id);
    audit(db, ns, "password.reset_completed", u.id, "密码已更新，旧会话已失效");
    return { completed: true };
  });
}
export function createSession(db, ns, role, subject) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO mg_sessions VALUES(?,?,?,?,?)").run(
    ns,
    hash(token),
    role,
    subject,
    Date.now() + 3600000,
  );
  return token;
}
export function session(db, ns, token, role) {
  if (!token) return null;
  const s = db
    .prepare(
      "SELECT subject FROM mg_sessions WHERE namespace=? AND token_hash=? AND role=? AND expires_at>?",
    )
    .get(ns, hash(token), role, Date.now());
  if (s && role === "member") {
    const u = user(db, ns, s.subject);
    if (u.status !== "active" || group(db, ns, u.group_id).status !== "active")
      return null;
  }
  return s || null;
}
export function memberLogin(db, ns, body) {
  fields(body, ["email", "password"]);
  if (
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    body.password.length > 128
  )
    fail("账号或密码错误", 401);
  const u = db
    .prepare("SELECT * FROM mg_users WHERE namespace=? AND email=?")
    .get(ns, body.email.toLowerCase());
  const [salt, digest] = (
    u?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`
  ).split(":");
  const valid = timingSafeEqual(
    scryptSync(body.password, salt, 64),
    Buffer.from(digest, "hex"),
  );
  if (
    !valid ||
    !u ||
    u.status !== "active" ||
    group(db, ns, u.group_id).status !== "active"
  )
    fail("账号或密码错误", 401);
  return createSession(db, ns, "member", u.id);
}

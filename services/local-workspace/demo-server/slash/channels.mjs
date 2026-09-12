import { randomUUID } from "node:crypto";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const now = () => new Date().toISOString();
function audit(db, ns, id, action, description) {
  db.prepare("INSERT INTO mg_audit VALUES(?,?,?,?,?,?,?)").run(
    ns,
    `DEMO-AUDIT-${randomUUID()}`,
    "demo-operator",
    action,
    id,
    description,
    now(),
  );
}
export function channelDetail(db, ns, id) {
  const r = db
    .prepare("SELECT * FROM card_channels WHERE namespace=? AND id=?")
    .get(ns, id);
  if (!r) fail("渠道不存在", 404);
  const counts = db
    .prepare(
      "SELECT count(*) total FROM channel_products WHERE namespace=? AND channel_id=?",
    )
    .get(ns, id);
  const linked = db
    .prepare(
      "SELECT count(DISTINCT p.upstream_product_id) total FROM bin_channel_links l JOIN bin_products p ON p.namespace=l.namespace AND p.id=l.product_id JOIN channel_products s ON s.namespace=l.namespace AND s.channel_id=l.channel_id AND s.source_id=p.upstream_product_id WHERE l.namespace=? AND l.channel_id=?",
    )
    .get(ns, id);
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    entityRef: r.entity_ref,
    accountRef: r.account_ref,
    status: r.status,
    notes: r.notes,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    total: counts.total,
    linked: linked.total,
    unlinked: counts.total - linked.total,
    mode: "manual-catalog",
    lastImportedAt: db
      .prepare(
        "SELECT max(collected_at) t FROM channel_products WHERE namespace=? AND channel_id=?",
      )
      .get(ns, id).t,
  };
}
function paging(q) {
  const page = Number(q.page ?? 0),
    pageSize = Number(q.pageSize ?? 10);
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    fail("分页参数无效");
  return { page, pageSize };
}
export function channelList(db, ns, q = {}) {
  const { page, pageSize } = paging(q),
    key = `%${q.keyword || ""}%`,
    where =
      "namespace=? AND (name LIKE ? OR entity_ref LIKE ? OR account_ref LIKE ?)";
  return {
    rows: db
      .prepare(
        `SELECT id FROM card_channels WHERE ${where} ORDER BY created_at,id LIMIT ? OFFSET ?`,
      )
      .all(ns, key, key, key, pageSize, page * pageSize)
      .map((r) => channelDetail(db, ns, r.id)),
    total: db
      .prepare(`SELECT count(*) n FROM card_channels WHERE ${where}`)
      .get(ns, key, key, key).n,
    page,
    pageSize,
  };
}
export function saveChannel(db, ns, id, b) {
  const allowed = [
    "name",
    "provider",
    "entityRef",
    "accountRef",
    "status",
    "notes",
    "revision",
  ];
  if (!b || Object.keys(b).some((k) => !allowed.includes(k)))
    fail("包含不支持的渠道字段；此页面不接收凭据");
  for (const [k, max, required] of [
    ["name", 60, true],
    ["entityRef", 120, true],
    ["accountRef", 120, false],
    ["notes", 500, false],
  ])
    if (
      typeof b[k] !== "string" ||
      b[k].length > max ||
      (required && !b[k].trim())
    )
      fail("渠道资料无效：" + k);
  if (b.provider !== "Slash" || !["active", "paused"].includes(b.status))
    fail("渠道类型或状态无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = id ? channelDetail(db, ns, id) : null;
    if (old && b.revision !== old.revision)
      fail("渠道已更新，请刷新后重试", 409);
    const scoped =
      old &&
      (old.total > 0 ||
        db
          .prepare(
            "SELECT 1 FROM bin_channel_links WHERE namespace=? AND channel_id=?",
          )
          .get(ns, id));
    if (
      scoped &&
      (b.entityRef.trim() !== old.entityRef ||
        b.accountRef.trim() !== old.accountRef ||
        b.provider !== old.provider)
    )
      fail("已有目录或关联，不能更改渠道实体/账户范围，请新增渠道");
    const duplicate = db
      .prepare(
        "SELECT id FROM card_channels WHERE namespace=? AND provider=? AND entity_ref=? AND account_ref=?",
      )
      .get(ns, b.provider, b.entityRef.trim(), b.accountRef.trim());
    if (duplicate && duplicate.id !== id)
      fail("此实体与账户已配置渠道，请复用现有渠道");
    const cid = id || `DEMO-CHANNEL-${randomUUID()}`,
      time = now();
    db.prepare(
      "INSERT INTO card_channels VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET name=excluded.name,entity_ref=excluded.entity_ref,account_ref=excluded.account_ref,status=excluded.status,notes=excluded.notes,revision=excluded.revision,updated_at=excluded.updated_at",
    ).run(
      ns,
      cid,
      b.name.trim(),
      b.provider,
      b.entityRef.trim(),
      b.accountRef.trim(),
      b.status,
      b.notes,
      old ? old.revision + 1 : 0,
      old?.createdAt || time,
      time,
    );
    audit(
      db,
      ns,
      cid,
      old ? "channel.update" : "channel.create",
      `${old ? "维护" : "创建"}渠道 ${b.name}；${b.status}；仅本地目录`,
    );
    db.exec("COMMIT");
    return channelDetail(db, ns, cid);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
// Append/update only the supplied page. Omitted products are never marked deleted/inactive.
export function importChannelProducts(db, ns, id, b) {
  if (
    !b ||
    Object.keys(b).some((k) => !["revision", "items"].includes(k)) ||
    !Array.isArray(b.items) ||
    !b.items.length ||
    b.items.length > 100
  )
    fail("每批导入1–100个产品，仅接收 items 与 revision");
  const seen = new Set();
  for (const r of b.items) {
    if (
      !r ||
      Object.keys(r).some((k) => !["id", "prefix", "status"].includes(k)) ||
      typeof r.id !== "string" ||
      !/^[\w-]{1,120}$/.test(r.id) ||
      typeof r.prefix !== "string" ||
      !/^\d{1,8}$/.test(r.prefix) ||
      typeof r.status !== "string" ||
      !/^[a-zA-Z_-]{1,40}$/.test(r.status) ||
      seen.has(r.id)
    )
      fail(
        "目录格式无效：只导入唯一 id、1–8位 prefix 和原始 status，不录入卡号或凭据",
      );
    seen.add(r.id);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const ch = channelDetail(db, ns, id);
    if (ch.revision !== b.revision)
      fail("渠道或目录已更新，请重新读取后导入", 409);
    let inserted = 0,
      updated = 0,
      unchanged = 0;
    const time = now();
    for (const r of b.items) {
      const old = db
        .prepare(
          "SELECT * FROM channel_products WHERE namespace=? AND channel_id=? AND source_id=?",
        )
        .get(ns, id, r.id);
      if (old && old.prefix !== r.prefix) {
        const used = db
          .prepare(
            "SELECT 1 FROM bin_channel_links l JOIN bin_products p ON p.namespace=l.namespace AND p.id=l.product_id WHERE l.namespace=? AND l.channel_id=? AND p.upstream_product_id=?",
          )
          .get(ns, id, r.id);
        if (used) fail("已关联产品的 prefix 发生变化，请核实后使用新产品映射");
      }
      if (old && old.prefix === r.prefix && old.status === r.status) {
        unchanged++;
        continue;
      }
      old ? updated++ : inserted++;
      db.prepare(
        "INSERT INTO channel_products VALUES(?,?,?,?,?,?,?) ON CONFLICT(namespace,channel_id,source_id) DO UPDATE SET prefix=excluded.prefix,status=excluded.status,revision=excluded.revision,collected_at=excluded.collected_at",
      ).run(ns, id, r.id, r.prefix, r.status, old ? old.revision + 1 : 0, time);
    }
    if (inserted || updated) {
      db.prepare(
        "UPDATE card_channels SET revision=revision+1,updated_at=? WHERE namespace=? AND id=?",
      ).run(time, ns, id);
      audit(
        db,
        ns,
        id,
        "channel.import",
        `人工导入目录：新增 ${inserted}，更新 ${updated}，未变 ${unchanged}；未调用 Slash`,
      );
    }
    db.exec("COMMIT");
    return { inserted, updated, unchanged, channel: channelDetail(db, ns, id) };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function channelCatalog(db, ns, id, q = {}) {
  channelDetail(db, ns, id);
  const { page, pageSize } = paging(q),
    args = [ns, id],
    clauses = ["s.namespace=?", "s.channel_id=?"];
  if (q.keyword) {
    clauses.push("(s.source_id LIKE ? OR s.prefix LIKE ?)");
    args.push(`%${q.keyword}%`, `%${q.keyword}%`);
  }
  const exists =
    "EXISTS(SELECT 1 FROM bin_channel_links l JOIN bin_products p ON p.namespace=l.namespace AND p.id=l.product_id WHERE l.namespace=s.namespace AND l.channel_id=s.channel_id AND p.upstream_product_id=s.source_id)";
  if (q.linked === "yes" || q.linked === "no")
    clauses.push((q.linked === "no" ? "NOT " : "") + exists);
  const where = clauses.join(" AND ");
  const rows = db
    .prepare(
      `SELECT s.* FROM channel_products s WHERE ${where} ORDER BY s.source_id LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, page * pageSize)
    .map((r) => ({
      id: r.source_id,
      prefix: r.prefix,
      status: r.status,
      revision: r.revision,
      collectedAt: r.collected_at,
      products: db
        .prepare(
          "SELECT p.id,p.name FROM bin_channel_links l JOIN bin_products p ON p.namespace=l.namespace AND p.id=l.product_id WHERE l.namespace=? AND l.channel_id=? AND p.upstream_product_id=?",
        )
        .all(ns, id, r.source_id),
    }));
  return {
    rows,
    total: db
      .prepare(`SELECT count(*) n FROM channel_products s WHERE ${where}`)
      .get(...args).n,
    page,
    pageSize,
  };
}
export function productChannel(db, ns, p) {
  const link = db
    .prepare(
      "SELECT channel_id FROM bin_channel_links WHERE namespace=? AND product_id=?",
    )
    .get(ns, p.id);
  if (!link) return {};
  const c = channelDetail(db, ns, link.channel_id),
    s = db
      .prepare(
        "SELECT * FROM channel_products WHERE namespace=? AND channel_id=? AND source_id=?",
      )
      .get(ns, c.id, p.upstreamProductId);
  return {
    channelId: c.id,
    channelName: c.name,
    channelStatus: c.status,
    sourceStatus: s?.status,
    openingBlockedReason:
      c.status !== "active"
        ? "发卡渠道已暂停"
        : !s
          ? "上游产品未关联"
          : s.prefix !== p.binPrefix
            ? "BIN与上游产品不一致"
            : s.status !== "active"
              ? "上游产品未启用或状态待确认"
              : undefined,
  };
}
export function bindProduct(db, ns, p, b, old) {
  const cid = b.channelId === undefined ? old?.channelId : b.channelId;
  if (cid !== undefined && cid !== null && typeof cid !== "string")
    fail("渠道标识无效");
  if (old?.issuedCount && (cid || "") !== (old.channelId || ""))
    fail("已有卡片不能重新关联渠道，请创建新产品");
  if (!cid) {
    if (old?.channelId)
      db.prepare(
        "DELETE FROM bin_channel_links WHERE namespace=? AND product_id=?",
      ).run(ns, p.id);
    return;
  }
  const c = channelDetail(db, ns, cid),
    source = db
      .prepare(
        "SELECT * FROM channel_products WHERE namespace=? AND channel_id=? AND source_id=?",
      )
      .get(ns, cid, b.upstreamProductId);
  if (!source || source.prefix !== b.binPrefix)
    fail("请选择此渠道目录中的对应产品，BIN须与prefix一致");
  if (b.platform !== c.provider) fail("平台必须与所选渠道一致");
  db.prepare(
    "INSERT INTO bin_channel_links VALUES(?,?,?) ON CONFLICT(namespace,product_id) DO UPDATE SET channel_id=excluded.channel_id",
  ).run(ns, p.id, cid);
  // Paused channels/catalog entries may be linked as drafts, but cannot newly enable a product.
  const reason = productChannel(db, ns, p).openingBlockedReason;
  if (b.status === "active" && reason && (!old || old.status !== "active"))
    fail(reason);
}

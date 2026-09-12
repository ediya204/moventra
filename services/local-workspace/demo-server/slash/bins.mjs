import {productChannel,bindProduct} from './channels.mjs';
import { randomUUID } from "node:crypto";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const stamp = () => new Date().toISOString();
export function seedBins(db, ns) {
  if (
    db.prepare("SELECT 1 FROM bin_products WHERE namespace=? LIMIT 1").get(ns)
  )
    return;
  const now = stamp();
  for (const [id, name, prefix, network, status, description] of [
    [
      "DEMO-BIN-USD-VISA",
      "通用投放 · Visa",
      "990001",
      "Visa",
      "active",
      "演示产品，用于通用投放场景的功能验证。",
    ],
    [
      "DEMO-BIN-USD-MC",
      "数字订阅 · Mastercard",
      "99000201",
      "Mastercard",
      "active",
      "演示产品，用于数字订阅场景的功能验证。",
    ],
    [
      "DEMO-BIN-USD-RESERVE",
      "备用产品 · Visa",
      "990003",
      "Visa",
      "paused",
      "演示暂停开卡状态。",
    ],
  ])
    db.prepare(
      "INSERT INTO bin_products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      ns,
      id,
      name,
      prefix,
      network,
      "USD",
      "Demo",
      null,
      status,
      50,
      description,
      "合成BIN，仅作本地测试，不代表真实卡组织或发卡机构分配。",
      0,
      now,
      now,
    );
}
function internal(row) {
  return {
    id: row.id,
    name: row.name,
    binPrefix: row.bin_prefix,
    network: row.network,
    currency: row.currency,
    platform: row.platform,
    upstreamProductId: row.upstream_product_id,
    status: row.status,
    maxCards: row.max_cards,
    description: row.description,
    internalNote: row.internal_note,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    issuedCount: row.issuedCount,
  };
}
export function binProduct(db, ns, id) {
  const row = db
    .prepare(
      "SELECT p.*,(SELECT count(*) FROM bin_card_links c WHERE c.namespace=p.namespace AND c.product_id=p.id) issuedCount FROM bin_products p WHERE namespace=? AND id=?",
    )
    .get(ns, id);
  if (!row) fail("卡BIN产品不存在", 404);
  const p=internal(row),channel=productChannel(db,ns,p);
  return {...p,...channel,openingBlockedReason:channel.openingBlockedReason||(!channel.channelId&&p.platform!=="Demo"?"请先关联发卡渠道与上游产品":undefined)};
}
export function publicProduct(p) {
  return {
    id: p.id,
    name: p.name,
    binPrefix: p.binPrefix,
    network: p.network,
    currency: p.currency,
    status: p.status,
    description: p.description,
    revision: p.revision,
    maxCards: p.maxCards,
    issuedCount: p.issuedCount,
    openingBlockedReason: p.openingBlockedReason,
    remaining: Math.max(0, p.maxCards - p.issuedCount),
    mode: "local-demo",
  };
}
export function binsList(db, ns, q = {}, client = false) {
  seedBins(db, ns);
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
  const clauses = ["namespace=?"],
    args = [ns];
  if (client) clauses.push("status IN('active','paused')");
  else if (!q.status) clauses.push("status <> 'archived'");
  if (q.status) {
    clauses.push("status=?");
    args.push(q.status);
  }
  if (q.keyword) {
    clauses.push("(name LIKE ? OR bin_prefix LIKE ? OR id LIKE ?)");
    args.push(...Array(3).fill(`%${q.keyword}%`));
  }
  if (q.channelId) {clauses.push("id IN (SELECT product_id FROM bin_channel_links WHERE namespace=? AND channel_id=?)");args.push(ns,q.channelId);}
  if (q.network) {
    clauses.push("network=?");
    args.push(q.network);
  }
  const where = clauses.join(" AND ");
  return {
    total: db
      .prepare(`SELECT count(*) n FROM bin_products WHERE ${where}`)
      .get(...args).n,
    page,
    pageSize,
    rows: db
      .prepare(
        `SELECT id FROM bin_products WHERE ${where} ORDER BY created_at,id LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, page * pageSize)
      .map((r) => {
        const p = binProduct(db, ns, r.id);
        return client ? publicProduct(p) : p;
      }),
  };
}
export function binsDetail(db, ns, id) {
  const p = binProduct(db, ns, id);
  return {
    ...p,
    audit: db
      .prepare(
        "SELECT actor,action,description,created_at FROM mg_audit WHERE namespace=? AND target_id=? ORDER BY rowid DESC LIMIT 30",
      )
      .all(ns, id),
  };
}
function validate(body) {
  const fields = [
    "name",
    "channelId",
    "binPrefix",
    "network",
    "currency",
    "platform",
    "upstreamProductId",
    "status",
    "maxCards",
    "description",
    "internalNote",
    "revision",
  ];
  if (!body || Object.keys(body).some((k) => !fields.includes(k)))
    fail("包含未支持的产品字段");
  for (const [key, max, required] of [
    ["name", 60, true],
    ["platform", 40, true],
    ["upstreamProductId", 120, false],
    ["description", 300, false],
    ["internalNote", 500, false],
  ])
    if (
      typeof body[key] !== "string" ||
      body[key].length > max ||
      (required && !body[key].trim())
    )
      fail(`${key} 长度或内容无效`);
  if (
    typeof body.binPrefix !== "string" ||
    !/^\d{6}(\d{2})?$/.test(body.binPrefix)
  )
    fail("BIN前缀需为6或8位数字，不能输入完整卡号");
  if (!["Visa", "Mastercard"].includes(body.network) || body.currency !== "USD")
    fail("当前本地开卡仅支持 Visa / Mastercard 的 USD 虚拟卡");
  if (!["draft", "active", "paused", "archived"].includes(body.status))
    fail("产品状态无效");
  if (
    !Number.isSafeInteger(body.maxCards) ||
    body.maxCards < 1 ||
    body.maxCards > 1000
  )
    fail("开卡数量限制须为1–1000的整数");
}
export function saveBin(db, ns, id, body) {
  seedBins(db, ns);
  validate(body);
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = stamp(),
      old = id ? binProduct(db, ns, id) : null;
    if (old && old.revision !== body.revision)
      fail("产品已更新，请重新读取后再保存", 409);
    if (old?.status === "archived" && body.status !== "archived")
      fail("已归档产品不可重新上架，请创建新产品");
    if (
      old?.issuedCount &&
      [
        "binPrefix",
        "network",
        "currency",
        "platform",
        "upstreamProductId",
      ].some((k) => (old[k] || "") !== body[k])
    )
      fail("已有卡片的产品不可修改发行标识，请创建新产品");
    if (old && body.maxCards < old.issuedCount)
      fail("开卡限制不能低于已开卡数量");
    const productId = id || `DEMO-BIN-${randomUUID()}`;
    db.prepare(
      "INSERT INTO bin_products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET name=excluded.name,bin_prefix=excluded.bin_prefix,network=excluded.network,currency=excluded.currency,platform=excluded.platform,upstream_product_id=excluded.upstream_product_id,status=excluded.status,max_cards=excluded.max_cards,description=excluded.description,internal_note=excluded.internal_note,revision=excluded.revision,updated_at=excluded.updated_at",
    ).run(
      ns,
      productId,
      body.name.trim(),
      body.binPrefix,
      body.network,
      body.currency,
      body.platform.trim(),
      body.upstreamProductId || null,
      body.status,
      body.maxCards,
      body.description,
      body.internalNote,
      old ? old.revision + 1 : 0,
      old?.createdAt || now,
      now,
    );
    bindProduct(db,ns,{id:productId,binPrefix:body.binPrefix,upstreamProductId:body.upstreamProductId},body,old);
    if(body.status==='active' && body.platform!=='Demo' && !binProduct(db,ns,productId).channelId)fail('上架前请关联发卡渠道与上游产品');
    db.prepare("INSERT INTO mg_audit VALUES(?,?,?,?,?,?,?)").run(
      ns,
      `DEMO-AUDIT-${randomUUID()}`,
      "demo-operator",
      old ? "bin.update" : "bin.create",
      productId,
      `${old ? "维护" : "创建"}卡BIN产品 ${body.name}；状态 ${old?.status || "新建"} → ${body.status}`,
      now,
    );
    db.exec("COMMIT");
    return binProduct(db, ns, productId);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function validateOpening(db, ns, action) {
  if (typeof action.productId !== "string" || !action.productId)
    fail("请选择卡BIN产品");
  const p = binProduct(db, ns, action.productId);
  if(p.openingBlockedReason)fail(p.openingBlockedReason);
  if (p.status !== "active") fail("此产品已暂停或下架，请重新选择");
  if (
    !Number.isInteger(action.productRevision) ||
    action.productRevision !== p.revision
  )
    fail("产品配置已更新，请刷新产品列表后重新确认", 409);
  if (p.issuedCount >= p.maxCards) fail("该产品已达到本地开卡数量限制");
  return {
    id: p.id,
    name: p.name,
    binPrefix: p.binPrefix,
    network: p.network,
    currency: p.currency,
    revision: p.revision,
    mode: "local-demo",
  };
}

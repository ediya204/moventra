import { randomUUID } from "node:crypto";
import { managementRead } from "./management.mjs";
import { portalList, portalEntry } from "./portal.mjs";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const paging = (q) => {
  const page = Number(q.page ?? 0),
    pageSize = Number(q.pageSize ?? 10);
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    fail("分页参数无效");
  return { page, pageSize };
};
export function settings(db, ns) {
  return (
    db
      .prepare(
        "SELECT workspace_name AS workspaceName,notice,revision,updated_at AS updatedAt FROM mg_settings WHERE namespace=?",
      )
      .get(ns) || {
      workspaceName: "管理总后台",
      notice: "",
      revision: 0,
      updatedAt: null,
    }
  );
}
function auditRows(db, ns, q = {}) {
  const p = paging(q),
    clauses = ["a.namespace=?"],
    args = [ns];
  if (q.keyword) {
    clauses.push(
      "(a.description LIKE ? OR a.target_id LIKE ? OR a.actor LIKE ?)",
    );
    args.push(...Array(3).fill(`%${q.keyword}%`));
  }
  if (q.action) {
    clauses.push("a.action=?");
    args.push(q.action);
  }
  for (const [key, op] of [
    ["from", ">="],
    ["to", "<"],
  ])
    if (q[key]) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(q[key]) ||
        Number.isNaN(Date.parse(q[key])) ||
        new Date(q[key]).toISOString().slice(0, 10) !== q[key]
      )
        fail("日期无效");
      clauses.push(`a.created_at ${op} ?`);
      args.push(
        key === "to"
          ? new Date(Date.parse(q[key]) + 86400000).toISOString()
          : `${q[key]}T00:00:00.000Z`,
      );
    }
  if (q.from && q.to && q.from > q.to) fail("开始日期不能晚于结束日期");
  const where = clauses.join(" AND ");
  const rows = db
    .prepare(
      `SELECT a.id,a.actor,a.action,a.target_id AS targetId,a.description,a.created_at AS createdAt,CASE WHEN u.id IS NOT NULL THEN 'users' WHEN g.id IS NOT NULL THEN 'groups' WHEN ch.id IS NOT NULL THEN 'channels' WHEN bp.id IS NOT NULL THEN 'bins' ELSE 'settings' END targetType FROM mg_audit a LEFT JOIN mg_users u ON u.namespace=a.namespace AND u.id=a.target_id LEFT JOIN mg_groups g ON g.namespace=a.namespace AND g.id=a.target_id LEFT JOIN card_channels ch ON ch.namespace=a.namespace AND ch.id=a.target_id LEFT JOIN bin_products bp ON bp.namespace=a.namespace AND bp.id=a.target_id WHERE ${where} ORDER BY a.created_at DESC,a.rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, p.pageSize, p.page * p.pageSize);
  return {
    ...p,
    total: db
      .prepare(`SELECT count(*) n FROM mg_audit a WHERE ${where}`)
      .get(...args).n,
    rows,
    actions: db
      .prepare(
        "SELECT DISTINCT action FROM mg_audit WHERE namespace=? ORDER BY action",
      )
      .all(ns)
      .map((r) => r.action),
  };
}
function orderView(e) {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    amount: e.amount,
    currency: e.currency || "USD",
    status: e.statusText || e.status,
    time: e.time,
    orderId: e.orderId,
    card: e.cardSummary,
    finance: e.financeSummary,
  };
}
export function consoleRead(db, ns, path, q = {}) {
  if (path === "settings") return settings(db, ns);
  if (path === "audit") return auditRows(db, ns, q);
  if (path === "overview") {
    const users = db
      .prepare(
        "SELECT status,count(*) count FROM mg_users WHERE namespace=? GROUP BY status",
      )
      .all(ns);
    const groups = db
      .prepare(
        "SELECT status,count(*) count FROM mg_groups WHERE namespace=? GROUP BY status",
      )
      .all(ns);
    const customFeeUsers = db
      .prepare(
        "SELECT count(DISTINCT owner_id) n FROM mg_fees WHERE namespace=? AND scope='user'",
      )
      .get(ns).n;
    const pending = managementRead(db, ns, "users", {
      status: "pending",
      pageSize: 5,
    });
    return {
      asOf: new Date().toISOString(),
      namespace: ns,
      settings: settings(db, ns),
      users,
      groups,
      customFeeUsers,
      pending,
      audit: auditRows(db, ns, { pageSize: 5 }),
      source: "local-management",
    };
  }
  if (path === "orders") {
    paging(q);
    const result = portalList(db, ns, { ...q, group: "funds" });
    return {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      rows: result.rows.map(orderView),
    };
  }
  if (path.startsWith("orders/")) {
    const e = portalEntry(db, ns, path.slice(7));
    if (!e?.orderId) fail("资金订单不存在", 404);
    return orderView(e);
  }
  if (path === "system")
    return {
      namespace: ns,
      checkedAt: new Date().toISOString(),
      storage:
        db.prepare("SELECT 1 ok").get().ok === 1 ? "available" : "unknown",
      migrations: db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((r) => r.version),
      sourceRecords: db
        .prepare(
          "SELECT kind,count(*) count FROM source_records WHERE namespace=? GROUP BY kind",
        )
        .all(ns),
      latestCollectedAt: db
        .prepare(
          "SELECT MAX(json_extract(internal_json,'$.lastSyncedAt')) t FROM source_records WHERE namespace=?",
        )
        .get(ns).t,
      roles: [
        {
          id: "operator",
          label: "本地演示操作员",
          permissions: [
            "管理查询",
            "开户审核",
            "用户与组配置",
            "费率配置",
            "密码重置",
            "后台设置",
          ],
        },
        {
          id: "member",
          label: "本地客户端个人账户",
          permissions: ["本人会话查询", "本人密码重置"],
        },
      ],
      channels: [
        {
          id: "local-management",
          name: "客户与管理数据",
          mode: "本地读写",
          description: "用户、开户、费率与审计保存至隔离数据库。",
        },
        {
          id: "slash",
          name: "Slash 场景数据",
          mode: "本地模拟",
          description: "查询合成卡片和清算记录；未验证真实 Slash 连接。",
        },
        {
          id: "portal",
          name: "客户端资金流程",
          mode: "本地查询",
          description: "与现有客户端演示共用订单，订单中心仅提供查询。",
        },
      ],
    };
  fail("管理接口不存在", 404);
}
export function consoleWrite(db, ns, path, body) {
  if (path !== "settings") fail("不支持此管理操作", 404);
  if (
    !body ||
    Object.keys(body).some(
      (k) => !["workspaceName", "notice", "revision"].includes(k),
    )
  )
    fail("包含未支持的设置");
  if (
    typeof body.workspaceName !== "string" ||
    !body.workspaceName.trim() ||
    body.workspaceName.trim().length > 40 ||
    typeof body.notice !== "string" ||
    body.notice.length > 300
  )
    fail("后台名称需1–40字，公告最多300字");
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = settings(db, ns);
    if (!Number.isInteger(body.revision) || body.revision !== old.revision)
      fail("设置已更新，请刷新后重试", 409);
    const date = new Date().toISOString();
    db.prepare(
      "INSERT INTO mg_settings VALUES(?,?,?,?,?) ON CONFLICT(namespace) DO UPDATE SET workspace_name=excluded.workspace_name,notice=excluded.notice,revision=excluded.revision,updated_at=excluded.updated_at",
    ).run(ns, body.workspaceName.trim(), body.notice, old.revision + 1, date);
    db.prepare("INSERT INTO mg_audit VALUES(?,?,?,?,?,?,?)").run(
      ns,
      `DEMO-AUDIT-${randomUUID()}`,
      "demo-operator",
      "settings.update",
      "console-settings",
      `更新后台名称与首页公告：${body.workspaceName.trim()}`,
      date,
    );
    db.exec("COMMIT");
    return settings(db, ns);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

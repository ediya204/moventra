import { randomUUID, createHash } from "node:crypto";
const now = () => new Date().toISOString();
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const allPermissions = [
  "card.read",
  "card.freeze",
  "card.unfreeze.request",
  "card.unfreeze.execute",
  "card.debit",
  "card.frozen_debit",
  "card.transfer_in",
  "card.transfer_out",
  "card.approve",
  "card.execute",
];
export const demoIdentities = {
  "controller@example.com": {actor: "demo-controller", permissions: []},
  "demo@adsflow.local": {
    actor: "demo-operator",
    permissions: allPermissions.filter(
      (p) =>
        !["card.approve", "card.execute", "card.unfreeze.execute"].includes(p),
    ),
  },
  "reviewer@example.com": {
    actor: "demo-reviewer",
    permissions: [
      "card.read",
      "card.approve",
      "card.execute",
      "card.frozen_debit",
      "card.unfreeze.execute",
    ],
  },
  "viewer@example.com": { actor: "demo-viewer", permissions: ["card.read"] },
};
const moneyKinds = ["debit", "transfer_in", "transfer_out"];
const active = ["pending", "processing"];
const text = (v, label, max = 500) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(`${label}不能为空且不超过${max}字`);
  return v.trim();
};
const minor = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{1,13}$/.test(v) ||
    BigInt(v) <= 0n ||
    BigInt(v) > 1000000000000n
  )
    fail("金额必须为正整数最小单位字符串，且不超过演示上限");
  return BigInt(v).toString();
};
function atomic(db, fn) {
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
function audit(db, ns, cid, oid, actor, action, note) {
  db.prepare("INSERT INTO ca_audit VALUES(?,?,?,?,?,?,?,?)").run(
    ns,
    randomUUID(),
    cid,
    oid,
    actor,
    action,
    note,
    now(),
  );
}
export function principal(db, ns, actor) {
  const p = db
    .prepare("SELECT * FROM ca_principals WHERE namespace=? AND actor=?")
    .get(ns, actor);
  if (!p) fail("当前身份没有卡片管理权限", 403);
  return { ...p, permissions: JSON.parse(p.permissions_json) };
}
function authorize(db, ns, actor, permission, card) {
  const p = principal(db, ns, actor);
  if (
    !p.permissions.includes(permission) ||
    (card && p.owner_scope !== "*" && p.owner_scope !== card.owner_id)
  )
    fail("无此操作权限或卡片不在授权范围", 403);
  return p;
}
function cardRow(db, ns, id) {
  const c = db
    .prepare("SELECT * FROM ca_cards WHERE namespace=? AND id=?")
    .get(ns, id);
  if (!c) fail("卡片不存在或尚未建立可信管理映射", 404);
  return c;
}
function opRow(db, ns, id) {
  const r = db
    .prepare("SELECT * FROM ca_operations WHERE namespace=? AND id=?")
    .get(ns, id);
  if (!r) fail("操作单不存在", 404);
  return r;
}
export function journal(db, ns, id, operation, kind, source, target, amount) {
  if (source === target) fail("来源与目标不能相同");
  const a = db
    .prepare("SELECT * FROM ca_accounts WHERE namespace=? AND id IN(?,?)")
    .all(ns, source, target);
  if (a.length !== 2 || a[0].currency !== a[1].currency)
    fail("账本账户或币种不一致");
  db.prepare("INSERT INTO ca_journals VALUES(?,?,?,?,?)").run(
    ns,
    id,
    operation,
    kind,
    now(),
  );
  const put = db.prepare("INSERT INTO ca_entries VALUES(?,?,?,?)");
  put.run(ns, id, source, (-BigInt(amount)).toString());
  put.run(ns, id, target, BigInt(amount).toString());
}
export function balance(db, ns, id) {
  const a = db
    .prepare("SELECT * FROM ca_accounts WHERE namespace=? AND id=?")
    .get(ns, id);
  if (!a) fail("没有账本映射", 409);
  let posted = 0n,
    held = 0n;
  for (const e of db
    .prepare(
      "SELECT amount_minor FROM ca_entries WHERE namespace=? AND account_id=?",
    )
    .all(ns, id))
    posted += BigInt(e.amount_minor);
  for (const e of db
    .prepare(
      "SELECT amount_minor FROM ca_holds WHERE namespace=? AND account_id=?",
    )
    .all(ns, id))
    held += BigInt(e.amount_minor);
  return {
    ...a,
    postedMinor: posted.toString(),
    heldMinor: held.toString(),
    availableMinor: (posted - held).toString(),
  };
}
export function seedCardAdmin(db, ns) {
  for (const { actor, permissions } of Object.values(demoIdentities))
    db.prepare("INSERT OR IGNORE INTO ca_principals VALUES(?,?,?,?)").run(
      ns,
      actor,
      JSON.stringify(permissions),
      "*",
    );
  // Existing synthetic Portal cards: status management only; never convert their budgets to ledger money.
  const portal = db
    .prepare("SELECT state_json FROM portal_state WHERE namespace=?")
    .get(ns);
  if (portal)
    for (const c of JSON.parse(portal.state_json).cards) {
      if (c.id.startsWith("CARDOPS-")) continue;
      db.prepare(
        "INSERT OR IGNORE INTO ca_cards(namespace,id,owner_id,name,last4,provider_status,self_frozen,risk_frozen,reason,actor,operated_at,provider_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        ns,
        c.id,
        "portal-demo-owner",
        c.name,
        c.last4 || null,
        c.slash?.source.status || (c.frozen ? "paused" : "active"),
        c.frozen && !c.riskFrozen ? 1 : 0,
        c.riskFrozen ? 1 : 0,
        c.riskFrozen ? "原演示风控限制（未提供历史操作人）" : null,
        null,
        null,
        c.slash ? "unverified" : "test-success",
      );
      if(!c.slash)db.prepare("UPDATE ca_cards SET provider_mode='test-success',provider_status=CASE WHEN risk_frozen=1 OR self_frozen=1 THEN 'paused' ELSE 'active' END WHERE namespace=? AND id=? AND provider_mode='unverified'").run(ns,c.id);
      else {
        const source=db.prepare("SELECT status FROM source_records WHERE namespace=? AND kind='card' AND source_id=? LIMIT 2").all(ns,c.id);
        if(source.length===1)db.prepare("UPDATE ca_cards SET provider_status=? WHERE namespace=? AND id=? AND provider_mode='unverified'").run(source[0].status||'unknown',ns,c.id);
      }
    }
  if (
    db
      .prepare("SELECT 1 FROM ca_cards WHERE namespace=? AND id='CARDOPS-001'")
      .get(ns)
  )
    return;
  atomic(db, () => {
    const ins = db.prepare("INSERT INTO ca_accounts VALUES(?,?,?,?,?,?)");
    ins.run(ns, "CARDOPS-EQUITY", "platform", null, "USD", "opening_equity");
    ins.run(
      ns,
      "CARDOPS-RECEIVABLE",
      "platform",
      null,
      "USD",
      "receivable_collection",
    );
    ins.run(
      ns,
      "CARDOPS-WALLET",
      "cardops-owner",
      null,
      "USD",
      "customer_funds",
    );
    ins.run(
      ns,
      "CARDOPS-OTHER-WALLET",
      "other-owner",
      null,
      "USD",
      "customer_funds",
    );
    journal(
      db,
      ns,
      "CARDOPS-OPEN-WALLET",
      null,
      "opening",
      "CARDOPS-EQUITY",
      "CARDOPS-WALLET",
      "100000",
    );
    for (const [id, mode, label] of [
      ["001", "test-success", "正常执行"],
      ["002", "test-failure", "渠道失败"],
      ["003", "test-pending", "渠道处理中"],
    ]) {
      const cid = `CARDOPS-${id}`;
      db.prepare(
        "INSERT INTO ca_cards(namespace,id,owner_id,name,last4,provider_status,provider_mode) VALUES(?,?,?,?,?,?,?)",
      ).run(
        ns,
        cid,
        "cardops-owner",
        `隔离管理测试 · ${label}`,
        `7${id}`,
        "active",
        mode,
      );
      ins.run(ns, `${cid}-FUNDS`, "cardops-owner", cid, "USD", "card_funds");
      journal(
        db,
        ns,
        `${cid}-OPEN`,
        null,
        "opening",
        "CARDOPS-EQUITY",
        `${cid}-FUNDS`,
        "50000",
      );
    }
    audit(
      db,
      ns,
      null,
      null,
      "system",
      "seed",
      "独立测试账本初始化；期初分录，不导入旧卡预算",
    );
  });
}
function capability(db, ns, c, actor, kind) {
  const permissions = {
    freeze: "card.freeze",
    unfreeze: "card.unfreeze.request",
    debit: "card.debit",
    transfer_in: "card.transfer_in",
    transfer_out: "card.transfer_out",
  };
  authorize(db, ns, actor, permissions[kind] || "invalid", c);
  if (!["active", "paused"].includes(c.provider_status))
    fail("卡片非可操作状态，不能激活关闭/未知卡片", 409);
  if (c.provider_mode === "unverified")
    fail(
      "未验证渠道执行能力，仅可查看；不能把来源状态或卡预算作为操作依据",
      409,
    );
  if (kind === "freeze") {
    if (c.risk_frozen) fail("已存在风控限制", 409);
    return;
  }
  if (
    db
      .prepare(
        "SELECT 1 FROM ca_operations WHERE namespace=? AND card_id=? AND execution_status='processing'",
      )
      .get(ns, c.id)
  )
    fail("卡片有处理中操作，等待明确执行结果", 409);
  if (kind === "unfreeze") {
    if (!c.risk_frozen) fail("没有可解除的风控冻结", 409);
    return;
  }
  if (c.risk_frozen && kind === "debit") authorize(db,ns,actor,"card.frozen_debit",c);
  if (c.risk_frozen && kind !== "debit")
    fail("风控冻结期间禁止资金转入或转出", 409);
  if (c.self_frozen && kind !== "debit")
    fail("自助冻结期间禁止资金转入或转出", 409);
  if (
    !db
      .prepare("SELECT 1 FROM ca_accounts WHERE namespace=? AND card_id=?")
      .get(ns, c.id)
  )
    fail("未建立可执行资金账本，预算/限额不可扣款", 409);
}
function quote(db, ns, c, actor, b) {
  capability(db, ns, c, actor, b.kind);
  if (!moneyKinds.includes(b.kind))
    return {
      amountMinor: null,
      currency: null,
      sourceAccount: null,
      targetAccount: null,
      feeMinor: "0",
      policyVersion: "cardops-v1",
    };
  const amount = minor(b.amountMinor);
  if (b.currency !== "USD") fail("当前资金账户仅支持USD，不能跨币种划拨");
  const ca = db
    .prepare("SELECT * FROM ca_accounts WHERE namespace=? AND card_id=?")
    .get(ns, c.id);
  let source, target;
  if (b.kind === "debit") {
    source = ca.id;
    target = "CARDOPS-RECEIVABLE";
  } else {
    const other = db
      .prepare(
        "SELECT * FROM ca_accounts WHERE namespace=? AND id=? AND kind='customer_funds'",
      )
      .get(ns, b.counterpartyAccount);
    if (
      !other ||
      other.owner_id !== c.owner_id ||
      other.currency !== ca.currency
    )
      fail("资金账户不属于同一客户或币种不一致", 403);
    source = b.kind === "transfer_in" ? other.id : ca.id;
    target = b.kind === "transfer_in" ? ca.id : other.id;
  }
  const src = balance(db, ns, source),
    dst = balance(db, ns, target);
  if (BigInt(src.availableMinor) < BigInt(amount))
    fail("可用余额不足（已扣除处理中预占）", 409);
  if (BigInt(dst.postedMinor) + BigInt(amount) > 1000000000000n)
    fail("目标余额超过本地上限", 409);
  return {
    amountMinor: amount,
    currency: "USD",
    sourceAccount: source,
    targetAccount: target,
    feeMinor: "0",
    policyVersion: "cardops-v1",
    sourceAvailableMinor: src.availableMinor,
    sourceAfterMinor: (BigInt(src.availableMinor) - BigInt(amount)).toString(),
    targetAfterMinor: (BigInt(dst.postedMinor) + BigInt(amount)).toString(),
  };
}
export function previewCardOperation(db, ns, actor, id, b) {
  const c = cardRow(db, ns, id);
  return { ...quote(db, ns, c, actor, b), cardRevision: c.revision };
}
function beginExecution(db, ns, o, actor) {
  const c = cardRow(db, ns, o.card_id);
  if (o.kind !== "freeze" && c.revision !== o.card_revision)
    fail("卡片状态已变化，请重新发起申请", 409);
  if (o.kind === 'unfreeze') {
    if (!c.risk_frozen || !['active','paused'].includes(c.provider_status)) fail('当前状态不允许解除风控',409);
    if (db.prepare("SELECT 1 FROM ca_operations WHERE namespace=? AND card_id=? AND id<>? AND execution_status='processing'").get(ns,c.id,o.id)) fail('另有上游结果待确认，暂不能执行解冻',409);
  }
  if (moneyKinds.includes(o.kind)) {
    if(c.risk_frozen && o.kind==='debit'){authorize(db,ns,actor,'card.frozen_debit',c);authorize(db,ns,o.requester,'card.frozen_debit',c);}
    // Revalidate actor-independent constraints and ownership at execution, not only at request.
    if (
      !["active", "paused"].includes(c.provider_status) ||
      ((c.risk_frozen || c.self_frozen) && o.kind !== "debit")
    )
      fail("当前卡片状态禁止执行", 409);
    const src = balance(db, ns, o.source_account),
      dst = balance(db, ns, o.target_account);
    if (
      src.currency !== o.currency ||
      dst.currency !== o.currency ||
      src.owner_id !== c.owner_id ||
      (o.kind !== "debit" && dst.owner_id !== c.owner_id)
    )
      fail("账本账户归属或币种发生变化", 409);
    if (BigInt(src.availableMinor) < BigInt(o.amount_minor))
      fail("执行时可用余额不足", 409);
    if (BigInt(dst.postedMinor) + BigInt(o.amount_minor) > 1000000000000n)
      fail("目标余额超过上限", 409);
    db.prepare("INSERT INTO ca_holds VALUES(?,?,?,?)").run(
      ns,
      o.id,
      o.source_account,
      o.amount_minor,
    );
  }
  db.prepare(
    "UPDATE ca_operations SET execution_status='processing',executor=?,updated_at=? WHERE namespace=? AND id=?",
  ).run(actor, now(), ns, o.id);
  db.prepare(
    "INSERT INTO ca_jobs(namespace,operation_id,status) VALUES(?,?,'queued')",
  ).run(ns, o.id);
  audit(
    db,
    ns,
    c.id,
    o.id,
    actor,
    "execution_started",
    "任务已持久化；等待隔离执行驱动确认",
  );
}
export function requestCardOperation(db, ns, actor, id, b) {
  const c = cardRow(db, ns, id);
  authorize(db, ns, actor, "card.read", c);
  const allowed = [
    "requestId",
    "kind",
    "reason",
    "evidence",
    "amountMinor",
    "currency",
    "counterpartyAccount",
    "cardRevision",
    "confirmed",
    "customerReason",
    "internalNote",
  ];
  if (Object.keys(b).some((k) => !allowed.includes(k)))
    fail("请求包含未允许字段");
  text(b.requestId, "幂等键", 100);
  text(b.reason, "操作原因");
  const hash = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(b).sort(([a], [z]) => a.localeCompare(z)),
        ),
      ),
    )
    .digest("hex");
  return atomic(db, () => {
    const replay = db
      .prepare(
        "SELECT * FROM ca_operations WHERE namespace=? AND requester=? AND request_id=?",
      )
      .get(ns, actor, b.requestId);
    if (replay) {
      if (replay.request_hash !== hash || replay.card_id !== id)
        fail("幂等键不能复用于不同操作", 409);
      return replay;
    }
    const card = cardRow(db, ns, id),
      q = quote(db, ns, card, actor, b);
    if (b.cardRevision !== card.revision)
      fail("卡片已更新，请刷新后重新确认", 409);
    if (moneyKinds.includes(b.kind)) {
      text(b.evidence, "业务凭证编号");
      if (b.confirmed !== true) fail("请完成金额、去向和用途的二次确认");
    }
    const oid = `CA-${randomUUID()}`,
      t = now();
    db.prepare(
      "INSERT INTO ca_operations(namespace,id,card_id,kind,request_id,request_hash,requester,reason,evidence,amount_minor,currency,source_account,target_account,approval_status,execution_status,created_at,updated_at,card_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      ns,
      oid,
      id,
      b.kind,
      b.requestId,
      hash,
      actor,
      b.reason,
      b.evidence || null,
      q.amountMinor,
      q.currency,
      q.sourceAccount,
      q.targetAccount,
      b.kind === "freeze" ? "not_required" : "pending",
      "pending",
      t,
      t,
      card.revision,
    );
    audit(db, ns, id, oid, actor, "requested", b.reason);
    if (b.kind === "freeze") {
      const customerReason = text(b.customerReason || '卡片因风控审核暂停使用，请提交解冻申请。', '客户可见说明');
      if (b.internalNote != null && b.internalNote !== '') text(b.internalNote, '内部备注');
      db.prepare('INSERT INTO ca_freeze_notes VALUES(?,?,?,?)').run(ns, oid, customerReason, b.internalNote || null);
      db.prepare(
        "UPDATE ca_cards SET risk_frozen=1,reason=?,actor=?,operated_at=?,revision=revision+1 WHERE namespace=? AND id=?",
      ).run(b.reason, actor, t, ns, id);
      beginExecution(db, ns, opRow(db, ns, oid), actor);
    }
    return opRow(db, ns, oid);
  });
}
export function reviewCardOperation(db, ns, actor, id, b) {
  const o = opRow(db, ns, id),
    c = cardRow(db, ns, o.card_id);
  authorize(db, ns, actor, "card.approve", c);
  if (o.requester === actor) fail("发起人不得审批自己的申请", 403);
  if (!["approve", "reject", "return"].includes(b.decision)) fail("审批决定无效");
  text(b.note, "审批意见");
  if (b.decision === 'return' && !db.prepare('SELECT 1 FROM ca_unfreeze_requests WHERE namespace=? AND operation_id=?').get(ns,id)) fail('仅客户解冻申请支持退回补充',409);
  const approval = b.decision === 'approve' ? 'approved' : b.decision === 'return' ? 'returned' : 'rejected';
  if (b.decision === "approve") {
    authorize(db, ns, actor, "card.execute", c);
    if (o.kind === "unfreeze")
      authorize(db, ns, actor, "card.unfreeze.execute", c);
  }
  return atomic(db, () => {
    const current = opRow(db, ns, id);
    if (current.approval_status !== "pending") {
      if (
        current.reviewer === actor &&
        current.review_note === b.note &&
        current.approval_status ===
          approval
      )
        return current;
      fail("申请已审批，不能重复或覆盖审批", 409);
    }
    const t = now();
    db.prepare(
      "UPDATE ca_operations SET approval_status=?,execution_status=?,reviewer=?,review_note=?,reviewed_at=?,updated_at=? WHERE namespace=? AND id=?",
    ).run(
      approval,
      b.decision === "approve" ? "pending" : "not_executed",
      actor,
      b.note,
      t,
      t,
      ns,
      id,
    );
    audit(db, ns, c.id, id, actor, b.decision, b.note);
    if (b.decision === "approve")
      try {
        db.exec('SAVEPOINT card_execution');
        beginExecution(db, ns, opRow(db, ns, id), actor);
        db.exec('RELEASE card_execution');
      } catch (e) {
        db.exec('ROLLBACK TO card_execution; RELEASE card_execution');
        db.prepare(
          "UPDATE ca_operations SET execution_status='failed',error=?,updated_at=? WHERE namespace=? AND id=?",
        ).run(e.message, t, ns, id);
        audit(db, ns, c.id, id, actor, "execution_failed", e.message);
      }
    return opRow(db, ns, id);
  });
}
// An explicit local test driver, not a Slash transport or an endpoint that accepts success from the browser.
// A production transport must supply authenticated provider confirmation and stable request identity.
export function processCardJob(db, ns, id) {
  return atomic(db, () => {
    const o = opRow(db, ns, id),
      c = cardRow(db, ns, o.card_id),
      job = db
        .prepare("SELECT * FROM ca_jobs WHERE namespace=? AND operation_id=?")
        .get(ns, id);
    if (!job || o.execution_status !== "processing") return o;
    if (job.status === "done") return o;
    db.prepare(
      "UPDATE ca_jobs SET attempts=attempts+1 WHERE namespace=? AND operation_id=?",
    ).run(ns, id);
    if (c.provider_mode === "test-pending") {
      db.prepare(
        "UPDATE ca_jobs SET status='unknown',result='测试驱动未返回最终结果' WHERE namespace=? AND operation_id=?",
      ).run(ns, id);
      if (job.status !== "unknown")
        audit(
          db,
          ns,
          c.id,
          id,
          "test-provider",
          "provider_pending",
          "结果未知；保留预占，禁止自动重发或当作成功",
        );
      return o;
    }
    const stateChanged =
      job.status === "queued" &&
      ["transfer_in", "transfer_out", "unfreeze"].includes(o.kind) &&
      c.revision !== o.card_revision;
    const failed = c.provider_mode !== "test-success" || stateChanged;
    if (!failed) {
      if (moneyKinds.includes(o.kind))
        journal(
          db,
          ns,
          `J-${id}`,
          id,
          o.kind,
          o.source_account,
          o.target_account,
          o.amount_minor,
        );
      else if (o.kind === "freeze")
        db.prepare(
          "UPDATE ca_cards SET provider_status='paused' WHERE namespace=? AND id=?",
        ).run(ns, c.id);
      else if (o.kind === "unfreeze") {
        // A newer freeze must never be removed by a stale unfreeze result.
        if (c.revision !== o.card_revision)
          fail("解冻确认对应旧状态，需调查", 409);
        db.prepare(
          "UPDATE ca_cards SET risk_frozen=0,provider_status=?,reason=?,actor=?,operated_at=?,revision=revision+1 WHERE namespace=? AND id=?",
        ).run(
          c.self_frozen ? "paused" : "active",
          o.reason,
          o.executor,
          now(),
          ns,
          c.id,
        );
      } else if (o.kind === "self_freeze" || o.kind === "self_unfreeze")
        db.prepare(
          "UPDATE ca_cards SET self_frozen=?,provider_status=?,reason=?,actor=?,operated_at=?,revision=revision+1 WHERE namespace=? AND id=?",
        ).run(
          o.kind === "self_freeze" ? 1 : 0,
          c.risk_frozen || o.kind === "self_freeze" ? "paused" : "active",
          c.risk_frozen ? c.reason : o.reason,
          c.risk_frozen ? c.actor : o.requester,
          c.risk_frozen ? c.operated_at : now(),
          ns,
          c.id,
        );
    }
    db.prepare("DELETE FROM ca_holds WHERE namespace=? AND operation_id=?").run(
      ns,
      id,
    );
    db.prepare(
      "UPDATE ca_operations SET execution_status=?,error=?,updated_at=? WHERE namespace=? AND id=?",
    ).run(
      failed ? "failed" : "succeeded",
      failed
        ? stateChanged
          ? "执行前卡片状态已变化；未产生资金分录"
          : "隔离测试渠道拒绝执行；未产生资金分录"
        : null,
      now(),
      ns,
      id,
    );
    db.prepare(
      "UPDATE ca_jobs SET status='done',provider_ref=?,result=? WHERE namespace=? AND operation_id=?",
    ).run(`TEST-${id}`, failed ? "rejected" : "confirmed", ns, id);
    audit(
      db,
      ns,
      c.id,
      id,
      "test-provider",
      failed ? "execution_failed" : "execution_succeeded",
      failed
        ? "执行失败；已释放资金预占（如有）"
        : moneyKinds.includes(o.kind)
          ? "测试驱动确认；资金分录原子入账"
          : "测试驱动确认；卡片状态已更新（无资金入账）",
    );
    return opRow(db, ns, id);
  });
}
export function processQueuedCardJobs(db, ns) {
  for (const j of db
    .prepare(
      "SELECT operation_id FROM ca_jobs WHERE namespace=? AND status='queued' LIMIT 50",
    )
    .all(ns)) {
    try {
      processCardJob(db, ns, j.operation_id);
    } catch (e) {
      db.prepare("UPDATE ca_jobs SET status='blocked',result=? WHERE namespace=? AND operation_id=?").run(e.message,ns,j.operation_id);
      db.prepare("UPDATE ca_operations SET error=? WHERE namespace=? AND id=?").run(e.message,ns,j.operation_id);
      audit(
        db,
        ns,
        null,
        j.operation_id,
        "worker",
        "processing_error",
        e.message,
      );
    }
  }
}
function publicOperation(o) {
  const { request_hash, request_id, ...safe } = o;
  return safe;
}
function cardDTO(db, ns, c, actor) {
  const a = db
    .prepare("SELECT id FROM ca_accounts WHERE namespace=? AND card_id=?")
    .get(ns, c.id);
  const actions = {};
  for (const kind of ["freeze", "unfreeze", ...moneyKinds]) {
    try {
      capability(db, ns, c, actor, kind);
      actions[kind] = { allowed: true, reason: null };
    } catch (e) {
      actions[kind] = { allowed: false, reason: e.message };
    }
  }
  return {
    ...c,
    balance: a ? balance(db, ns, a.id) : null,
    owner: db.prepare('SELECT id,name,email FROM mg_users WHERE namespace=? AND id=?').get(ns,c.owner_id) || null,
    latestExecution: db.prepare('SELECT id,kind,execution_status,error,updated_at FROM ca_operations WHERE namespace=? AND card_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(ns,c.id) || null,
    actions,
    status: c.risk_frozen
      ? "risk_frozen"
      : c.self_frozen
        ? "self_frozen"
        : c.provider_status,
    executionMode:
      c.provider_mode === "unverified" ? "未验证渠道能力" : "隔离测试驱动",
    fundingNote: a
      ? "独立测试资金账本；不与原演示钱包合并"
      : "未映射资金账本；卡片预算和限额不可用于扣款",
  };
}
function pageQuery(q) {
  let page = Number(q.page || 0),
    pageSize = Number(q.pageSize || 10);
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    page > 100000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    fail("分页参数无效");
  return { page, pageSize };
}
export function cardAdminRead(db, ns, actor, path, q = {}) {
  const p = authorize(db, ns, actor, "card.read");
  if (path === "identity")
    return {
      actor,
      permissions: p.permissions,
      mode: "local-test",
      identities: Object.keys(demoIdentities),
    };
  if (path === "cards" || path === "operations") {
    const pagination = pageQuery(q),
      args = [ns],
      where = ["c.namespace=?"];
    if (p.owner_scope !== "*") {
      where.push("c.owner_id=?");
      args.push(p.owner_scope);
    }
    const ops = path === "operations";
    if (q.cardId) {
      where.push("c.id=?");
      args.push(q.cardId);
    }
    if (q.keyword) {
      where.push(
        ops
          ? "(o.id LIKE ? OR c.name LIKE ?)"
          : "(c.id LIKE ? OR c.name LIKE ? OR c.last4 LIKE ?)",
      );
      args.push(...Array(ops ? 2 : 3).fill(`%${q.keyword}%`));
    }
    if (q.status) {
      where.push(
        ops
          ? "o.approval_status=?"
          : q.status === "risk_frozen"
            ? "c.risk_frozen=1"
            : "c.provider_status=?",
      );
      if (ops || q.status !== "risk_frozen") args.push(q.status);
    }
    if (ops && q.kindGroup==='funds') where.push("o.kind IN ('debit','transfer_in','transfer_out')");
    if (ops && q.kindGroup==='risk') where.push("o.kind IN ('freeze','unfreeze','self_freeze','self_unfreeze')");
    const from = ops
      ? "ca_operations o JOIN ca_cards c ON c.namespace=o.namespace AND c.id=o.card_id"
      : "ca_cards c";
    const sql = `FROM ${from} WHERE ${where.join(" AND ")}`;
    const total = db.prepare(`SELECT count(*) n ${sql}`).get(...args).n;
    const rows = db
      .prepare(
        `SELECT ${ops ? "o.*" : "c.*"} ${sql} ORDER BY ${ops ? "o.created_at DESC,o.id" : "c.id"} LIMIT ? OFFSET ?`,
      )
      .all(...args, pagination.pageSize, pagination.page * pagination.pageSize);
    return {
      ...pagination,
      total,
      rows: rows.map((r) =>
        ops ? publicOperation(r) : cardDTO(db, ns, r, actor),
      ),
    };
  }
  const [resource, id] = path.split("/");
  if (resource === "cards" && id) {
    const c = cardRow(db, ns, id);
    authorize(db, ns, actor, "card.read", c);
    const pg = pageQuery(q);
    const auditRows = db
      .prepare(
        "SELECT * FROM ca_audit WHERE namespace=? AND card_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?",
      )
      .all(ns, id, pg.pageSize, pg.page * pg.pageSize);
    const ledger = db
      .prepare(
        "SELECT j.id,j.operation_id,j.kind,j.created_at,e.amount_minor,e.account_id FROM ca_entries e JOIN ca_journals j ON j.namespace=e.namespace AND j.id=e.journal_id JOIN ca_accounts a ON a.namespace=e.namespace AND a.id=e.account_id WHERE e.namespace=? AND a.card_id=? ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?",
      )
      .all(ns, id, pg.pageSize, pg.page * pg.pageSize);
    return {
      card: cardDTO(db, ns, c, actor),
      accounts: db
        .prepare(
          "SELECT id,currency,kind FROM ca_accounts WHERE namespace=? AND owner_id=? AND kind='customer_funds'",
        )
        .all(ns, c.owner_id)
        .map((a) => balance(db, ns, a.id)),
      operations: cardAdminRead(db, ns, actor, "operations", {
        cardId: id,
        kindGroup: q.tab,
        ...pg,
      }),
      unfreezeRequests: db.prepare('SELECT r.freeze_revision,o.id,o.reason,o.evidence,o.approval_status,o.execution_status,o.review_note,o.created_at,o.error FROM ca_unfreeze_requests r JOIN ca_operations o ON o.namespace=r.namespace AND o.id=r.operation_id WHERE r.namespace=? AND r.card_id=? ORDER BY o.created_at DESC,o.rowid DESC LIMIT ? OFFSET ?').all(ns,id,pg.pageSize,pg.page*pg.pageSize),
      audit: auditRows,
      ledger,
      page: pg.page,
      pageSize: pg.pageSize,
    };
  }
  if (resource === "operations" && id) {
    const o = opRow(db, ns, id);
    authorize(db, ns, actor, "card.read", cardRow(db, ns, o.card_id));
    return {
      operation: publicOperation(o),
      customerRequest: db.prepare('SELECT freeze_revision FROM ca_unfreeze_requests WHERE namespace=? AND operation_id=?').get(ns,id) || null,
      freezeNotes: db.prepare('SELECT customer_reason,internal_note FROM ca_freeze_notes WHERE namespace=? AND operation_id=?').get(ns,id) || null,
      audit: db
        .prepare(
          "SELECT * FROM ca_audit WHERE namespace=? AND operation_id=? ORDER BY created_at,rowid",
        )
        .all(ns, id),
      job:
        db
          .prepare(
            "SELECT status,provider_ref,result,attempts FROM ca_jobs WHERE namespace=? AND operation_id=?",
          )
          .get(ns, id) || null,
      entries: db
        .prepare(
          "SELECT e.account_id,e.amount_minor,a.currency FROM ca_entries e JOIN ca_accounts a ON a.namespace=e.namespace AND a.id=e.account_id JOIN ca_journals j ON j.namespace=e.namespace AND j.id=e.journal_id WHERE j.namespace=? AND j.operation_id=?",
        )
        .all(ns, id),
    };
  }
  fail("接口不存在", 404);
}
function writeOperation(db, ns, actor, path, b) {
  const [resource, id, action] = path.split("/");
  if (resource === "cards" && action === "preview")
    return previewCardOperation(db, ns, actor, id, b);
  if (resource === "cards" && action === "operations")
    return publicOperation(requestCardOperation(db, ns, actor, id, b));
  if (resource === "operations" && action === "review")
    return publicOperation(reviewCardOperation(db, ns, actor, id, b));
  if (resource === "operations" && action === "refresh") {
    const o = opRow(db, ns, id),
      c = cardRow(db, ns, o.card_id);
    authorize(db, ns, actor, "card.execute", c);
    return publicOperation(processCardJob(db, ns, id));
  }
  fail("接口不存在", 404);
}
// Caller is the fixed, server-owned local Portal scope. Never accepts an owner from HTTP.
export function clientUnfreezeRequest(db, ns, cardId, requestId, b) {
  const c = cardRow(db,ns,cardId);
  if (!['cardops-owner','portal-demo-owner'].includes(c.owner_id)) fail('卡片不属于当前客户',403);
  if (!c.risk_frozen) fail('没有可申请解除的风控冻结',409);
  if (c.provider_mode === 'unverified') fail('渠道解冻流程尚未接入',409);
  if (b.freezeRevision !== c.revision) fail('冻结记录已变化，请刷新后重新申请',409);
  const reason=text(b.reason,'申请原因'), evidence=b.evidence ? text(b.evidence,'补充材料编号') : null;
  const existing=db.prepare("SELECT o.* FROM ca_operations o JOIN ca_unfreeze_requests r ON r.namespace=o.namespace AND r.operation_id=o.id WHERE r.namespace=? AND r.card_id=? AND r.freeze_revision=? AND (o.approval_status IN ('pending','returned') OR o.execution_status='processing') ORDER BY o.created_at DESC LIMIT 1").get(ns,cardId,c.revision);
  if(existing && existing.approval_status !== 'returned') fail('本次冻结已有待处理申请',409);
  const actor=`client:${c.owner_id}`,t=now(),id=existing?.id || `CA-${randomUUID()}`;
  if(existing){
    db.prepare("UPDATE ca_operations SET reason=?,evidence=?,approval_status='pending',execution_status='pending',reviewer=NULL,review_note=NULL,reviewed_at=NULL,updated_at=? WHERE namespace=? AND id=?").run(reason,evidence,t,ns,id);
  }else{
    db.prepare("INSERT INTO ca_operations(namespace,id,card_id,kind,request_id,request_hash,requester,reason,evidence,approval_status,execution_status,created_at,updated_at,card_revision) VALUES(?,?,?,'unfreeze',?,?,?,?,?,'pending','pending',?,?,?)").run(ns,id,cardId,requestId,createHash('sha256').update(JSON.stringify(b)).digest('hex'),actor,reason,evidence,t,t,c.revision);
    db.prepare('INSERT INTO ca_unfreeze_requests VALUES(?,?,?,?,?,?)').run(ns,id,cardId,c.owner_id,c.revision,t);
  }
  audit(db,ns,cardId,id,actor,existing?'customer_resubmitted':'customer_requested',reason);
  return id;
}
// Public local Portal has one fixed demo customer; request bodies cannot select an owner/actor.
export function clientCardFreeze(db, ns, cardId, requestId) {
  const c = cardRow(db, ns, cardId);
  if (!["cardops-owner", "portal-demo-owner"].includes(c.owner_id))
    fail("卡片不属于当前演示客户", 403);
  if (c.risk_frozen) fail("风控冻结只能由后台审核解除", 403);
  if (c.provider_mode === "unverified")
    fail("渠道状态操作尚未验证，不能在本地覆盖上游状态", 409);
  if (!["active", "paused"].includes(c.provider_status))
    fail("卡片状态禁止冻结或解冻", 409);
  if (
    db
      .prepare(
        "SELECT 1 FROM ca_operations WHERE namespace=? AND card_id=? AND execution_status='processing'",
      )
      .get(ns, cardId)
  )
    fail("卡片操作处理中", 409);
  const id = `CA-${randomUUID()}`,
    t = now(),
    kind = c.self_frozen ? "self_unfreeze" : "self_freeze";
  db.prepare(
    "INSERT INTO ca_operations(namespace,id,card_id,kind,request_id,request_hash,requester,reason,approval_status,execution_status,created_at,updated_at,card_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    ns,
    id,
    cardId,
    kind,
    requestId,
    kind,
    "portal-demo-customer",
    "客户端自助操作",
    "not_required",
    "pending",
    t,
    t,
    c.revision,
  );
  beginExecution(db, ns, opRow(db, ns, id), "portal-demo-customer");
  audit(db, ns, cardId, id, "portal-demo-customer", "requested", kind);
  return id;
}
export function overlayCardAdmin(db, ns, state) {
  for (const c of db
    .prepare("SELECT * FROM ca_cards WHERE namespace=?")
    .all(ns)) {
    let card = state.cards.find((x) => x.id === c.id);
    if (!card && c.id.startsWith("CARDOPS-")) {
      card = {
        id: c.id,
        name: c.name,
        last4: c.last4,
        balance: 0,
        frozen: false,
        platform: "内部测试账本",
        createdAt: "2026-09-07T00:00:00Z",
      };
      state.cards.push(card);
    }
    if (!card) continue;
    const funds = db
      .prepare("SELECT id FROM ca_accounts WHERE namespace=? AND card_id=?")
      .get(ns, c.id);
    if (c.provider_mode === "unverified" && card.slash)
      c.provider_status = card.slash.source.status;
    card.unfreezeRequest = db.prepare('SELECT o.id,o.reason,o.evidence,o.approval_status,o.execution_status,o.review_note,o.updated_at,r.freeze_revision FROM ca_unfreeze_requests r JOIN ca_operations o ON o.namespace=r.namespace AND o.id=r.operation_id WHERE r.namespace=? AND r.card_id=? ORDER BY o.updated_at DESC,o.rowid DESC LIMIT 1').get(ns,c.id) || null;
    card.riskFrozen = Boolean(c.risk_frozen);
    card.frozen = Boolean(
      c.risk_frozen || c.self_frozen || c.provider_status !== "active",
    );
    card.management = {
      reason: c.risk_frozen ? (db.prepare("SELECT n.customer_reason FROM ca_freeze_notes n JOIN ca_operations o ON o.namespace=n.namespace AND o.id=n.operation_id WHERE o.namespace=? AND o.card_id=? ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1").get(ns,c.id)?.customer_reason || '卡片因风控审核暂停使用，请提交解冻申请。') : null,
      actor: c.actor,
      operatedAt: c.operated_at,
      providerStatus: c.provider_status,
      revision: c.revision,
      funding: !!funds,
    };
    if (funds) {
      card.balance = Number(balance(db, ns, funds.id).availableMinor);
      card.balanceKind = "managed_ledger";
    }
  }
  state.entries = state.entries.filter((e) => !e.id.startsWith("CA-"));
  for (const o of db
    .prepare(
      "SELECT o.* FROM ca_operations o JOIN ca_cards c ON c.namespace=o.namespace AND c.id=o.card_id WHERE o.namespace=? AND c.owner_id IN ('cardops-owner','portal-demo-owner') ORDER BY o.created_at DESC",
    )
    .all(ns)) {
    const labels = {
      debit: "后台扣款",
      transfer_in: "资金转入",
      transfer_out: "资金转出",
      freeze: "风控冻结",
      unfreeze: "风控解冻",
      self_freeze: "自助冻结",
      self_unfreeze: "自助解冻",
    };
    state.entries.push({
      id: o.id,
      card: o.card_id,
      kind: labels[o.kind],
      name: o.kind==='freeze' ? (db.prepare('SELECT customer_reason FROM ca_freeze_notes WHERE namespace=? AND operation_id=?').get(ns,o.id)?.customer_reason || '卡片因风控审核暂停使用') : o.reason,
      ledgerOperationId: moneyKinds.includes(o.kind) ? o.id : undefined,
      nonFinancial: !moneyKinds.includes(o.kind),
      amount: moneyKinds.includes(o.kind)
        ? Number(o.amount_minor) * (o.kind === "transfer_in" ? 1 : -1)
        : 0,
      currency: "USD",
      time: o.created_at,
      status:
        o.execution_status === "succeeded"
          ? "已完成"
          : ["failed", "not_executed"].includes(o.execution_status)
            ? "失败"
            : "处理中",
      statusText: `${{ pending: "待审批", approved: "审批通过", rejected: "审批拒绝", not_required: "免审批" }[o.approval_status] || o.approval_status} / ${{ pending: "待执行", processing: "执行中", succeeded: "执行成功", failed: "执行失败", not_executed: "未执行" }[o.execution_status] || o.execution_status}`,
    });
  }
}

export function cardAdminWrite(db, ns, actor, path, b) {
  try {
    return writeOperation(db, ns, actor, path, b);
  } catch (e) {
    const [resource, id] = path.split("/");
    const oid = resource === "operations" ? id : null;
    const cid =
      resource === "cards"
        ? id
        : db
            .prepare(
              "SELECT card_id FROM ca_operations WHERE namespace=? AND id=?",
            )
            .get(ns, id || "")?.card_id || null;
    audit(db, ns, cid, oid, actor, "request_rejected", e.message);
    throw e;
  }
}

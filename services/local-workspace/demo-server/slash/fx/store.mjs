import { NS, normalize, rowDTO, AS_OF, integer, categories } from "./model.mjs";
const fail = (m) => {
  throw new Error(m);
};
function own(db, ns, id) {
  const r = db
    .prepare("SELECT * FROM fx_records WHERE namespace=? AND id=?")
    .get(ns, id);
  if (!r) fail("交易不存在");
  return r;
}
function utc(v) {
  if (v == null) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail("来源时间无效");
  return new Date(v).toISOString();
}
export function register(db, ns, id, source, internal) {
  if (!categories.includes(internal.category))
    fail("Unknown internal category");
  const prior = db
    .prepare("SELECT * FROM fx_records WHERE namespace=? AND id=?")
    .get(ns, id);
  if (prior) {
    if (
      prior.source_id !== String(source.id) ||
      prior.connection_id !== internal.connectionId ||
      prior.entity_id !== internal.entityId ||
      prior.platform !== (internal.platform || "slash")
    )
      fail("来源身份冲突");
    return;
  }
  const n = normalize(source, internal);
  db.prepare(
    `INSERT INTO fx_records(namespace,id,connection_id,entity_id,source_id,platform,scenario,source_json,internal_json,account_id,card_id,account_currency,account_scale,amount_minor,original_currency,original_scale,original_minor,provider_rate,status,detailed_status,category,balance_type,source_date,authorized_at,posted_at,collected_at) VALUES(${Array(26).fill("?").join(",")})`,
  ).run(
    ns,
    id,
    internal.connectionId,
    internal.entityId,
    String(source.id),
    internal.platform || "slash",
    internal.scenario,
    JSON.stringify(n.source),
    JSON.stringify(internal),
    source.accountId ?? null,
    source.cardId ?? null,
    n.currency,
    n.scale,
    n.source.amountCents ?? null,
    n.originalCurrency,
    n.originalScale,
    n.original,
    n.source.originalCurrency?.conversionRate ?? null,
    source.status ?? null,
    source.detailedStatus ?? null,
    internal.category,
    internal.balanceType || "debit",
    utc(source.date),
    utc(source.authorizedAt),
    utc(n.postedAt),
    AS_OF,
  );
}
export function beginRead(db, ns, id) {
  db.prepare(
    "UPDATE fx_records SET request_seq=request_seq+1 WHERE namespace=? AND id=?",
  ).run(ns, id);
  return own(db, ns, id).request_seq;
}
export function applyRead(db, ns, id, seq, source, collectedAt = AS_OF) {
  db.exec("SAVEPOINT fx_read");
  try {
    const r = own(db, ns, id),
      i = JSON.parse(r.internal_json),
      n = normalize(source, i);
    if (
      source.id !== r.source_id ||
      (source.accountId ?? null) !== r.account_id ||
      (source.cardId ?? null) !== r.card_id ||
      !Number.isSafeInteger(seq) ||
      seq < 1 ||
      seq > r.request_seq
    )
      fail("采集身份或请求序号无效");
    const prior = db
      .prepare(
        "SELECT source_json FROM fx_observations WHERE namespace=? AND record_id=? AND request_seq=?",
      )
      .get(ns, id, seq);
    if (prior) {
      if (prior.source_json !== JSON.stringify(n.source))
        fail("同一采集请求返回冲突内容");
      db.exec("RELEASE fx_read");
      return "duplicate_response";
    }
    const stale =
      seq < r.request_seq ||
      (r.status === "posted" && source.status !== "posted");
    db.prepare("INSERT INTO fx_observations VALUES(?,?,?,?,?,?)").run(
      ns,
      id,
      seq,
      JSON.stringify(n.source),
      collectedAt,
      stale ? "superseded_request" : "applied",
    );
    if (stale)
      db.prepare(
        "UPDATE fx_records SET sync_state='resync_required' WHERE namespace=? AND id=?",
      ).run(ns, id);
    else
      db.prepare(
        `UPDATE fx_records SET source_json=?,amount_minor=?,original_currency=?,original_scale=?,original_minor=?,provider_rate=?,status=?,detailed_status=?,source_date=?,authorized_at=?,posted_at=?,collected_at=?,applied_seq=?,sync_state='current' WHERE namespace=? AND id=?`,
      ).run(
        JSON.stringify(n.source),
        n.source.amountCents ?? null,
        n.originalCurrency,
        n.originalScale,
        n.original,
        n.source.originalCurrency?.conversionRate ?? null,
        source.status ?? null,
        source.detailedStatus ?? null,
        utc(source.date),
        utc(source.authorizedAt),
        utc(n.postedAt),
        collectedAt,
        seq,
        ns,
        id,
      );
    db.exec("RELEASE fx_read");
    return stale ? "superseded_request" : "applied";
  } catch (e) {
    db.exec("ROLLBACK TO fx_read");
    db.exec("RELEASE fx_read");
    throw e;
  }
}
export function receiveEvent(
  db,
  ns,
  connection,
  event,
  delivery,
  receivedAt = AS_OF,
) {
  if (
    ![
      "aggregated_transaction.create",
      "aggregated_transaction.update",
    ].includes(event.event)
  )
    fail("Unsupported fixture notification type");
  const existing = db
    .prepare(
      "SELECT * FROM fx_events WHERE namespace=? AND connection_id=? AND event_id=?",
    )
    .get(ns, connection, event.eventId);
  if (
    existing &&
    (existing.entity_id !== event.entityId ||
      existing.event !== event.event ||
      existing.event_timestamp !== event.eventTimestamp)
  )
    fail("事件ID冲突");
  db.prepare("INSERT OR IGNORE INTO fx_events VALUES(?,?,?,?,?,?,?)").run(
    ns,
    connection,
    event.eventId,
    event.event,
    event.entityId,
    event.eventTimestamp,
    receivedAt,
  );
  const result = existing ? "duplicate_event" : "refresh_required";
  db.prepare("INSERT OR IGNORE INTO fx_deliveries VALUES(?,?,?,?,?,?)").run(
    ns,
    delivery,
    connection,
    event.eventId,
    receivedAt,
    result,
  );
  if (!existing)
    db.prepare(
      "UPDATE fx_records SET sync_state='refresh_required' WHERE namespace=? AND connection_id=? AND source_id=?",
    ).run(ns, connection, event.entityId);
  return result;
}
export function addRelation(
  db,
  ns,
  child,
  parent,
  kind,
  evidence,
  confirmation = "demo_verified",
) {
  const c = own(db, ns, child),
    p = own(db, ns, parent);
  if (
    c.connection_id !== p.connection_id ||
    c.account_id !== p.account_id ||
    c.entity_id !== p.entity_id ||
    c.account_currency !== p.account_currency ||
    c.balance_type !== p.balance_type ||
    child === parent ||
    p.category !== "purchase" ||
    !["demo_verified", "source_confirmed", "unconfirmed"].includes(
      confirmation,
    ) ||
    !evidence
  )
    fail("关联范围不一致");
  if (
    confirmation !== "unconfirmed" &&
    db
      .prepare(
        "SELECT 1 FROM fx_relations WHERE namespace=? AND child_id=? AND confirmation!='unconfirmed' AND parent_id!=?",
      )
      .get(ns, child, parent)
  )
    fail("存在冲突原交易关联");
  db.prepare("INSERT OR IGNORE INTO fx_relations VALUES(?,?,?,?,?,?)").run(
    ns,
    child,
    parent,
    kind,
    confirmation,
    evidence,
  );
}
export function rootDate(db, ns, r) {
  if (r.category === "purchase") return r.posted_at;
  const p = db
    .prepare(
      "SELECT p.posted_at FROM fx_relations l JOIN fx_records p ON p.namespace=l.namespace AND p.id=l.parent_id WHERE l.namespace=? AND l.child_id=? AND l.confirmation IN('demo_verified','source_confirmed') AND p.category='purchase'",
    )
    .all(ns, r.id);
  return p.length === 1 ? p[0].posted_at : null;
}
export function rebuildDaily(db, ns = NS) {
  const buckets = new Map();
  for (const r of db
    .prepare("SELECT * FROM fx_records WHERE namespace=?")
    .iterate(ns)) {
    for (const timezone of ["UTC", "Asia/Hong_Kong"])
      for (const basis of ["posted", "order"]) {
        const time =
          basis === "posted"
            ? r.posted_at || (r.status === "pending" ? r.source_date : null)
            : rootDate(db, ns, r);
        const day = time
          ? new Date(Date.parse(time) + (timezone === "UTC" ? 0 : 8 * 3600000))
              .toISOString()
              .slice(0, 10)
          : "unassigned";
        const dims = [
            day,
            timezone,
            basis,
            r.platform,
            r.connection_id,
            r.account_id,
            r.balance_type,
            r.account_currency || "unknown",
            r.account_scale ?? -1,
            r.original_currency || "unknown",
            r.original_scale ?? -1,
            r.scenario,
            r.status || "unknown",
            r.category,
          ],
          key = JSON.stringify(dims);
        const b = buckets.get(key) || {
          dims,
          count: 0,
          amount: 0n,
          original: 0n,
          unknown: 0,
          issues: 0,
        };
        b.count++;
        b.amount += BigInt(r.amount_minor ?? "0");
        b.original += BigInt(r.original_minor ?? "0");
        if (r.original_minor == null || r.original_scale == null) b.unknown++;
        b.issues += rowDTO(r).issues.length;
        buckets.set(key, b);
      }
  }
  db.exec("SAVEPOINT fx_daily");
  try {
    db.prepare("DELETE FROM fx_daily WHERE namespace=?").run(ns);
    const stmt = db.prepare(
      `INSERT INTO fx_daily VALUES(${Array(21).fill("?").join(",")})`,
    );
    for (const [key, b] of buckets)
      stmt.run(
        ns,
        key,
        ...b.dims,
        b.count,
        b.amount.toString(),
        b.original.toString(),
        b.unknown,
        b.issues,
      );
    db.prepare("UPDATE fx_projection_state SET dirty=0 WHERE namespace=?").run(
      ns,
    );
    db.exec("RELEASE fx_daily");
  } catch (e) {
    db.exec("ROLLBACK TO fx_daily");
    db.exec("RELEASE fx_daily");
    throw e;
  }
  return buckets.size;
}
export function lookup(db, ns, id) {
  return rowDTO(own(db, ns, id));
}

// Local configuration only. No upstream writes or automatic product activation.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertLocal, openStore } from './store.mjs';
import { saveChannel, importChannelProducts, channelDetail } from './channels.mjs';
import { saveBin } from './bins.mjs';

export function importVerifiedCatalog(db, ns, evidence) {
  assertLocal();
  if (!db.prepare('SELECT 1 FROM demo_batches WHERE namespace=?').get(ns)) throw new Error('Existing local namespace required');
  if (!evidence || !/^[\w-]{1,80}$/.test(evidence.connectionId || '') || !evidence.accountRef ||
      !Number.isFinite(Date.parse(evidence.collectedAt)) || !Array.isArray(evidence.items) || !evidence.items.length || evidence.items.length > 100)
    throw new Error('Verified scoped catalog evidence required');
  const seen = new Set();
  for (const p of evidence.items) {
    if (!/^card_product_[\w-]+$/.test(p.id) || !/^\d{6}(\d{2})?$/.test(p.prefix) ||
        !/^[a-zA-Z_-]{1,40}$/.test(p.status) || seen.has(p.id)) throw new Error('Invalid or duplicate catalog product');
    seen.add(p.id);
  }
  // This reference names the internal connection; it is not a fabricated Slash entity ID.
  const entityRef = evidence.entityRef || `local-connection:${evidence.connectionId}`;
  let channel = db.prepare('SELECT id FROM card_channels WHERE namespace=? AND provider=? AND entity_ref=? AND account_ref=?')
    .get(ns, 'Slash', entityRef, evidence.accountRef);
  if (!channel) channel = saveChannel(db, ns, null, {
    name: 'Slash · 已核验产品目录', provider: 'Slash', entityRef, accountRef: evidence.accountRef,
    status: 'active', notes: `来源：GET /card-product；核验 ${evidence.collectedAt}。目录属于当前凭据范围，账户仅作内部关联，不代表账户发卡权限。${evidence.entityRef ? '' : '实体ID未提供；实体参考值为内部连接标识。'}卡组织按用户截图Visa登记；USD与50张限制为本地草稿默认配置，非渠道承诺。未启用真实开卡或自动目录同步。`,
  });
  const imported = importChannelProducts(db, ns, channel.id, {
    revision: channelDetail(db, ns, channel.id).revision,
    items: evidence.items.map(({ id, prefix, status }) => ({ id, prefix, status })),
  });
  const products = [];
  for (const p of evidence.items) {
    const existing = db.prepare('SELECT p.id,p.bin_prefix FROM bin_products p JOIN bin_channel_links l ON l.namespace=p.namespace AND l.product_id=p.id WHERE p.namespace=? AND l.channel_id=? AND p.upstream_product_id=?')
      .all(ns, channel.id, p.id);
    if (existing.length) {
      if (existing.some(x => x.bin_prefix !== p.prefix)) throw new Error('Existing product prefix conflict');
      products.push(...existing.map(x => ({ id: x.id, prefix: p.prefix, created: false })));
      continue;
    }
    const row = saveBin(db, ns, null, {
      name: `Slash · Visa · ${p.prefix}`, binPrefix: p.prefix, network: 'Visa', currency: 'USD',
      platform: 'Slash', upstreamProductId: p.id, channelId: channel.id, status: 'draft', maxCards: 50,
      description: `Slash 卡产品 ${p.prefix}`,
      internalNote: `用户截图指定产品；ID、prefix、来源状态经 GET /card-product 核验（${evidence.collectedAt}）。Visa取自截图；USD及50张为本地草稿默认值，费率及真实发卡权限未核验。`,
    });
    products.push({ id: row.id, prefix: p.prefix, created: true });
  }
  return { channel: channelDetail(db, ns, channel.id), imported, products };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, ns = 'slash-clearing-v1'] = process.argv.slice(2);
  if (!file) throw new Error('Usage: node demo-server/slash/import-verified-catalog.mjs PRIVATE_EVIDENCE_JSON [namespace]');
  const evidence = JSON.parse(readFileSync(file, 'utf8'));
  const db = openStore();
  try { console.log(JSON.stringify(importVerifiedCatalog(db, ns, evidence), null, 2)); }
  finally { db.close(); }
}

// Shadow balances are never eligible to authorize spending or withdrawals.
const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function isLedgerReadPath(path: string): boolean {
  return new RegExp(`^/(client|admin)-api/v1/customers/${uuid}/ledger$`).test(path);
}
export type ShadowBalance = {
  id: string; customerId: string; key: string; kind: 'wallet' | 'card' | 'transit';
  currency: 'USD' | 'USDT'; scale: 2 | 6;
  postedMinor: string; heldMinor: string; ledgerAvailableMinor: string;
};
export type ShadowLedger = {
  mode: 'shadow'; executionEligible: false; authorizationCoverage: 'not_integrated';
  externalReconciliation: 'not_checked'; reconciliationScope: 'local_journal_vs_blnk';
  reconciliation: 'matched' | 'mismatch' | 'insufficient_data'; observedAt: string;
  pendingOperations: number; totalsMinor: Partial<Record<'USD' | 'USDT', string>>;
  accounts: ShadowBalance[];
};
const integer = (v: unknown): v is string => typeof v === 'string' && /^(0|-?[1-9][0-9]*)$/.test(v) && v.length <= 50;
export function parseShadowLedger(value: unknown, customerId: string): ShadowLedger {
  const v = value as ShadowLedger | null;
  const bad = () => { throw new Error('invalid_ledger_response'); };
  if (!v || v.mode !== 'shadow' || v.executionEligible !== false || v.authorizationCoverage !== 'not_integrated' ||
      v.externalReconciliation !== 'not_checked' || v.reconciliationScope !== 'local_journal_vs_blnk' ||
      !['matched', 'mismatch', 'insufficient_data'].includes(v.reconciliation) ||
      typeof v.observedAt !== 'string' || !Number.isFinite(Date.parse(v.observedAt)) ||
      !Number.isSafeInteger(v.pendingOperations) || v.pendingOperations < 0 ||
      !Array.isArray(v.accounts) || v.accounts.length > 1000 || !v.totalsMinor || typeof v.totalsMinor !== 'object' || Array.isArray(v.totalsMinor)) return bad();
  const ids = new Set<string>(); const sums: Partial<Record<'USD' | 'USDT', bigint>> = {};
  for (const a of v.accounts) {
    if (!a || typeof a.id !== 'string' || !new RegExp(`^${uuid}$`).test(a.id) || ids.has(a.id) || a.customerId !== customerId || typeof a.key !== 'string' ||
        !['wallet', 'card', 'transit'].includes(a.kind) || !['USD', 'USDT'].includes(a.currency) || a.scale !== (a.currency === 'USD' ? 2 : 6) ||
        !integer(a.postedMinor) || !integer(a.heldMinor) || !integer(a.ledgerAvailableMinor)) return bad();
    if (BigInt(a.postedMinor) - BigInt(a.heldMinor) !== BigInt(a.ledgerAvailableMinor)) return bad();
    ids.add(a.id); sums[a.currency] = (sums[a.currency] || 0n) + BigInt(a.postedMinor);
  }
  if (Object.keys(sums).length !== Object.keys(v.totalsMinor).length) return bad();
  for (const [currency, amount] of Object.entries(v.totalsMinor)) {
    if (!['USD', 'USDT'].includes(currency) || !integer(amount) || sums[currency as 'USD' | 'USDT'] !== BigInt(amount)) return bad();
  }
  return v;
}

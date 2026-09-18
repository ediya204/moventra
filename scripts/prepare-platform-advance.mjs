// Offline review only: no database, network, ledger submission, or provider writes.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 180 && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v);
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !allowed.includes(k))) throw new Error('invalid_or_unknown_fields');
}

export function prepareAdvance(input) {
  keys(input, ['version', 'email', 'source', 'currency', 'scale', 'amountMinor', 'frequency', 'customerId', 'requestId', 'allocations']);
  if (input.version !== 1 || input.email !== 'ediyanghk@gmail.com' || input.source !== 'platform_advance' || input.currency !== 'USD' || input.scale !== 2 || input.amountMinor !== '1000000' || input.frequency !== 'one_time') throw new Error('outside_authorized_scope');
  for (const key of ['customerId', 'requestId']) {
    if (input[key] !== null && (typeof input[key] !== 'string' || !uuid.test(input[key]))) throw new Error(`invalid_${key}`);
  }
  if (!Array.isArray(input.allocations) || input.allocations.length > 1000) throw new Error('invalid_allocations');
  const seen = new Set();
  let allocated = 0n;
  const allocations = input.allocations.map((a) => {
    keys(a, ['connectionId', 'cardId', 'amountMinor']);
    if (!text(a.connectionId) || !text(a.cardId) || typeof a.amountMinor !== 'string' || !/^[1-9][0-9]{0,6}$/.test(a.amountMinor)) throw new Error('invalid_card_allocation');
    const key = JSON.stringify([a.connectionId, a.cardId]);
    if (seen.has(key)) throw new Error('duplicate_card');
    seen.add(key);
    allocated += BigInt(a.amountMinor);
    return { connectionId: a.connectionId, cardId: a.cardId, amountMinor: a.amountMinor };
  }).sort((a, b) => {
    const left = JSON.stringify([a.connectionId, a.cardId]);
    const right = JSON.stringify([b.connectionId, b.cardId]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (allocated > 1000000n) throw new Error('allocation_exceeds_total');
  const config = { version: 1, email: input.email, source: input.source, currency: 'USD', scale: 2, amountMinor: '1000000', frequency: 'one_time', customerId: input.customerId, requestId: input.requestId, allocations };
  return {
    mode: 'offline_review', executionEligible: false,
    planHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
    config, allocatedMinor: allocated.toString(), unallocatedMinor: (1000000n - allocated).toString(),
    blockers: [
      ...(!config.customerId ? ['customer_identity_not_resolved'] : []),
      ...(!config.requestId ? ['business_request_id_not_assigned'] : []),
      ...(allocated < 1000000n ? ['card_allocation_incomplete'] : []),
      'identity_and_card_ownership_require_live_verification',
      'platform_funding_and_existing_advance_require_verification',
      'advance_accounting_and_balance_controls_require_implementation_and_review',
      'ledger_activation_and_existing_card_opening_require_verification',
      'provider_balance_limits_and_authorizations_require_verification',
      'authorized_operator_must_execute_and_reconcile',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('usage: node scripts/prepare-platform-advance.mjs <config.json>');
    const raw = readFileSync(process.argv[2]);
    if (raw.length > 1024 * 1024) throw new Error('config_too_large');
    console.log(JSON.stringify(prepareAdvance(JSON.parse(raw)), null, 2));
  } catch (error) {
    // Do not echo input contents, paths, or credentials from malformed JSON.
    console.error(error instanceof SyntaxError ? 'invalid_json' : error.code ? 'config_read_failed' : error.message);
    process.exitCode = 1;
  }
}

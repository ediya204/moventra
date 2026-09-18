import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareAdvance } from './prepare-platform-advance.mjs';

const template = () => JSON.parse(readFileSync(new URL('../docs/business/platform-advance-review.json', import.meta.url)));
const card = (id, amountMinor, connectionId = 'synthetic-connection') => ({ cardId: id, connectionId, amountMinor });

test('template is incomplete and never executable', () => {
  const result = prepareAdvance(template());
  assert.equal(result.unallocatedMinor, '1000000');
  assert.equal(result.executionEligible, false);
  assert.equal(Object.hasOwn(result.config, 'usage'), false);
  assert.ok(result.blockers.includes('customer_identity_not_resolved'));
});
test('exact cents and total account cap; no per-card multiplication', () => {
  const config = template();
  config.allocations = [card('a', '333333'), card('b', '666667')];
  const result = prepareAdvance(config);
  assert.equal(result.allocatedMinor, '1000000');
  assert.equal(result.unallocatedMinor, '0');
  config.allocations.push(card('c', '1'));
  assert.throws(() => prepareAdvance(config), /allocation_exceeds_total/);
});
test('duplicate card rejected while cross-connection IDs remain distinct', () => {
  const config = template();
  config.allocations = [card('a', '1'), card('a', '2')];
  assert.throws(() => prepareAdvance(config), /duplicate_card/);
  config.allocations[1].connectionId = 'other-connection';
  assert.equal(prepareAdvance(config).allocatedMinor, '3');
});
test('amount encoding and policy changes fail closed', () => {
  for (const amountMinor of [100, '-1', '1.2', '1e3', '01', '0', '99999999999999999999']) {
    assert.throws(() => prepareAdvance({ ...template(), allocations: [card('a', amountMinor)] }));
  }
  for (const delta of [{ amountMinor: '10000000' }, { source: 'crypto_deposit' }, { usage: 'card_spend_only' }, { frequency: 'monthly' }, { email: 'other@example.test' }, { apply: true }, { customerId: '' }]) {
    assert.throws(() => prepareAdvance({ ...template(), ...delta }));
  }
});
test('reordered allocations give same hash; changed allocation changes hash', () => {
  const config = { ...template(), allocations: [card('b', '10'), card('a', '20')] };
  const hash = prepareAdvance(config).planHash;
  config.allocations.reverse();
  assert.equal(prepareAdvance(config).planHash, hash);
  config.allocations[0].amountMinor = '21';
  assert.notEqual(prepareAdvance(config).planHash, hash);
});
test('populated input never certifies ownership, funds, or permission', () => {
  const config = { ...template(), customerId: '00000000-0000-4000-8000-000000000001', requestId: '00000000-0000-4000-8000-000000000002', allocations: [card('a', '1000000')] };
  const result = prepareAdvance(config);
  assert.equal(result.executionEligible, false);
  assert.ok(result.blockers.includes('identity_and_card_ownership_require_live_verification'));
  assert.ok(result.blockers.includes('authorized_operator_must_execute_and_reconcile'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { money, amountInput, units } from '../../apps/admin/src/finance/types.ts';

test('USD and USDT display two decimals with exact rounding, grouping and missing values', () => {
  assert.equal(money('123456789', 'USDT'), 'USDT 123.46');
  assert.equal(money('999999', 'USDT'), 'USDT 1.00');
  assert.equal(money('1004999', 'USDT'), 'USDT 1.00');
  assert.equal(money('1005000', 'USDT'), 'USDT 1.01');
  assert.equal(money('-1005000', 'USDT'), 'USDT -1.01');
  assert.equal(money('-1', 'USDT'), 'USDT 0.00');
  assert.equal(money('0', 'USD'), 'USD 0.00');
  assert.equal(money('101', 'USD'), 'USD 1.01');
  assert.equal(money(null, 'USDT'), '—');
  assert.equal(money('9007199254740993123456', 'USDT'), 'USDT 9,007,199,254,740,993.12');
});

test('editing and accounting retain six USDT decimals, independent of rounded display', () => {
  const minor = '123456789';
  assert.equal(amountInput(minor, 'USDT'), '123.456789');
  assert.equal(units(amountInput(minor, 'USDT'), 'USDT'), minor);
  assert.equal(amountInput('1', 'USDT'), '0.000001');
  assert.equal(units(amountInput('1', 'USDT'), 'USDT'), '1');
  assert.equal(units(amountInput('101', 'USD'), 'USD'), '101');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyFeePlanRedirect, managementDetailPath} from '../../apps/admin/src/management/routes.ts';
import {navigationGroups, activeNavigation} from '../../apps/admin/src/admin/navigation.ts';

test('V1 has a single pricing entry and no independent customer group navigation', () => {
  for (const slash of [true, false]) {
    const groups = navigationGroups(slash), items = groups.flatMap(g => g.items);
    assert.ok(!items.some(i => i.path === '/user-groups/groups' || i.label.includes('用户组')));
    assert.equal(items.filter(i => i.path === '/pricing').length, 1);
    assert.ok(groups.find(g => g.label === '资金与财务').items.some(i => i.path === '/pricing'));
    assert.ok(items.some(i => i.path === '/user-groups/users'));
    assert.ok(items.some(i => i.path === '/system/access'));
    assert.equal(activeNavigation('/pricing/plans/DEMO-GROUP-STANDARD', items), '/pricing');
  }
});
test('legacy links preserve the fee plan and tab without redirect loops or changing user routes', () => {
  assert.equal(legacyFeePlanRedirect('/user-groups/groups'), '/pricing');
  assert.equal(legacyFeePlanRedirect('/user-groups/groups/DEMO-GROUP-STANDARD', '?tab=fees'), '/pricing/plans/DEMO-GROUP-STANDARD?tab=fees');
  assert.equal(legacyFeePlanRedirect('/pricing/plans/DEMO-GROUP-STANDARD'), null);
  assert.equal(legacyFeePlanRedirect('/user-groups/users/DEMO-USER-001'), null);
  assert.equal(managementDetailPath('groups', 'DEMO-GROUP-STANDARD'), '/pricing/plans/DEMO-GROUP-STANDARD');
  assert.equal(managementDetailPath('users', 'DEMO-USER-001'), '/user-groups/users/DEMO-USER-001');
});

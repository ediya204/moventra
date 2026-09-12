import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionNavigation,isProductionPath} from '../../apps/admin/src/operations/navigation.ts';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('production uses local navigation groups but only connected destinations are enabled',()=>{
 assert.deepEqual(productionNavigation.map(g=>g.label),['客户与开户','卡片与交易','资金与财务','风险与合规','经营分析','系统管理']);
 const items=productionNavigation.flatMap(g=>g.items);
 assert.ok(items.some(i=>i.path==='/onboarding'&&isProductionPath(i.path)));
 assert.ok(items.some(i=>i.path==='/transactions'&&isProductionPath(i.path)));
 assert.ok(items.some(i=>i.path==='/session?security=1'&&isProductionPath(i.path)));
 for(const path of ['/finance/withdrawals','/approvals','/user-groups/users','/system/settings'])assert.equal(isProductionPath(path),false);
 assert.ok(!items.some(i=>i.path.startsWith('/demo')));
});
test('formal entry keeps transaction/card deep links and DEV-only demo isolation',()=>{
 const app=read('apps/admin/src/App.tsx');
 for(const path of ['/customers','/cards','/system/channels','/transactions','/cards/:id','/workbench','/onboarding','/onboarding/:customerId'])assert.ok(app.includes(`path="${path}"`));
 assert.match(app,/import\.meta\.env\.DEV \? lazy/);
 for(const name of ['OperationsPage','ChannelTransactionsPage','OnboardingPage']){
  const page=read(`apps/admin/src/operations/${name}.tsx`);
  assert.match(page,/<DashboardLayout production>/);assert.match(page,/mfaVerified/);
 }
 const layout=read('apps/admin/src/components/DashboardLayout.tsx');
 assert.match(layout,/disabled=\{production && !isProductionPath/);
 assert.match(layout,/!production && <Typography\s+component="a"/);
});

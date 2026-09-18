import { navigationGroups } from '../admin/navigation.ts';

// Preserve the local information architecture; expose only connected services.
export const productionNavigation = [{label:'运营管理',icon:'solar:letter-bold-duotone',description:'客户通知与站内信',items:[{label:'消息管理',path:'/operations/messages',icon:'solar:letter-bold-duotone'}]}, ...navigationGroups(true).map(group => ({
  ...group,
  items: [...(group.label === '资金与财务' ? [{label:'余额查询',path:'/finance/balances',icon:'solar:wallet-money-bold-duotone'}] : []), ...group.items].filter(item => !['/demo/scenarios','/finance/orders','/finance/test-funds'].includes(item.path)).map(item =>
    item.path === '/user-groups/users' ? { ...item, label: '注册用户' } :
    item.path === '/operations' ? { ...item, path: '/workbench' } :
    item.path === '/system/access' ? { ...item, path: '/session?security=1' } : item),
}))];
export function isProductionPath(path: string) {
  return ['/operations/messages', '/finance/balances', '/finance/crypto-flows', '/finance/withdrawals', '/finance/otc', '/system/cregis', '/pricing', '/reports', '/card-bins', '/workbench', '/onboarding', '/user-groups/users', '/cards', '/customers', '/system/channels', '/transactions', '/session?security=1'].includes(path);
}

import { navigationGroups } from '../admin/navigation.ts';

// Preserve the local information architecture; expose only connected services.
export const productionNavigation = navigationGroups(true).map(group => ({
  ...group,
  items: group.items.filter(item => item.path !== '/demo/scenarios').map(item =>
    item.path === '/user-groups/users' ? { ...item, label: '注册用户' } :
    item.path === '/finance/orders' ? { ...item, label: '测试资金中心', path: '/finance/test-funds' } :
    item.path === '/operations' ? { ...item, path: '/workbench' } :
    item.path === '/system/access' ? { ...item, path: '/session?security=1' } : item),
}));
export function isProductionPath(path: string) {
  return ['/finance/crypto-flows', '/finance/withdrawals', '/finance/otc', '/system/cregis', '/pricing', '/reports', '/card-bins', '/finance/test-funds', '/workbench', '/onboarding', '/user-groups/users', '/cards', '/customers', '/system/channels', '/transactions', '/session?security=1'].includes(path);
}

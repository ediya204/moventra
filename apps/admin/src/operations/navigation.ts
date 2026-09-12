import { navigationGroups } from '../admin/navigation.ts';

// Preserve the local information architecture; expose only connected services.
export const productionNavigation = navigationGroups(true).map(group => ({
  ...group,
  items: group.items.filter(item => item.path !== '/demo/scenarios').map(item =>
    item.path === '/user-groups/users' ? { ...item, label: '开户审批', path: '/onboarding' } :
    item.path === '/operations' ? { ...item, path: '/workbench' } :
    item.path === '/system/access' ? { ...item, path: '/session?security=1' } : item),
}));
export function isProductionPath(path: string) {
  return ['/workbench', '/onboarding', '/cards', '/customers', '/system/channels', '/transactions', '/session?security=1'].includes(path);
}

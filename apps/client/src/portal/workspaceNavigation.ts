// One product navigation for the live workspace and development Demo.
export const workspaceNavigation = [
  ["overview", "工作台", "solar:widget-4-linear"],
  ["funds", "资金中心", "solar:wallet-money-linear"],
  ["cards", "卡片中心", "solar:card-linear"],
  ["transactions", "交易与账单", "solar:bill-list-linear"],
  ["messages", "消息中心", "solar:bell-linear"],
  ["support", "帮助与工单", "solar:chat-round-line-linear"],
  ["settings", "设置与开户", "solar:settings-linear"],
];
export const workspaceWidth = 252;
export const workspaceGrid = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }, gap: 2 };
export const workspaceChartsGrid = { display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.6fr) minmax(0, 1fr)" }, gap: 3 };

// Canonical sidebar section for child routes, including aliases and settings deep links.
export function workspacePage(pathname: string, fallback = '工作台') {
  if (/^\/portal\/(funds|crypto)(?:\/|$)/.test(pathname)) return { title: '资金中心', section: '/portal/funds', description: '管理钱包余额、充值与兑换，查询每笔资金的处理进度。' };
  if (/^\/portal\/(cards|card-orders|issued-cards)(?:\/|$)/.test(pathname)) return { title: fallback, section: '/portal/cards', description: '查看卡片、消费记录与开卡申请，管理已授权的卡片。' };
  if (/^\/portal\/(transactions|card-transactions)(?:\/|$)/.test(pathname)) return { title: fallback, section: '/portal/transactions', description: '查询卡片消费、退款与资金往来，点击记录查看详情。' };
  if (['/portal/settings', '/portal/accounts', '/portal/security'].includes(pathname)) return { title: fallback, section: '/portal/settings', description: '管理个人账户、登录验证与服务状态。' };
  if (pathname === '/portal/messages') return { title: fallback, section: pathname, description: '查看消息服务状态与业务进度查询入口。' };
  if (pathname === '/portal/support') return { title: fallback, section: pathname, description: '查找常见问题，快速定位账户和交易的处理记录。' };
  return { title: fallback, section: '/portal', description: '掌握钱包与卡片近况，快速开始常用操作。' };
}

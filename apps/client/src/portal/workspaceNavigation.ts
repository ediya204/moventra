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

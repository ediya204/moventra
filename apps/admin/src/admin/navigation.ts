export type NavItem = { label: string; path: string; icon: string };
export type NavGroup = {
  label: string;
  icon: string;
  description: string;
  items: NavItem[];
};
const item = (label: string, path: string, icon: string): NavItem => ({
  label,
  path,
  icon: `solar:${icon}`,
});
export const primaryNavigation = [
  item("管理总览", "/workbench", "widget-5-bold-duotone"),
  item("审批中心", "/approvals", "checklist-minimalistic-bold-duotone"),
];
export function navigationGroups(slash = false): NavGroup[] {
  return [
    {
      label: "客户与开户",
      icon: "solar:users-group-rounded-bold-duotone",
      description: "个人客户开户、资料与账户管理",
      items: [
        item("用户与开户", "/user-groups/users", "user-plus-bold-duotone"),
        item("账户目录", "/customers", "hierarchy-2-bold-duotone"),
      ],
    },
    {
      label: "卡片与交易",
      icon: "solar:card-2-bold-duotone",
      description: "卡片、消费及订单调查",
      items: [
        item("卡BIN管理", "/card-bins", "layers-bold-duotone"),
        item("全部卡片", "/cards", "card-2-bold-duotone"),
        item("卡交易流水", "/transactions", "bill-list-bold-duotone"),
        ...(!slash
          ? [
              item("账户卡资产", "/cards/assets", "wallet-money-bold-duotone"),
              item("OTP 活动", "/cards/otp", "lock-password-bold-duotone"),
            ]
          : []),
      ],
    },
    {
      label: "资金与财务",
      icon: "solar:wallet-money-bold-duotone",
      description: "资金订单、商业定价与经营报表",
      items: [
        ...(slash ? [item("数字货币流水", "/finance/crypto-flows", "bill-list-bold-duotone"),item("OTC 管理", "/finance/otc", "transfer-horizontal-bold-duotone"),item("数字货币出金审批", "/finance/withdrawals", "checklist-minimalistic-bold-duotone")] : []),
        item("资金订单", "/finance/orders", "transfer-horizontal-bold-duotone"),
        item("费率管理", "/pricing", "tag-price-bold-duotone"),
        item("资金经营报表", "/reports", "safe-square-bold-duotone"),
        ...(!slash
          ? [item("收入分析", "/revenue", "chart-2-bold-duotone")]
          : []),
      ],
    },
    {
      label: "风险与合规",
      icon: "solar:shield-warning-bold-duotone",
      description: "风险监控、对账调查与证据追踪",
      items: [
        item("风险监控", "/risk", "shield-warning-bold-duotone"),
        item(
          "资金对账",
          "/reconciliation",
          "checklist-minimalistic-bold-duotone",
        ),
      ],
    },
    {
      label: "经营分析",
      icon: "solar:chart-square-bold-duotone",
      description: "保留现有经营指标与分析工具",
      items: [
        item("运营工作台", "/operations", "chart-square-bold-duotone"),
        ...(slash
          ? [item("Slash 场景库", "/demo/scenarios", "layers-bold-duotone")]
          : [
              item("业务全景", "/analytics/overview", "widget-4-bold-duotone"),
              item("卡片分析", "/cards/overview", "card-2-bold-duotone"),
              item(
                "交易分析",
                "/transactions/overview",
                "transfer-horizontal-bold-duotone",
              ),
              item(
                "账户组分析",
                "/analytics/accounts",
                "users-group-rounded-bold-duotone",
              ),
            ]),
      ],
    },
    {
      label: "系统管理",
      icon: "solar:settings-bold-duotone",
      description: "审计、接入信息、访问权限与后台设置",
      items: [
        item("操作日志", "/system/audit", "document-text-bold-duotone"),
        item("渠道与数据", "/system/channels", "server-square-bold-duotone"),
        item("访问权限", "/system/access", "shield-user-bold-duotone"),
        item("后台设置", "/system/settings", "settings-bold-duotone"),
      ],
    },
  ];
}
export function activeNavigation(pathname: string, items: NavItem[]) {
  return (
    [...items]
      .sort((a, b) => b.path.length - a.path.length)
      .find((i) => pathname === i.path || pathname.startsWith(i.path + "/"))
      ?.path ||
    (pathname === "/user-groups/new-user" ? "/user-groups/users" : undefined)
  );
}

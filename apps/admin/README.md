# Moventra 运营后台

更新日期：2026-09-07。独立入口在 [App.tsx](src/App.tsx)，开放 `/admin/login`（旧 `/login` 自动跳转）、`/forgot-password`、`/session`、`/workbench`、`/transactions`、`/cards/:id`；不引用客户端源码。完整流程见 [全站业务总览](../../docs/business/README.md)。

从仓库根目录运行：

```bash
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm dev:admin
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm build:admin
```

开发地址 127.0.0.1:8850，产物 `apps/admin/dist`。应用身份固定 admin，不使用 `VITE_SITE_KIND` 切换。邮箱列表来自已批准的配置，逗号分隔；缺失则全部拒绝。列表仅用于 Firebase 密码请求前的登录提示，不承担后端授权。后台关闭 Google 登录，没有自助注册入口。

Go 确认 UID、有效本地用户、operator、MFA 和指定客户资源授权后才能访问运营数据；拒绝/异常时退出 Firebase 并留在登录页。邮箱验证和 MFA 设置流程不代表已获业务权限。客户端和运营端共享 Firebase 项目，但 SDK 实例、内存会话、路由和网关分别处理。

[DemoApp.tsx](src/DemoApp.tsx) 仅在 DEV 且显式 Demo 模式加载，生产不打包该路由。完整卡片管理、审批、资金、用户组、渠道配置和来源分析仍属于 Demo；其历史服务及数据库不在仓库。正式渠道只读页面另由 Go 提供，不依赖 Demo 路由。

参阅 [开发约束](../../AGENTS.md)、[文档索引](../../docs/README.md)、[认证配置](../../docs/frontend/firebase-setup.md)、[部署记录](../../deploy/README.md)。


## 当前 DEV 业务维护

卡片/交易、BIN状态、内部用户绑定、费率方案和账户目录已按最新本地口径更新，详见 [V1现状](../../docs/current-state.md)。这些页面仍通过 DEV DemoApp 加载，生产入口与产物不包含完整业务原型。手动同步、卡关联资料和资金沙盒依赖未纳入本仓库的旧本地服务，不能在正式Go接口上直接调用。

## 资金流与运营概览

通过运营身份和 MFA 验证后进入 `/workbench`，查看已授权 USD 客户交易投影的资金流、活跃度及状态分布。统计周期支持 7/14/30 天，提供精确每日明细及 CSV。渠道投影未并入本统计源，卡片、商户及来源同步指标保持不可用。参阅 [页面与数据口径](../../docs/frontend/operations-overview.md)。

## 正式渠道卡交易

`/transactions` 与 `/cards/:id?connection=...` 读取手动导入的独立渠道投影，除 staff 身份和 MFA 外还要求 `channel_read_grants`。交易每页 20 条，UTC 开始含、截止不含，默认不限日期；刷新只重读导入版本。卡资料未绑定内部用户，不提供资金余额或控制动作。商户 Logo 仅辅助展示，不改变来源身份。业务代码 `0d5158d` 及部署结果见 [独立发布记录](../../docs/releases/channel-projection-2026-09-07.md)，本人登录验收仍待完成；本轮仅整理文档。

## 2026-09-13 联合发布候选

运营总览、渠道交易/卡片详情与开户审批共用本地 DashboardLayout。保留六组菜单，尚未接入的功能禁用。登录统一为 `/admin/login`，后端角色、MFA 与客户范围各自校验。发布依赖增量角色迁移 004，详见[联合发布记录](../../docs/releases/2026-09-13-admin-login-joint.md)。

## 2026-09-13 已有模块恢复

正式新增 `/cards`（服务端分页、名称/尾号/来源状态查询）、`/customers`（已有账户授权）和 `/system/channels`（采集/导入状态）。卡详情可查看此卡交易并返回卡片目录。其余已存在的本地模块菜单标注待迁移；原 Node 服务和 135 项回归已恢复，使用根目录 `pnpm workspace:dev` 可独立复现。生产构建继续排除 Demo 路由。见[恢复清单](../../docs/business/existing-modules-restoration-2026-09-13.md)。

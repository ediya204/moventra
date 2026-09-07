# Moventra 运营后台

更新日期：2026-09-07。独立入口在 [App.tsx](src/App.tsx)，开放 `/login`、`/forgot-password`、`/session`、`/workbench`；不引用客户端源码。

从仓库根目录运行：

```bash
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm dev:admin
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm build:admin
```

开发地址 127.0.0.1:8850，产物 `apps/admin/dist`。应用身份固定 admin，不使用 `VITE_SITE_KIND` 切换。邮箱列表来自已批准的配置，逗号分隔；缺失则全部拒绝。列表仅用于 Firebase 密码请求前的登录提示，不承担后端授权。后台关闭 Google 登录，没有自助注册入口。

Go 确认 UID、有效本地用户、operator、MFA 和指定客户资源授权后才能访问运营数据；拒绝/异常时退出 Firebase 并留在登录页。邮箱验证和 MFA 设置流程不代表已获业务权限。客户端和运营端共享 Firebase 项目，但 SDK 实例、内存会话、路由和网关分别处理。

[DemoApp.tsx](src/DemoApp.tsx) 仅在 DEV 且显式 Demo 模式加载，生产不打包该路由。审批、卡片、资金、用户组、渠道和分析页面属于保留的 Demo 源码；其历史服务及数据库不在仓库。

参阅 [开发约束](../../AGENTS.md)、[文档索引](../../docs/README.md)、[认证配置](../../docs/frontend/firebase-setup.md)、[部署记录](../../deploy/README.md)。


## 当前 DEV 业务维护

卡片/交易、BIN状态、内部用户绑定、费率方案和账户目录已按最新本地口径更新，详见 [V1现状](../../docs/current-state.md)。这些页面仍通过 DEV DemoApp 加载，生产入口与产物不包含完整业务原型。手动同步、卡关联资料和资金沙盒依赖未纳入本仓库的旧本地服务，不能在正式Go接口上直接调用。

## 资金流与运营概览

通过运营身份和 MFA 验证后进入 `/workbench`，查看已授权 USD 交易投影的资金流、交易活跃度及状态分布。统计周期支持 7/14/30 天，提供精确每日明细及 CSV。未接入的卡片、商户和来源同步能力保持明确空态。参阅 [页面与数据口径](../../docs/frontend/operations-overview.md)。

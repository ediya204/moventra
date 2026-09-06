# Moventra 运营后台

更新日期：2026-09-07。独立入口在 [App.tsx](src/App.tsx)，仅开放 `/login`、`/forgot-password`、`/session`；不引用客户端源码。

从仓库根目录运行：

```bash
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm dev:admin
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm build:admin
```

开发地址 127.0.0.1:8850，产物 `apps/admin/dist`。应用身份固定 admin，不使用 `VITE_SITE_KIND` 切换。邮箱列表来自已批准的配置，逗号分隔；缺失则全部拒绝。列表仅用于 Firebase 密码请求前的登录提示，不承担后端授权。后台关闭 Google 登录，没有自助注册入口。

Go 确认 UID、有效本地用户、operator、MFA 和指定客户资源授权后才能访问运营数据；拒绝/异常时退出 Firebase 并留在登录页。邮箱验证和 MFA 设置流程不代表已获业务权限。客户端和运营端共享 Firebase 项目，但 SDK 实例、内存会话、路由和网关分别处理。

[DemoApp.tsx](src/DemoApp.tsx) 仅在 DEV 且显式 Demo 模式加载，生产不打包该路由。审批、卡片、资金、用户组、渠道和分析页面属于保留的 Demo 源码；其历史服务及数据库不在仓库。

参阅 [开发约束](../../AGENTS.md)、[文档索引](../../docs/README.md)、[认证配置](../../docs/frontend/firebase-setup.md)、[部署记录](../../deploy/README.md)。

# Moventra 运营后台

独立入口、路由、构建与部署。共用认证和 UI 位于 `packages/shared`，不引用另一应用源码。

从仓库根目录执行 `pnpm dev:admin`、`pnpm build:admin`。后台构建需设置 `VITE_ADMIN_LOGIN_EMAILS` 为批准的运营邮箱列表；缺失时登录拒绝所有账号。Go 仍负责最终权限与 MFA 校验。

详细开发约束见根目录 `AGENTS.md` 与 `docs/DEVELOPMENT.md`。历史功能和本地 Demo 说明位于 `docs/frontend`，不能视为生产能力。

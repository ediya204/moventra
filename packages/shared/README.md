# Moventra 共享前端模块

更新日期：2026-09-07。共用认证、Firebase SDK、UI、主题、类型与数据适配；每端路由由各自应用维护。

- `src/auth`：Go 身份查询、注册分流、MFA 与会话状态。
- `packages/shared/src/pages/LoginPage.tsx`、`src/website/auth`：共用登录、找回密码与认证布局。
- `packages/shared/src/theme.ts`、`src/components`：MUI 主题和公共组件。
- `src/api`、`src/slash` 等：包含历史 Demo/旧只读接口适配，存在于共享包不表示生产路由开放。
- `packages/shared/src/config/firebase.web.json`：公开 Web SDK 配置，不放 Admin SDK 凭据或渠道密钥。

共享包不得反向依赖 `apps/client` / `apps/admin`；两应用不得互相引用源码。根目录 `pnpm check:boundaries` 检查边界及本地导入；共享代码变更运行两端 `pnpm typecheck`、`pnpm build` 和 `pnpm test`，后台构建需预设批准的邮箱配置。

素材在 `packages/assets/public`，构建工具在 `packages/tooling/vite.ts`。更多见 [主题约定](../../docs/frontend/ui-theme.md)、[文档索引](../../docs/README.md)。

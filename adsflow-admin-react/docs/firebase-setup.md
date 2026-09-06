# Firebase 基础接入

2026-09-07：已为用户指定的现有 Google Cloud 项目启用 Firebase，并注册 Web 应用。

- 项目 ID：`edi-gws-20260309-hk`
- Web 应用名：`moventra-card-bin`
- App ID：`1:666750758771:web:c38e91069fc64737db5f06`
- 控制台：https://console.firebase.google.com/project/edi-gws-20260309-hk/overview

前端安装 Firebase 模块化 SDK，入口加载 `src/firebase.ts`，公共 Web 配置由 Firebase CLI 下载到 `src/config/firebase.web.json`。配置不是服务账号密钥，也不提供数据库或业务权限。未启用 Analytics、Firestore、Storage 或 Hosting。

`getFirebaseAuth()` 为后续登录接入提供仅内存持久化的 Auth 实例；页面刷新后不会恢复登录。当前 `AuthContext` 仍使用旧登录接口，不能将 SDK 初始化视为 Firebase 登录或业务权限验收。

后端 `.env.example` 已填写同一项目 ID。运行时仍需在仓库外提供服务端凭据，并注入 `GOOGLE_APPLICATION_CREDENTIALS`。程序不自动加载 dotenv，本次没有创建服务账号私钥或修改运行中服务。

根目录 `.firebaserc` 指向此项目；`firebase.json` 暂无待部署服务。前端仍按已有 Cloudflare、Go/PostgreSQL 按 Render 架构推进。

## 后续登录闭环

实施前明确登录方式及运营 MFA 方案，配置 Auth provider，再将 Firebase ID Token 接入 Go 身份与主体查询。必须保留邮箱验证、token 撤销检查、本地用户禁用、主体/资源授权和运营 MFA。不得用 Firebase 用户身份直接授予管理员权限，也不能把新 token 发送给旧 `/admin-api/login` 或 Demo 接口。

本次未启用登录 provider、创建业务用户、连接生产数据库、执行迁移、部署应用或验证真实金融渠道。真实用户登录和 Go 权限联调尚未完成。

## 验证与配置查询

```bash
# 仓库根目录
npx -y firebase-tools@latest use
npx -y firebase-tools@latest apps:list WEB --project edi-gws-20260309-hk

# adsflow-admin-react
pnpm typecheck
pnpm build
```

官方依据：[Web SDK 接入](https://firebase.google.com/docs/web/setup)、[Auth 持久化](https://firebase.google.com/docs/auth/web/auth-state-persistence)。

历史运行记录：`pnpm build`（含 `tsc -b`）曾通过，Vite 提示部分 chunk 大于 500 kB；该记录不代表当前工作区或线上业务验收。

2026-09-07 本轮复核：CLI 确认上述 Web 应用处于 ACTIVE 状态，重新下载的 SDK 配置与本地 JSON 各字段一致。`src/firebase.ts` 单独 TypeScript 检查通过。完整 `pnpm build` 在类型检查阶段被 `src/finance/FinancePage.tsx` 的错误阻塞，包括缺失 `NewOrder`、`OrderDetail` 及查询参数类型不匹配；本轮未修改资金页面。现有登录仍调用旧接口，真实 Firebase 登录、Go 权限与 MFA 均未验收。

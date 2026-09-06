# Firebase 登录与 Go 授权

更新日期：2026-09-07。依据当前 main 源码整理；已发布版本与历史测试证据见 [部署记录](../../deploy/README.md)，不代表本次重新完成用户登录验收。

## 项目与入口

目标登录域名更新为下表地址。本次仅更新文档，尚未切换 Cloudflare/DNS 或 Firebase authorizedDomains；完成这些配置并验证后才能将新域名视为可用登录入口。现有源码与测试中的旧域名需在域名实施任务中同步调整。

Firebase 项目 `edi-gws-20260309-hk`（Identity Platform），Web 应用显示名仍为 `moventra-card-bin`，App ID 为 `1:666750758771:web:c38e91069fc64737db5f06`。这些实际云端标识不随源码仓库改名。

| 应用 | 目标登录地址 | 登录方式 | 业务入口 |
| --- | --- | --- | --- |
| 客户端 | https://moventra.me/login | 邮箱密码、Google | `/portal` 个人查询、`/portal/security` 安全设置 |
| 运营后台 | https://admin.moventra.me/login | 批准的运营邮箱密码、MFA；无 Google | `/session` 身份、授权范围及只读查询 |

两端是独立构建、独立命名 SDK 实例和内存会话；共享 Firebase 身份项目，不是独立用户库、tenant 或 token audience。刷新页面需要重新登录。

## 认证与授权顺序

1. 后台先按 `VITE_ADMIN_LOGIN_EMAILS` 检查邮箱；去空格并转小写，缺少列表时全部拒绝。不允许的邮箱在 Firebase 密码请求之前被拒绝，不进入 MFA。
2. Firebase 完成密码或客户端 Google 身份验证；已绑定 TOTP 时完成挑战。
3. `packages/shared/src/auth/liveApi.ts` 获取 ID token，只发送到同域 Go 精确路径；不传给旧接口或 Demo。
4. Go 校验 Firebase token、撤销状态、邮箱验证、本地 users 状态和主体/资源关系。前端邮箱列表、角色或自报 UID 不能授予权限。
5. 后台等待 Go 确认 operator；拒绝或异常时退出 Firebase 并清空用户。MFA 未完成不返回 staffScopes，业务读取仍逐请求核验 MFA 与指定客户资源授权。

邮箱验证/MFA 设置 UI 不表示运营业务访问已放行。当前运营授权仅 `accounts:read`、`transactions:read`，不是全局超级管理员。客户端身份查询不暴露运营范围；两端网关拒绝对端业务接口，后台拒绝自助注册接口。

## 注册、密码和 MFA

客户端 `/register` 是 UI 预览，仅验证格式，不上传或保存申请。已验证的 Google 用户在 Go 返回 `403 registration_required` 时进入独立资料补全：可为当前 UID 关联密码，随后 `POST /api/v1/register` 幂等创建本地 users。停用用户、网络失败和其他错误不进入注册；注册不创建客户主体、账户、成员或运营权限。

已存在用户正常进入个人查询。受控开通命令见 [账户模型](../../services/api/docs/account-model.md)；个人主体创建和运营客户范围授权是不同操作，必须使用明确身份并获得对应授权。

密码重置和邮箱验证由持有人在页面自行请求邮件并完成。TOTP 绑定后按页面提示等验证码刷新，再重新登录；没有自助绕过 MFA 的恢复入口。真实密码、验证码、验证器密钥不写聊天、文档或仓库。后台获授权记录不能替代持有人的邮箱验证和 MFA 登录验收。

## 配置与常规检查

公开 Web SDK 配置为 `packages/shared/src/config/firebase.web.json`；Admin SDK 凭据通过仓库外 Secret File 注入 Go。`firebase.json` 与 `deploy/firebase/configure-auth.mjs` 用于 provider、域名、TOTP 和邮箱隐私配置；运行脚本会修改云项目，需对应授权，不能作为普通本地检查执行。

从仓库根目录：

```bash
pnpm typecheck
pnpm build:client
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm build:admin
pnpm test
bash services/api/scripts/test-postgres.sh
```

Go 新契约代理由 `packages/tooling/vite.ts` 配置，`VITE_GO_API_PROXY_TARGET` 默认 `http://127.0.0.1:8870`。生产采用同域 Bearer 转发，无 Cookie 会话交换，不将历史 HttpOnly Demo 合同当作现有实现。

## 可选真实 Firebase 验证

以下测试会创建并清理云端临时用户，需先获得该项目测试授权；不是 `pnpm test` 的组成部分。脚本通过 `gcloud auth print-access-token` 使用当前 gcloud 身份管理测试用户，因此需安装 gcloud 并确保该身份拥有目标项目的测试用户管理权限。`GOOGLE_APPLICATION_CREDENTIALS` 单独供 Go Admin SDK 验证使用，不能替代脚本的 gcloud 登录；本机 PostgreSQL 客户端和 `/tmp` socket 也需可用。

```bash
RUN_LIVE_FIREBASE_TESTS=1 \
FIREBASE_PROJECT_ID=edi-gws-20260309-hk \
GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/firebase-reader.json \
node tests/frontend/firebase-live.mjs
```

真实签名/TOTP 脚本配合全新本地 PostgreSQL 测试库，不写生产业务库。`tests/frontend/firebase-deployed.mjs` 另需 `RUN_DEPLOYED_AUTH_TESTS=1`，验证未开通临时身份经过线上网关和 API 被拒绝；仍会创建云端临时身份。执行前检查脚本所需环境和清理逻辑，勿将只读运行服务账户当作身份管理账户。

历史记录包含真实 Firebase/TOTP 隔离联调、后台客户端邮箱提前拒绝、线上无授权身份拒绝；Google 本人账号选择/密码关联/完整注册及指定管理员完整业务登录没有新的验收记录。

官方参考：[TOTP MFA](https://firebase.google.com/docs/auth/web/totp-mfa)、[Token 验证](https://firebase.google.com/docs/auth/admin/verify-id-tokens)、[配置 API](https://cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig)。

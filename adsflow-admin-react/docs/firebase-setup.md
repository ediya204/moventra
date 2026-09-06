# Firebase 登录与 Go 授权

2026-09-07：邮箱密码登录、TOTP 绑定/挑战、密码设置邮件、邮箱验证与真实 Go 身份查询已实现。真实 Firebase + 本地隔离 PostgreSQL 验证通过；生产发布记录见 [部署记录](../../deploy/README.md)。

项目 `edi-gws-20260309-hk`（Identity Platform）；Web 应用 `moventra-card-bin` / `1:666750758771:web:c38e91069fc64737db5f06`；正式登录 `https://moventra.apexisnetworking.work/login`，登录后的基础工作台 `/session`。

## 使用流程

管理员通过受控 CLI 开通 Firebase UID 对应的本地用户。身份开通不自动创建个人/企业主体、账户、资金服务或运营数据权限，不存在全局管理员旁路。

新账户在“设置或找回密码”请求邮件，自行设置密码。登录后若邮箱未验证，发送验证邮件并完成验证，再刷新身份。真实密码与验证器密钥不得发送到聊天或写入仓库。

验证器设置：登录并验证邮箱 → 扫描本地生成的二维码或手动输入密钥 → 输入验证码绑定 → 等待验证码刷新后重新登录。Firebase 会拒绝同一时间步重用绑定验证码。支持选择已绑定的多个 TOTP 验证器；当前不提供短信挑战或自助绕过 MFA 的恢复入口，丢失验证器需独立身份核验。

运营权限由 Go `staff_grants` 控制。MFA 未完成时不返回运营客户范围，运营读取返回 403。完成 MFA 仍需对应客户与资源授权，个人/企业成员关系不会自动变为运营权限。

## 实现边界

`src/auth/liveApi.ts` 每次通过 SDK 获取当前有效 ID token，仅发送给同域 Go 精确路径；不使用旧令牌变量，不向旧接口、Demo 或跨域目的地传递 Firebase token。业务响应 no-store；SDK 仅内存持久化，刷新后需重新登录；退出后在途结果不建立新会话。

正式模式使用 Firebase；只有开发服务器且显式 Demo 模式保留旧 Demo 登录。生产 `/portal` 和旧工作台路由转向已接入的 `/session`，避免登录后继续使用旧接口或模拟业务。原型源码与本地 Demo 保留，其他页面逐项接入 Go 后再开放。

Go 检查签名、issuer/audience、过期、撤销、邮箱验证、本地用户状态、成员与运营授权。仅验证成功的 Firebase `sign_in_second_factor` 为 `totp` 或 `phone` 才视为 MFA；客户端自报角色或 `mfa` 不作授权依据。

## 配置与验证

### Google 登录（2026-09-07 本轮新增）

Firebase CLI 已在 `edi-gws-20260309-hk` 成功启用 Google provider（品牌 Moventra，支持邮箱 `ediyanghk@gmail.com`），保留邮箱密码入口。正式模式登录页新增 Google 弹窗按钮，使用账户选择器；弹窗 resolver 显式传入，仅内存保存 Firebase 会话。不读取或保存 Google Access Token，不申请额外 Google API 权限。

Google 登录复用邮箱登录的 TOTP challenge 处理和 `/api/v1/me` 授权查询。Google 验证不代表本地业务开通，也不代表运营 MFA 已满足；不自动写入用户、主体或 staff_grants。取消、弹窗拦截、未授权域名、provider 未启用及账号方式冲突均有错误提示，账号冲突不自动合并。

本轮 `pnpm build`（含 TypeScript）通过，浏览器确认本地 `/login` 显示 Google 按钮、点击进入等待状态。内置浏览器未暴露 OAuth 弹窗，未完成真实 Google 账号选择、回调和 MFA 联调；不能视为登录验收。Firebase provider 配置已生效，前端新增代码尚未部署；既有文档中的真实邮箱/TOTP 测试属于历史证据，本轮未重跑。

`firebase.json` 保存邮箱密码 provider；CLI 部署后运行 `node deploy/firebase/configure-auth.mjs` 合并域名、启用 TOTP（相邻窗口 1）与邮箱枚举保护。脚本不打印包含密码哈希签名材料的完整项目配置，不覆盖其他 provider。

常规检查：前端 `pnpm build`；后端 `bash scripts/test-postgres.sh`、`go vet ./...`。

真实联调需指定项目测试身份管理权限与本地 PostgreSQL：

```bash
RUN_LIVE_FIREBASE_TESTS=1 \
FIREBASE_PROJECT_ID=edi-gws-20260309-hk \
GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/firebase-reader.json \
node adsflow-admin-react/tests/firebase-live.mjs
```

脚本创建 `@example.invalid` 临时 Firebase 用户，完成真实密码/TOTP 登录，使用真实 Go verifier 和全新本地 `adsflow_test_*` 库验证 16 项；finally 清理自身测试身份与数据库。没有短信/邮件发送或真实渠道数据。token/密钥只放内存或仓库外 0600 临时文件，不打印。

本轮 16 项真实联调、既有 24 项数据库子用例与认证提前拒绝、独立依赖前端构建通过。账户持有人的密码设置、邮箱验证与本人验证器绑定需要本人完成，测试用户通过不能替代本人验收。

官方依据：[TOTP MFA](https://firebase.google.com/docs/auth/web/totp-mfa)、[Token 验证](https://firebase.google.com/docs/auth/admin/verify-id-tokens)、[配置 API](https://cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig)。

## 2026-09-07 Google 登录后注册分流（本地新增，未部署）

已存在的有效本地用户继续进入 `/session`，运营仍要求 MFA 和资源授权。已验证 UID 不存在时 `/api/v1/me` 返回 `403 registration_required`，进入姓名/密码补全表单；停用用户返回 `403 user_disabled`。旧 `user_not_enabled`、网络异常和服务错误均不得进入注册。

密码用 Firebase `linkWithCredential` 关联当前 UID，已有密码不覆盖；密码不发送给 Go。设置密码成功但业务创建失败时，下次识别已绑定的 password provider，仅重试业务创建。`POST /api/v1/register` 只收姓名，核验 Firebase token 后按 UID 幂等插入 users；拒绝客户端自报 UID/role、未知字段和多段 JSON。停用用户不重新激活。注册仅创建登录用户，保留 UID、创建时间，不自动创建客户主体、成员、账户、资金服务或运营权限，无数据库结构迁移。

本地 Vite 新契约 `/api/v1/`、`/client-api/v1/`、`/admin-api/v1/` 使用 `VITE_GO_API_PROXY_TARGET`（默认 localhost:8870），与旧后台代理隔离。非 JSON 身份响应明确提示服务异常；仅带 403 的 registration_required 才显示注册表单。

本轮前端构建通过；本地隔离 PostgreSQL race 测试通过，含六并发注册去重、无凭据/伪造身份拒绝、额外授权字段拒绝、禁用不复活及新用户无运营权限。真实 Google 密码关联、生产注册未测试；前端、Go 与网关需要一起发布，此文不代表已部署。

## 独立客户端与运营入口（2026-09-07）

客户端 `https://moventra.apexisnetworking.work/login`，运营后台 `https://admin.moventra.apexisnetworking.work/login`。分别发布 `moventra-web` 和 `moventra-admin`；构建设置 `VITE_SITE_KIND=client|admin`，Firebase SDK 使用独立命名实例和内存会话。共享 Firebase 身份项目，不代表身份库或 token audience 分离；Go 继续独立校验真实授权与 MFA。

后台只开放登录、找回密码与身份工作台路由，无客户自助注册。两端网关阻断另一端业务 API；身份查询仅返回本站适用范围。后台身份查询要求 Go 返回 operator=true，未完成 MFA 不返回 staffScopes，业务查询仍由 Go 强制 MFA 和具体客户权限。前端邮箱判断不承担授权职责。

用户指定的客户端/管理员邮箱是配置意图；本次域名发布未创建或修改真实账户、成员及运营授权。管理员仍需受控开通身份和明确的客户资源授权，并由本人完成邮箱验证与 MFA。

构建发布：

```bash
cd adsflow-admin-react
VITE_SITE_KIND=admin npm run build -- --outDir dist-admin
VITE_SITE_KIND=client npm run build
cd ..
node --test deploy/cloudflare/gateway.test.mjs
node deploy/cloudflare/node_modules/wrangler/bin/wrangler.js deploy --config deploy/cloudflare/wrangler.admin.jsonc
node deploy/cloudflare/node_modules/wrangler/bin/wrangler.js deploy --env production --config deploy/cloudflare/wrangler.jsonc
```

本次两个构建和 9 项网关测试通过。Firebase authorizedDomains 已加入后台域名，保留已有 provider/MFA 配置。未运行新的真实用户 MFA 测试或生产业务验收。

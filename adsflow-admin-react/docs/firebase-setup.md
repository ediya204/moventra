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

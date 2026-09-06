# V1 个人账户发布范围

更新日期：2026-09-07。当前 `main` 为独立客户端、运营后台和 Go API。当前构建入口是 `apps/client` 与 `apps/admin`，产物分别在各自 `dist`，不再用同一个 App 配合 `VITE_SITE_KIND` 构建两端。

## 当前功能

- 客户端登录后由 `/session` 进入 `/portal`，查询授权个人主体的账户与交易；安全设置在 `/portal/security`。
- 团队创建、邀请、角色管理、团队卡片筛选与内部划拨入口已退役；旧团队路径回到个人入口或后台认证入口。
- 后端仍保留 business/memberships 和升级意向申请，企业审核、关联创建、激活与前端企业流程待实现；不会自动改变个人主体或资金归属。
- 后台保留指定客户的 staffScopes、MFA 与审计；客户账号没有运营权限。网关拒绝跨端业务、旧团队和本地 Demo API。
- 历史客户归属和原始数据保留；Demo 模型拒绝退役团队指令，不删除历史资金记录。

## 构建和回归

从仓库根目录执行：

```bash
pnpm build:client
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm build:admin
pnpm test
```

当前测试入口为 `tests/frontend` 与 `deploy/cloudflare/gateway.test.mjs`。历史 17 项通过记录包含团队退役、注册分流、后台准入及网关隔离；不是本次文档编辑重跑结果。

## 发布证据与限制

个人版本运行提交 `c933ce5` 后，目录独立化版本 `be31513` 已发布，具体 Worker/Render 版本见 [部署记录](../../deploy/README.md)。旧共享 App、`dist-admin`、8852 和旧 tests 路径不是现行构建指南。

生产未接入完整卡片、资金、消息、企业或真实金融渠道。本人认证后的完整业务验收与真实渠道验收独立进行；不可用 HTML/构建成功替代。回退前核对当前两端/API版本与契约兼容性，历史记录的“上一版本”只对应当次发布。

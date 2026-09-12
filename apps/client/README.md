# Moventra 客户端

更新日期：2026-09-07。独立入口在 [App.tsx](src/App.tsx)，官网和个人客户端共用此应用；不引用运营应用源码。

从仓库根目录运行 `pnpm dev:client`（127.0.0.1:8853）、`pnpm build:client`；产物为 `apps/client/dist`，部署到客户端 Worker。身份固定为 client，不使用 `VITE_SITE_KIND` 切换应用。共用认证/UI 位于 [packages/shared](../../packages/shared/README.md)。

生产使用 Firebase 邮箱密码或 Google 登录。已开通用户由 `/session` 进入 `/portal`，安全页为 `/portal/security`。查询只展示获授权个人主体的账户与交易，空数据、未关联和失败分别显示；不提供真实卡片或资金执行。

`/register` 仅做表单预览和校验；通过 Firebase 验证的会话遇到 `403 registration_required` 才通过资料补全调用 Go 注册，常见于首次 Google 登录。注册创建登录用户，不自动开通个人主体、企业、资金账户或运营权限。企业模型保留在后端，当前前端为 V1 个人范围。

个人首页、账户与交易页目前各读取默认前 50 条，没有分页界面；数字是已读取记录数。新增运营渠道投影未绑定客户，客户端 transport 和网关禁止读取；DEV 商户 Logo 组件存在不等于正式客户已获得渠道交易。完整说明见 [身份与业务开通](../../docs/business/identity-and-production.md)。

开发 Demo 路由仅在 DEV 且显式 Demo 配置下可用；对应历史 Node/SQLite 服务不在仓库，不能仅启动前端就复现完整旧 Demo。生产不打包 Portal 原型。

参阅 [开发约束](../../AGENTS.md)、[文档索引](../../docs/README.md)、[认证配置](../../docs/frontend/firebase-setup.md)、[部署记录](../../deploy/README.md)。

## 2026-09-13 登录隔离候选

客户登录为 `/portal/login`，旧 `/login` 自动跳转。客户身份使用 `/client-api/v1/me`；管理员角色拒绝进入客户端。保留已上线的开户申请、功能资格和导航；部署依赖角色迁移 004。见[联合发布记录](../../docs/releases/2026-09-13-admin-login-joint.md)。

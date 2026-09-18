# Moventra 客户端

> 2026-09-18：客户端开卡应用与八个BIN目录已发布，真实金融执行仍关闭。当前能力及验证范围见[当前状态](../../docs/current-state.md)和[本次发布记录](../../deploy/2026-09-18-client-issuing-release.md)。下方带日期的历史段落保留当时实施状态。

更新日期：2026-09-07。独立入口在 [App.tsx](src/App.tsx)，官网和个人客户端共用此应用；不引用运营应用源码。

从仓库根目录运行 `pnpm dev:client`（127.0.0.1:8853）、`pnpm build:client`；产物为 `apps/client/dist`，部署到客户端 Worker。身份固定为 client，不使用 `VITE_SITE_KIND` 切换应用。共用认证/UI 位于 [packages/shared](../../packages/shared/README.md)。

生产使用 Firebase 邮箱密码或 Google 登录。已开通用户由 `/session` 进入 `/portal`，安全页为 `/portal/security`。查询只展示获授权个人主体的账户与交易，空数据、未关联和失败分别显示；已支持明确授权的只读卡片和关联交易；资金中心为独立线上测试流程，不提供真实资金执行。

`/register` 仅做表单预览和校验；通过 Firebase 验证的会话遇到 `403 registration_required` 才通过资料补全调用 Go 注册，常见于首次 Google 登录。注册创建登录用户，不自动开通个人主体、企业、资金账户或运营权限。企业模型保留在后端，当前前端为 V1 个人范围。

个人首页、账户与交易页目前各读取默认前 50 条，没有分页界面；数字是已读取记录数。客户卡片通过独立 card-projections 契约读取显式分配范围，不能访问后台 channel-projections；卡片列表按服务端分页，不能与基础账户/交易默认前 50 条的限制混用。完整说明见 [身份与业务开通](../../docs/business/identity-and-production.md)。

开发 Demo 路由仅在 DEV 且显式 Demo 配置下可用；对应隔离 Node/SQLite 服务已恢复，使用 `pnpm workspace:dev` 运行合成数据；仅启动前端不提供业务后端或私有数据。生产不打包 Portal 原型。

参阅 [开发约束](../../AGENTS.md)、[文档索引](../../docs/README.md)、[认证配置](../../docs/frontend/firebase-setup.md)、[部署记录](../../deploy/README.md)。

## 2026-09-13 登录隔离候选

客户登录为 `/portal/login`，旧 `/login` 自动跳转。客户身份使用 `/client-api/v1/me`；管理员角色拒绝进入客户端。保留已上线的开户申请、功能资格和导航；部署依赖角色迁移 004。见[联合发布记录](../../docs/releases/2026-09-13-admin-login-joint.md)。

官网 SEO 实现、验证和 Google 提交步骤见 [官网 SEO](../../docs/frontend/website-seo.md)。`pnpm test:seo` 检查首页索引与应用页面 noindex 边界。

2026-09-18：`/portal/cards`、卡片详情及 `/portal/transactions` 的卡片交易区支持显式分配的只读测试快照。深链 `/portal/cards/:id?connection=...`、`/portal/card-transactions/:id?connection=...`；每页20条、搜索及分页在 URL 保存。绑定不激活资金功能，余额保持未知，新增导入不自动扩大测试授权。见 [客户卡片测试绑定](../../docs/business/customer-card-binding.md)。

## 线上测试钱包

`/portal` 和 `/portal/funds` 新增独立的线上测试余额查询区，仅显示受控配置的测试额度，明确不可提现或充值到真实卡片。见[流程与验证](../../docs/business/online-test-wallet.md)。

正式登录资金中心 `/portal/funds` 已接服务端线上测试资金：USDT/法币充值、报价兑换、提现申请、状态记录和稳定订单详情。需要个人账户已审批启用及独立测试额度；全部属于模拟流程。待确认写请求在当前标签页保存幂等键，网络异常后重试同一请求。见 [流程卡](../../docs/business/online-test-funds.md)。

## 客户端开卡

正式入口 `/portal/cards/new`，订单 `/portal/card-orders` 与 `/portal/card-orders/:id`，新卡详情 `/portal/issued-cards/:id`。费用、最低首充、声明、独立 USD 钱包与失败恢复见[开卡流程](../../docs/business/client-card-issuing.md)。生产是否可支付由服务端资格和执行能力决定。

2026-09-18 资金中心四流程发布准备：开户完成后首次进入充值页才申请 Cregis 客户专属地址；双链与正式账本保持待验收、未激活。见[资金中心](../../docs/business/funds-center.md)。

# Moventra 文档索引与项目现状

工程协作入口见 [Harness](harness/README.md)，文档更新方式见[维护规则](harness/documentation.md)，全部 Markdown 见[自动目录](catalog.md)。

2026-09-18：开发交付遵循 [业务闭环标准](business/delivery-standard.md)。历史静态调查与最新 main 的差异见 [本次同步说明](releases/2026-09-18-local-sync.md)。

更新日期：2026-09-18。静态核对本地 main `89ca9c3` 及已有发布记录；本轮未重新验证线上状态、测试或真实业务。最新运行代码记录见[统一发布](../deploy/2026-09-18-session-consolidation.md)。

正式仓库：[ediya204/moventra](https://github.com/ediya204/moventra)，统一维护 `main`。优先阅读 [全站业务逻辑总览](business/README.md)，快速状态见 [V1 当前功能与接入状态](current-state.md)。隔离 Node/SQLite 服务和 Python 采集工具源码已恢复至 [services/local-workspace](../services/local-workspace/README.md)；真实数据、快照与凭据不随仓库提供。

## 现行域名

官网及客户端为 [moventra.me](https://moventra.me)，运营后台为 [admin.moventra.me](https://admin.moventra.me)。官网根域名已绑定并通过 HTTPS/Chrome 页面验证，`www.moventra.me` 官网与后台登录也已完成绑定及 Chrome 验证，Firebase 已授权三个新域名。实际范围见 [部署说明](../deploy/README.md)。

## 当前能力

完整能力、限制与证据统一见[当前状态](current-state.md)，项目定位与开发思路见[项目说明](../project.md)。当前包含身份与开户、双端授权查询、用户目录、卡片归属、线上测试资金、BIN 目录、普通 Webhook 来源观察及隔离影子账本；这些模块不共同构成真实资金执行系统。

- [后台归属及随机卡名代码发布](../deploy/2026-09-18-session-consolidation.md)
- [BIN 目录发布与发卡关闭边界](../deploy/2026-09-18-bin-catalog-sync.md)
- [普通 Webhook 上线与来源观察](../deploy/slash-webhook-online-2026-09-18.md)
- [Cregis 隔离充值、提现与 OTC](business/cregis-funds.md)
- [线上测试资金](business/online-test-funds.md)
- [项目钱包及逐卡分配](business/project-wallet.md)
- [余额查询与人工出入金（代码已发布，执行未启用）](business/platform-advance.md)
- [卡片详情规划（DESIGN）](business/card-center-detail-plan-2026-09-18.md)
- [Slash 白名单环境与复用规则](integrations/slash-allowlist.md)

## 文档阅读规则

- 当前指南中的命令以仓库根目录为默认，子项目另有说明时以其说明为准。
- DESIGN 是待实施目标；F/S 场景清单不等于当前所有测试已通过。
- 历史档案明确保留当时的数据、端口、代码名称和结果；其中未纳入仓库的脚本不能直接运行。生产构建不打包 Demo 路由。
- 旧文档中的 number 金额、裸来源 ID、团队功能和简化对账式不作为生产规范；按领域文档制定迁移/契约，不通过改写文档宣称代码修复。
- 当前 OpenAPI 的 `servers` 描述仍含旧“未部署”文字，属于已登记文案差异；接口以代码和路径定义为依据，发布状态看部署记录。OpenAPI 文案未在本次变更范围内。

## 全站业务逻辑

- [统一消息中心：自动OTC通知已启用，运营主动发送关闭](business/message-center.md)
- [2026-09-19 生产021/022迁移与统一钱包prepare配置](../deploy/2026-09-19-production-migrations-and-switches.md)

- [业务总览：角色、流程、模块与数据边界](business/README.md)
- [身份、开户与正式访问流程](business/identity-and-production.md)
- [卡片、BIN、归属、交易与同步](business/cards-and-transactions.md)
- [资金、定价、订单、审批及运营](business/funds-and-operations.md)
- [正式页面与接口可达性](business/routes-and-api.md)
- [本轮文档核对与上传范围](releases/2026-09-07-business-docs.md)

## 当前开发、认证与部署

- [Moventra](../README.md)
- [Moventra 开发约束](../AGENTS.md)
- [Moventra 开发总纲](DEVELOPMENT.md)
- [Moventra 客户端](../apps/client/README.md)
- [Moventra 运营后台](../apps/admin/README.md)
- [Moventra 共享前端模块](../packages/shared/README.md)
- [Moventra Go API](../services/api/README.md)
- [账户模型与第一阶段接口边界](../services/api/docs/account-model.md)
- [Go API 验证与历史证据](../services/api/docs/validation.md)
- [Moventra 部署记录](../deploy/README.md)
- [Firebase 登录与 Go 授权](frontend/firebase-setup.md)
- [V1 个人账户发布范围](frontend/v1-personal-release.md)

## 当前主题、品牌与组件来源

- [界面主题与组件约定](frontend/ui-theme.md)
- [Moventra 品牌素材](frontend/brand/README.md)
- [Minimals 来源组件](../apps/admin/src/minimals/README.md)

## 目标规范与待实施契约

- [V1 资金账本与对账规划](domain/reconciliation-v1-plan.md)
- [交易、订单与资金领域规范](domain/transactions-and-funds.md)
- [交易与资金 API 契约草案](api/contract.md)
- [交易与资金验收场景](testing/financial-scenarios.md)
- [Slash 只读接入规范](integrations/slash.md)
- [分析聚合 API 契约（产品验证后选用）](frontend/analytics-api-contract.md)

## 正式卡交易只读接入

- [接口、数据导入与发布边界](releases/channel-projection-2026-09-07.md)
- [商户 Logo](frontend/merchant-logos.md)

## 当前本地业务规范

- [V1 当前功能与接入状态](current-state.md)
- [资金流与运营概览](frontend/operations-overview.md)
- [卡交易时间筛选](frontend/transaction-date-range.md)
- [本次同步验证](releases/2026-09-07-v1-local-sync.md)
- [卡片管理工作台与客户解冻申请（本地实现边界）](frontend/card-management-workspace.md)
- [卡片与交易字段](frontend/card-transaction-fields.md)
- [卡交易抽屉与关联卡详情](frontend/transaction-drawer.md)
- [卡片详情入口修复](frontend/card-detail-navigation.md)
- [全部卡片可用余额列](frontend/card-available-balance.md)
- [卡交易状态分类与颜色](frontend/transaction-status-colors.md)
- [Slash 手动同步](frontend/slash-manual-sync.md)
- [BIN 详情状态管理](frontend/bin-status-management.md)
- [账户目录与详情](frontend/account-directory-ui.md)
- [V1 费率方案归并](frontend/v1-fee-plans.md)
- [字段与接口历史审计快照](audits/site-field-api-audit.md)

## 历史功能与本地实验档案

- [管理总后台：结构与本地实施](frontend/admin-console.md)
- [卡片管理闭环（2026-09-07）](frontend/card-administration.md)
- [卡 BIN 产品目录与客户端开卡](frontend/card-bin-management.md)
- [发卡渠道与 BIN 产品关联](frontend/card-channels.md)
- [客户卡片中心：列表与三级详情](frontend/client-cards.md)
- [客户卡片 CVV：远程获取、临时展示](frontend/client-cvv.md)
- [客户资金中心：USDT 充值、兑换与提现](frontend/client-finance.md)
- [客户端首期实现](frontend/client-portal.md)
- [卡交易流水：双币种消费交付与验收](frontend/cross-currency-delivery.md)
- [跨币种卡消费字段差异与实施顺序](frontend/cross-currency-field-gap.md)
- [数字货币资金工作台（本地隔离实现）](frontend/crypto-finance.md)
- [本地 Demo 快照](frontend/demo-snapshot.md)
- [客户端消息中心](frontend/message-center.md)
- [资金对账与盗刷调查模型](frontend/reconciliation-and-fraud-model.md)
- [收入确认与分析模型](frontend/revenue-model.md)
- [账户与卡片风控统计模型](frontend/risk-analytics-model.md)
- [Slash Demo 场景、记录ID与预期金额](frontend/slash-demo-scenarios.md)
- [Slash 清算 Demo：实施与本地验收](frontend/slash-demo.md)
- [Slash 字段差异与实施顺序（2026-09-06）](frontend/slash-field-gap.md)
- [Slash 真实数据接入现有本地后台](frontend/slash-live-data.md)
- [用户组与开户管理（本地实现）](frontend/user-management.md)

### 2026-09-17 Blnk 本地影子账本

- [架构、流程与契约](integrations/blnk.md)
- [本地运行](../deploy/blnk/README.md)
- [验收与剩余边界](testing/blnk-shadow-2026-09-17.md)

- [Blnk 集成代码发布与激活边界](releases/2026-09-18-blnk-shadow.md)

- [Blnk 私有服务与共享 PostgreSQL 实例](releases/2026-09-18-blnk-private-service.md)
- [Slash / Blnk 调查与实施方案](integrations/slash-blnk-plan-2026-09-18.md)
- [Slash 来源持久化设计](integrations/slash-persistence-design-2026-09-18.md)

- [客户端开卡完整链条](business/client-card-issuing.md)：USD钱包、声明、订单、新卡及本地隔离验收；应用已部署，真实发卡仍关闭。

- [资金中心四流程与真实接入准备](business/funds-center.md)：开户后按需 Cregis 地址、双链、逐卡充提、OTC、零期初及启用验收。

- [客户充值地址标准接入](business/deposit-address-integration.md)：地址复用、回调和入账边界。

- [余额查询与人工出入金](business/platform-advance.md)：人工订单、独立审核与资金预占，真实资金启用边界独立验证。

- [TRC20限额充值真实入账验收](../deploy/2026-09-18-deposit-pilot.md)：指定客户累计最多1 USDT，已完成0.1 USDT闭环及重启核对。

- [卡片当前状态同步](business/card-state-sync.md)：通知回查、定时补查、手动核对及两端共同状态；[上线证据](../deploy/2026-09-18-card-state-sync.md)。

## 资金记录

- [统一资金记录与两端验收](business/fund-records.md)：非消费业务记录、筛选、权限与生产迁移兼容。

# Moventra 运营后台

> 2026-09-18：客户端开卡应用与八个BIN目录已发布，真实金融执行仍关闭。当前能力及验证范围见[当前状态](../../docs/current-state.md)和[本次发布记录](../../deploy/2026-09-18-client-issuing-release.md)。下方带日期的历史段落保留当时实施状态。

更新日期：2026-09-07。独立入口在 [App.tsx](src/App.tsx)，开放 `/admin/login`（旧 `/login` 自动跳转）、`/forgot-password`、`/session`、`/workbench`、`/transactions`、`/cards/:id`；不引用客户端源码。完整流程见 [全站业务总览](../../docs/business/README.md)。

从仓库根目录运行：

```bash
pnpm dev:admin
pnpm build:admin
```

开发地址 127.0.0.1:8850，产物 `apps/admin/dist`。应用身份固定 admin，不使用 `VITE_SITE_KIND` 切换。管理员角色由服务端 users.role 确认，不再使用前端邮箱名单。后台关闭 Google 登录，没有自助注册入口。

Go 确认 UID、有效本地用户、operator、MFA 和指定客户资源授权后才能访问运营数据；拒绝/异常时退出 Firebase 并留在登录页。邮箱验证和 MFA 设置流程不代表已获业务权限。客户端和运营端共享 Firebase 项目，但 SDK 实例、会话、路由和网关分别处理。后台使用标签页会话，刷新后恢复身份并重新校验服务端准入，关闭标签页后结束会话；客户端仍使用内存会话。后台会话调整为本地修改，尚未部署，见 [验收记录](../../docs/business/admin-session-persistence.md)。

[DemoApp.tsx](src/DemoApp.tsx) 仅在 DEV 且显式 Demo 模式加载，生产不打包该路由。完整历史卡片控制、费率和资金原型仍属于 Demo；隔离服务源码已恢复，私有数据库未迁入。正式开户审核、注册目录、测试资金审核及 BIN 目录按下方专题独立接通。正式渠道只读页面另由 Go 提供，不依赖 Demo 路由。

参阅 [开发约束](../../AGENTS.md)、[文档索引](../../docs/README.md)、[认证配置](../../docs/frontend/firebase-setup.md)、[部署记录](../../deploy/README.md)。


## 当前 DEV 业务维护

卡片/交易、BIN状态、内部用户绑定、费率方案和账户目录已按最新本地口径更新，详见 [V1现状](../../docs/current-state.md)。这些页面仍通过 DEV DemoApp 加载，生产入口与产物不包含完整业务原型。本地业务依赖已恢复的 services/local-workspace，真实采集仍需显式私有配置；这些接口不能直接替换正式 Go 契约。

## 资金流与运营概览

通过运营身份和 MFA 验证后进入 `/workbench`，查看已授权 USD 客户交易投影的资金流、活跃度及状态分布。统计周期支持 7/14/30 天，提供精确每日明细及 CSV。渠道投影未并入本统计源，卡片、商户及来源同步指标保持不可用。参阅 [页面与数据口径](../../docs/frontend/operations-overview.md)。

## 正式渠道卡交易

`/transactions` 与 `/cards/:id?connection=...` 读取手动导入的独立渠道投影，除 staff 身份和 MFA 外还要求 `channel_read_grants`。交易每页 20 条，UTC 开始含、截止不含，默认不限日期；刷新只重读导入版本。卡片归属从项目钱包分配或有效测试绑定读取，客户身份还要求 accounts:read；不提供真实资金余额或控制动作。商户 Logo 仅辅助展示，不改变来源身份。业务代码 `0d5158d` 及部署结果见 [独立发布记录](../../docs/releases/channel-projection-2026-09-07.md)，本人登录验收仍待完成；本轮仅整理文档。

## 2026-09-13 联合发布候选

运营总览、渠道交易/卡片详情与开户审批共用本地 DashboardLayout。保留六组菜单，尚未接入的功能禁用。登录统一为 `/admin/login`，后端角色、MFA 与客户范围各自校验。发布依赖增量角色迁移 004，详见[联合发布记录](../../docs/releases/2026-09-13-admin-login-joint.md)。

## 2026-09-13 已有模块恢复

正式新增 `/cards`（服务端分页、名称/尾号/来源状态查询）、`/customers`（已有账户授权）和 `/system/channels`（采集/导入状态）。卡详情可查看此卡交易并返回卡片目录。其余已存在的本地模块菜单标注待迁移；原 Node 服务和 135 项回归已恢复，使用根目录 `pnpm workspace:dev` 可独立复现。生产构建继续排除 Demo 路由。见[恢复清单](../../docs/business/existing-modules-restoration-2026-09-13.md)。

## 正式注册用户目录

`/user-groups/users` 为独立注册用户目录，支持完整登录邮箱查询、分页、邮箱验证与注册状态、客户关联状态。顶部邮箱搜索进入此目录。开户审批和账户目录保持独立；用户角色、MFA 及逐客户业务授权继续校验。仅线上正式模式使用新接口，本地 Demo 用户库不被复制或改为生产连接。

## 注册用户详情

用户目录的“查看详情”和邮箱打开 `/user-groups/users/detail?userId=<本地用户UUID>`；身份尚未注册的行使用 email 查询。详情展示登录与注册资料、客户关联、已授权账户的名称/状态/ID/上级账户，并独立链接开户审批。未申请开户不妨碍查看注册资料。返回目录保留邮箱或页码；账户按客户分页读取，缺授权和读取失败分别展示。

正式测试资金审核入口 `/finance/test-funds`：仅显示逐客户获授权的测试钱包，要求现有运营身份与 MFA。充值先确认、后模拟入账；提现审核与模拟结算分开，未知状态持续预占。审批不调用真实付款接口。见 [流程卡](../../docs/business/online-test-funds.md)。

项目钱包候选：卡列表/详情的分配状态改为读取服务端 assignmentKind（项目钱包分配/历史测试快照/未分配）；字段未返回时显示“归属未查询”，不再硬编码未绑定。不暴露客户邮箱；归属显示代码发布见[统一发布记录](../../deploy/2026-09-18-session-consolidation.md)，项目配置及分配证据见 [流程卡](../../docs/business/project-wallet.md)。

## 2026-09-18 BIN catalog

新增正式 `/card-bins` 管理页与 `/admin-api/v1/card-issuing` 契约；来源目录导入使用 `issuing-admin import-catalog`。未配置价格以空字符串传输、数据库 NULL 保存，与免费 `0` 区分。生产保持真实发卡执行关闭。详见 `docs/business/bin-catalog-sync-2026-09-18.md` 与 `services/api/docs/issuing.openapi.json`。

## 2026-09-18：后台用户归属读取修复（代码已发布）

正式 channel-projections 卡列表、卡详情及交易查询从既有 project_wallet_cards / 有效 customer_card_bindings 读取归属，返回 assignmentKind 与 internal.ownershipStatus/customerId/userId/customerName。后台列表、详情和交易抽屉显示同一用户；新导入保留绑定，客户端原有范围与字段裁剪不变。无新迁移、改绑或资金操作。实现与验收见 [流程卡](../../docs/business/card-owner-display.md)。

## 财务入口增量（2026-09-18，未部署）

正式 /pricing 与 /pricing/products/:productId 接通既有卡产品价格接口，支持客户/组覆盖及恢复继承；/reports 提供已授权 USD 交易投影明细和 CSV。数字货币流水、OTC 与出金审批尚未完成，不改变测试资金边界。见[流程卡](../../docs/business/admin-finance-migration.md)。

## 客户开卡处理（2026-09-18，应用已部署，真实执行关闭）

`/card-bins/customers?customer=UUID&order=UUID&orderPage=1` 新增钱包、分页订单、订单详情和声明证据；与客户端查询同一业务对象，保留独立权限、MFA和到账双人复核。见 [开卡闭环](../../docs/business/client-card-issuing.md)。

## Cregis 隔离运营

已接 `/finance/crypto-flows`、`/finance/withdrawals`、`/finance/otc` 客户授权订单及详情；OTC 配置双向价、提现费和开关。`/system/cregis` 为连接授权来源观察。运营需要 MFA 和独立动作权限。见 [流程与证据](../../docs/business/cregis-funds.md)。

资金运营页新增 TRC20/ERC20 提款费和卡充提费用配置，null 与显式零区分；正式资金仍要求独立权限及验收激活。见[资金中心](../../docs/business/funds-center.md)。

## 余额查询（2026-09-18，代码已发布）

正式后台导航“资金与财务 → 余额查询”：`/finance/balances`、`/:customerId`、`/:customerId/orders/:orderId`。全用户分页及授权范围汇总，详情包含人工出入金、资金流水、关联卡片；无用途字段。读取与动作均要求独立资金权限和运营MFA，无默认授权。金额仅覆盖已登记账本，缺失不填零。代码与016已发布，正式余额查询已接通；运营独立授权待指定，人工资金执行未启用；[FLOW及上线边界](../../docs/business/platform-advance.md)。

## 卡片状态同步

全部卡片与详情使用和客户端相同的当前状态，并保留内部归属显示。详情可提交异步只读回查，要求MFA及渠道授权；交易导入语义不变。参见[流程](../../docs/business/card-state-sync.md)。

生产导航移除测试资金中心，旧地址跳转余额查询；源站及网关关闭生产测试资金API。既有正式查询授权、MFA和资金执行资格保持独立，见[资金流程](../../docs/business/funds-center.md)。

## 正式资金分能力接入（2026-09-18）

余额查询复用正式账本且不启用人工资金写入；保留MFA及独立查询权限。费率页后续可调整用户指定的0.99和零费用。

卡片详情支持启用、停用、注销确认与手动核对；需admin、MFA、渠道授权和该客户账户权限，连接操作开关必须启用。结果待确认时不显示成功，未知结果只核对原卡，不重复发送修改。旧卡和交易历史保留；不再周期查询Slash。详见[卡片操作流程](../../docs/business/card-state-sync.md)。

2026-09-19本地展示调整：正式卡片状态统一为渠道原值与对应图标，不显示核验时间；尚未部署，见[卡片状态](../../docs/business/card-state-sync.md)。

2026-09-19（本地未部署）：后台余额、资金订单、来源记录及隔离原型USDT金额统一两位直接截断，费用配置编辑仍保留原始精度。见[全站规则](../../docs/frontend/ui-theme.md#usdt-金额展示2026-09-19本地未部署)。


2026-09-19 登录界面（本地未部署）：共享 LoginLayout 提供白底品牌插画区与登录表单，原 TOTP 挑战改为居中弹窗；认证方式和服务端准入不变。详见[登录流程](../../docs/business/two-role-login.md#flow-auth-login-ui-001分栏登录与-2fa-弹窗2026-09-19本地未部署)。

## 消息管理（2026-09-19，本地未部署）

运营管理新增 `/operations/messages`，支持本人草稿、1–100位明确客户、预览发布、投递/首次阅读明细及失败重试；MFA、独立消息动作权限与客户accounts:read范围同时校验。没有全员群发或真实客户发送记录；见[流程/配置/验收](../../docs/business/message-center.md)。


## 统一 USD 开卡增量（2026-09-19，本地）

统一开卡后台读取与客户端同一订单和资金中心 USD；旧开卡入金在统一模式下关闭新增及复核，历史记录保留。资格、MFA、禁止自审与核查权限沿用。见 [开卡闭环](../../docs/business/client-card-issuing.md)。

## 2026-09-19 卡片中心发布

正式卡片列表与详情复用共享浅色状态标签，保留渠道原始状态；单卡控制与权限不变。

## 资金记录（2026-09-19，本地未部署）

卡交易流水下新增 `/finance/fund-records`，同源查询并增加客户筛选；各来源授权与运营MFA分别校验。见[流程与验收](../../docs/business/fund-records.md)。

2026-09-19（本地未部署）：资金记录详情改为列表内右侧抽屉，URL保留筛选/分页并支持刷新恢复，旧详情链接兼容。见[抽屉流程](../../docs/business/fund-records.md#flow-fund-records-002详情抽屉2026-09-19本地未部署)。

2026-09-19（本地未部署）：`/session?security=1` 复用密码、邮箱和验证器管理；运营MFA与数据授权不变。见[安全设置流程](../../docs/business/two-role-login.md#flow-auth-security-001账户安全设置2026-09-19本地未部署)。

2026-09-19 用户资金详情本地重排：客户栏、币种/刷新、四项资金摘要与记录标签集中呈现；账本口径展开查看，手机两列摘要和表格横向滚动。原接口与资金动作保持，未部署。见[设计与验收](../../docs/business/platform-advance.md#flow-balance-ui-001用户资金详情排版2026-09-19本地未部署)。


2026-09-19正式人工出入金已启用无需审核：有create/execute权限的运营提交后直接处理；旧待审核单在详情选择“继续处理原单”。线下出金仍须真实付款凭证。见[发布证据](../../deploy/2026-09-19-manual-funds-activation.md)。

2026-09-19 资金与财务全组页面本地重设计：覆盖余额、数字货币流水、OTC、出金审批、费率列表/配置、资金经营报表及关联资金记录抽屉。统一工具栏与金额/状态表达，查询和配置分开，保留原请求及权限。详见[财务工作台流程与预览](../../docs/frontend/finance-workspace.md)；待统一发布。

# 页面、API 与浏览器可达范围

核对日期：2026-09-18。基线为本地 main `89ca9c3` 及现有工作区；静态核对路由、transport、网关与 Go handler，未在线调用业务接口。当前能力及发布证据见[状态摘要](../current-state.md)。历史详细契约保留在[9 月 7 日快照](../releases/2026-09-07-routes-snapshot.md)，不得按其旧路由表认定新接口不可用。

## 应用与入口

客户端和后台独立构建，SITE_KIND 固定；客户端 `/portal/login`，后台 `/admin/login`，各站 `/login` 重定向到本站入口。客户端允许 Firebase 密码/Google 登录，后台按服务端 admin 角色和 MFA 准入，不使用前端邮箱名单。两端共有 Firebase 项目，不意味着共享业务权限。

| 页面 | 当前源码职责 | 能力边界 |
| --- | --- | --- |
| 客户端 `/` 与政策页 | 官网、咨询 POST /api/contact、隐私/条款/Cookie | 邮件受理不代表最终送达；见[咨询发布](../releases/2026-09-07-website-contact.md) |
| `/register`、`/session`、`/forgot-password` | 注册预览、身份分流/资料补全、找回密码 | 预览页不直接创建身份；注册不自动生成真实资金 |
| `/portal`、`/portal/accounts` | 本人个人主体首页、基础账户与交易、测试余额 | 基础账户/交易仍按默认前 50 条读取，不能当全量 |
| `/portal/transactions` | 基础交易及授权卡交易查询 | 两种数据来源分开，不混入资金总计 |
| `/portal/cards`、`/portal/cards/:id`、`/portal/card-transactions/:id` | 卡片及关联交易；connection 参数定位来源连接 | 按客户显式分配范围、服务端分页；真实资金操作未开放 |
| `/portal/funds` 及 deposit/fiat-deposit/exchange/withdraw/history/orders/:id | OnlineFunds 测试充值、兑换、提现及订单 | online_test，服务资格和独立测试额度/授权；不是真实付款 |
| `/portal/settings`、`/portal/security` | 开户/个人设置及认证安全 | 功能资格不等于每个业务后端已接通 |
| `/portal/messages`、`/portal/support`、`/portal/cards/new` | 保留导航或产品入口 | 不根据路由或按钮推断消息、工单或真实发卡闭环 |
| 后台 `/workbench`、`/session` | 授权 USD 概览、身份与安全 | 概览不自动纳入 Slash 渠道金额 |
| `/transactions`、`/cards`、`/cards/:id`、`/system/channels` | 渠道交易、卡列表/详情与连接状态 | MFA、连接权限；客户身份额外 accounts:read；无真实卡控制 |
| `/customers`、`/user-groups/users`、`/user-groups/users/detail` | 已授权账户目录、注册用户与详情 | 用户基础目录与逐客户金融数据权限分开 |
| `/onboarding`、`/onboarding/:customerId` | 客户开户审核与服务状态 | 独立 onboarding:review，审批不自动生成资金 |
| `/finance/test-funds`、`/finance/test-funds/:customerId/*` | 测试资金查询/审核 | MFA 和独立逐客户测试审核授权 |
| `/card-bins/*` | 供应商、产品、价格与审计 | 目录操作独立权限；真实发卡执行保持关闭 |

静态依据：[客户端 App](../../apps/client/src/App.tsx)、[ClientHome](../../apps/client/src/portal/ClientHome.tsx)、[后台 App](../../apps/admin/src/App.tsx)。页面存在不等于对应生产服务已启用；详情能力还须按对应 FLOW 验收。

## 请求链与权限

浏览器 → shared transport → 同域 Cloudflare 精确白名单 → Go handler → 角色/主体/资源授权 → PostgreSQL 与审计。客户端禁止后台 surface，后台禁止客户端 surface 和注册；禁止把旧 /local-slash-demo 或候选 financial 路由用通配代理接到正式 Go。

| API 范围 | 方法/职责 | 授权或运行限制 |
| --- | --- | --- |
| `/api/contact` | POST，Cloudflare 邮件接口 | 同源、限流、字段校验、固定收件人；不经过 Go/Firebase |
| `/api/v1/register` | POST，创建本地用户 | 已验证 Firebase 身份，仅客户站；不自动授予运营权限 |
| `/client-api/v1/me`、`/admin-api/v1/me` | GET，本站身份与范围 | Go 校验 customer/admin；旧 `/api/v1/me` 保留兼容 |
| `/{surface}-api/v1/customers/{id}/accounts`、`transactions` | GET，基础投影 | 客户主体关系或运营逐客户权限/MFA |
| 同前缀 `onboarding` | GET/POST，申请/审核/服务状态 | 客户所有权与运营 onboarding:review；见[开户资格](../frontend/onboarding-feature-access.md) |
| `/admin-api/v1/ops/overview`、`/admin-api/v1/users` | GET，概览/注册目录 | admin/MFA；金融关联仍按逐客户授权 |
| `/admin-api/v1/channel-projections` 及连接内 cards/transactions 列表/详情 | GET，已导入来源查询 | 独立连接授权/MFA；身份字段另校验客户权限 |
| `/client-api/v1/customers/{id}/card-projections` 及连接内 cards/transactions | GET，客户授权卡片查询 | 逐卡分配、连接与来源范围，不镜像后台 DTO |
| 客户前缀 `test-wallet`；双端前缀 `test-funds`、`test-funds/orders/{id}` | GET，测试额度/余额/订单 | 独立测试数据与权限 |
| 双端前缀 `test-funds/commands` | POST，模拟资金命令 | UUID 幂等键；后台独立审核权限；不访问真实资金通道 |
| 双端前缀 `ledger` | GET，shadow 快照 | 显式模块配置、客户归属/独立 ledger grant；不是已启用的生产余额 |
| `/admin-api/v1/card-issuing/*` 与客户范围 card-issuing | 精确资源组合 GET/POST | 目录可用性与 issuing 执行分别判断；[机器契约](../../services/api/docs/issuing.openapi.json)及[目录流程](bin-catalog-sync-2026-09-18.md) |
| 客户前缀 `business-upgrade` | GET/POST，企业升级意向基础 | Go/网关保留；V1 正式页面未提供完整企业办理流程 |
| Go `/webhooks/slash` | POST，RSA/SHA256 验签及来源收件箱 | 不用客户 Bearer；直达 Go 的通知入口，不是浏览器业务代理 |
| Go `/healthz`、`/readyz` | GET，进程/指定迁移校验 | Worker 不代理；静态 HTML 200 不能当作 API 就绪 |

`surface` 为 client/admin，表中权限不是通配授权。issuing handler 与网关还校验资源、方法、ID；代码中存在订单或恢复端点不表示生产执行服务已初始化。主 API 当前不注入 issuing Service，生产发卡 Worker 未启用。

依据：[Go 路由](../../services/api/internal/api/server.go)、[issuing handler](../../services/api/internal/api/issuing.go)、[启动配置](../../services/api/cmd/api/main.go)、[网关](../../deploy/cloudflare/gateway.mjs)、[issuing 网关](../../deploy/cloudflare/issuing.mjs)、[liveApi](../../packages/shared/src/auth/liveApi.ts)。

## 查询、状态与恢复

- 基础客户交易沿用正数 amountMinor 字符串、direction、currency/scale；不被渠道有符号 amountCents 或 financial 草案替换。
- 渠道查询按连接和当前 revision；分页、筛选、总数在服务端计算。cardId、cardStatus、detailedStatus、keyword、from/to 等参数的具体适用范围以 handler 为准；详情和连接列表不接收列表参数。
- 来源日期查询 `[from,to)`，UTC 时点；概览按香港自然日，不能直接逐日混比。未知日期、范围覆盖与来源时间分别表达。
- 版本变化可返回 409；重新读取连接后查询。详情可能读取更新后的当前版本，不承诺多次请求固定同一旧快照。刷新不会触发上游采集。
- 主体、连接、卡片和父子资源关系由服务端校验。无权限、不存在、获取失败、未配置、零值分别表达；审计失败不返回受保护数据。
- 超时的写请求查询原订单或复用同一幂等键；不能从 HTTP 200 或审批通过推断资金完成。
- `readyz` 当前检查 001–005、007、011、012，ledger 启用时加 006；不覆盖全部模块迁移，也不验证 Slash/Blnk 实际可用性。见[实现](../../services/api/internal/database/runtime.go)。

## 验收边界

当前工作区后台会话恢复改动尚未部署；SDK 恢复仍等待 Go 准入，见[专题](admin-session-persistence.md)。本页只做静态核对，未用真实登录、MFA、渠道或生产数据库复验。路由增删须同步本页、所属 README、机器契约/白名单及相应流程测试，按[维护规则](../harness/documentation.md)交付。

## 2026-09-18 财务入口候选（未部署）

新增 /pricing、/pricing/products/:productId 与 /reports，分别复用既有 card-issuing 产品/价格接口和 ops/overview；不新增 API、迁移或授权。参数、数据范围和验证见[流程卡](admin-finance-migration.md)。

## 客户端开卡增量（2026-09-18，应用已部署）

`/portal/cards/new` → `/portal/card-orders/:id` → `/portal/issued-cards/:id`，订单列表 `/portal/card-orders`；后台 `/card-bins/customers?customer=UUID&order=UUID&orderPage=1`。沿用 card-issuing 契约，新增只读产品详情、terms、cards列表/详情，提交强制版本化声明；金额/状态/权限和实际验证见 [开卡流程](client-card-issuing.md)。

## Cregis 隔离资金路由

客户 `/portal/crypto` 与 `/portal/crypto/orders/:id`；后台 `/finance/crypto-flows`、`/finance/withdrawals`、`/finance/otc` 及对应 `/orders/:id?customer=:id`；来源 `/system/cregis?connection=:id&event=:uuid&page=0`。query 保留标签、状态和页码。来源详情独立鉴权查询；原测试资金与 USD 报表保持独立。见 [FLOW](cregis-funds.md)、[机器契约](../../services/api/docs/crypto.openapi.json)。

## 资金中心四流程（2026-09-18，代码已部署）

`/portal/funds` 总览；`/deposit`、`/fiat`、`/withdraw`、`/exchange` 四操作；`/history` 与 `/orders/:id` 完整历史和深链。`/portal/crypto` 兼容同一页面，旧测试历史保留 `/portal/test-funds/history`。调用独立 crypto API，不把 online_test 改成正式余额。开户完成后进入充值页才发地址请求。transport、网关、Go 路由均增加网络/逐卡报价、订单与最近 5 条；详见[FLOW](funds-center.md)。

## 余额查询与人工出入金（2026-09-18，代码已发布，真实执行未启用）

| 入口 | 关系与接口 |
| --- | --- |
| 后台资金与财务 → `/finance/balances` | 全用户分页与筛选汇总；GET `/admin-api/v1/balances` |
| `/finance/balances/:customerId` | 人工出入金/资金流水/关联卡片；GET `/admin-api/v1/balances/{customerId}` |
| `/finance/balances/:customerId/orders/:orderId` | 同客户订单深链、审批及恢复；后台 scoped manual-funds 接口 |
| 客户资金中心 → `/portal/funds/manual` 及 `/orders/:orderId` | 本人只读记录；client scoped manual-funds 接口 |

新页面继承既有正式认证、MFA、站点隔离及主题；具体客户read与动作授权独立检查。无用途字段、不直接覆盖余额。接口清单及现阶段未完成的真实资金条件见[FLOW-PLATFORM-ADVANCE-001](platform-advance.md)。

## 卡片同步补充（2026-09-18）

我的卡片/全部卡片及详情读取同一个当前状态，显示每卡核验时间与异常提示；详情增加“向渠道核对状态”，异步提交，页面每15秒刷新（后台标签页暂停）。关联交易仍按原导入范围。接口、授权及上线阶段见[卡片同步](card-state-sync.md)。

## 生产资金展示路由（2026-09-18）

客户端首页正式钱包及资金中心复用 GET crypto，缺失账户显示尚未开通。生产配置拒绝 test-wallet/test-funds API（404），旧 `/portal/test-funds` 及子路径跳转 `/portal/funds`，旧运营 `/finance/test-funds` 及子路径跳转 `/finance/balances`。隔离测试实现和历史数据保留，不在生产导航展示。限定充值服务只开放正式账本读取，不因页面切换开启提款、兑换或卡片充提；见[发布证据](../../deploy/2026-09-18-production-funds-view.md)。


## 2026-09-19 卡片中心发布候选

卡片中心沿用card-projections查询链；keyword/cardStatus服务端筛选，cardSort仅本页排序。来源与页码随详情返回保留，不新增API、金融写操作或权限。

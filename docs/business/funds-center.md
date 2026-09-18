# 资金中心四流程与正式接入准备

2026-09-18，本地 `main` 基线 `1ed842a` 及未提交增量。用户已恢复完整方案；本批授权页面、双链、渠道与正式账本接入准备。生产迁移、正式账本激活、部署和真实资金验证须另列具体变更、金额取得授权。初始实现阶段均未执行；后续已按用户“部署”指令发布代码，正式迁移、资金激活和真实资金验证仍未执行。保留并行 Cregis 隔离来源及开卡模块，不迁入旧测试额度。

## 差异与兼容

原 `/portal/funds` 为 online_test 申请式充值。现改为 USDT 充值、法币充提、USDT 提款、OTC 四入口，总览和完整记录独立；旧 online_test 历史在 `/portal/test-funds/history`，不混入新余额。`/portal/crypto` 兼容新页面；后台保留原独立审批、费率、来源查询。继承 MUI 主题，不改开户或敏感卡字段。

**地址时机是开户审核通过且服务已启用之后，客户首次进入 USDT 充值页，再由服务端请求 Cregis 创建客户专属地址。开户完成本身不创建地址。** 客户＋资金范围＋网络持久唯一；再次进入/刷新复用。切链先移除旧地址与二维码；前端只编码服务端地址，不生成链上地址。地址创建超时未知不盲目重发。

## FLOW-FUNDS-DEPOSIT / CARD / WITHDRAW / OTC

| 必填项 | 实现及验收口径 |
| --- | --- |
| 起终点 | 充值：开户完成→进入充值页→Cregis 地址→回调持久化→链上最终性核验→入账；卡充提：选本人可操作卡→报价→预占→渠道额度确认→分户结算；提款：网络/地址/金额→报价→预占→运营批准→Cregis 出金→核验/结算；OTC：输入卖出→60 秒报价→确认→双资产分录完成 |
| 页面关系 | `/portal/funds` 总览；`/deposit`、`/fiat`、`/withdraw`、`/exchange`；`/history?kind=...&status=...&cardId=...&page=...`；`/orders/:id` 独立恢复。业务页服务端倒序 5 条；完整记录 20 条/页。详情返回保留来源路径 |
| 身份 | customerId、namespace、订单 UUID；地址按 connection/project/network/customer 隔离；卡按 connection/externalCardID 绑定正式分户，当前归属再次校验 |
| 数据权威 | Cregis 地址与渠道事实、TRON 固化节点及 Ethereum finalized/canonical receipt、Blnk 余额引擎、PostgreSQL 持久请求/配置版本/审计；Slash 额度不是资金余额 |
| 接口链 | CustomerFunds→cryptoApi/cryptoContract→Cloudflare crypto 白名单→Go cryptoAPI→cryptofunds→crypto-worker→Cregis/链节点或 Slash→ledger/Blnk；机器契约 [crypto.openapi.json](../../services/api/docs/crypto.openapi.json) |
| 状态和动作 | 提款 reserving→pending_review→processing→completed；明确失败 releasing→failed，未知 unknown 保留预占；审核、渠道、链上、记账分别显示。卡未知额度结果不结算；OTC 最后到账步骤完成才 completed |
| 跨端 | 客户订单、运营详情共享服务端状态，页面可见时轮询；超时 sessionStorage 保存原幂等键及请求体。金额/方向/网络变化废弃报价，网络和地址同时绑定提款报价 |
| 授权 | 客户本人、approved/active；运营 MFA 和独立 read/review/configure/recover 授权；禁止自审。卡片绑定、地址、订单不可跨客户；测试授权不迁入正式范围 |
| 异常恢复 | 固定 Blnk reference 重放；Cregis 先存持久提交记录，已有 cid 只查原单，丢失 cid 等待匹配回调/人工核查；回调版本去重与经济事件去重分开；未知不创建替代出金单 |
| 规则 | 见[领域规则](../domain/transactions-and-funds.md)和[验收场景](../testing/financial-scenarios.md)；OTC 无平台库存拦截；USD 2 位、USDT 6 位最小单位整数字符串 |
| 本批限制 | 真实渠道与正式账本未验收，全部正式能力默认关闭；独立开卡账本仍独立，未自动把开卡余额或已有卡资金认领到本账本 |

## 配置与启用准备

新增 `015_funds_flows.sql`：允许独立 live namespace，增加地址任务、持久渠道请求、正式卡分户登记和最近记录索引。迁移不赋予额度、不产生期初资金、不改变旧测试订单。必须先在隔离环境演练，再按独立授权执行正式迁移。

API 与 Worker 必须使用同一 namespace、连接及配置。正式构造器要求 `LEDGER_MODE=live`、`BLNK_NAMESPACE=live_...`、`CONFIRM_ZERO_OPENING_LEDGER=yes`、`FUNDS_LIVE_ACTIVATION=approved`、`CREGIS_SOURCE_ENABLED=true` 和既有 Blnk/Cregis 服务端配置。另有 `FUNDS_CALLBACK_ORIGIN`（HTTPS origin）及 `FUNDS_CERTIFICATION_FILE`。

验收文件字段为 `evidenceRef`、`ZeroOpening`、`AccountingAccepted`、`RecoveryVerified`、`ReconciliationVerified`，以及 `networks` 中的 `network/chainId/tokenId/contract/nodeUrlEnv/deposit/withdraw`。必须同时列 TRC20（chainId 195）与 ERC20（chainId 1），USDT tokenId/合约须从实际项目能力核实；节点环境变量须以 `FUNDS_` 开头。此文件是已取得验收证据的引用，不能靠填 true 替代真实验证，也不能把 fixture 地址、价格、费用用于正式配置。

费用在后台显式保存版本：`networkFees.TRC20/ERC20`、`cardDepositFeeMinor/cardWithdrawFeeMinor`；null 未配置，0 免费。旧 `withdrawalFeeMinor` 仅 shadow/TRC20 兼容，live 不回退使用。OTC 两个方向独立价格、60 秒报价、保存价格及配置版本，修改配置使未提交旧报价失效。OTC 不另收手续费；两资产清算对手账户保留可追踪敞口。

正式钱包和卡账户零期初。卡必须先通过受信服务端 `crypto-worker enroll-zero-card` 独立登记；命令输入 CustomerID/Connection/ExternalCardID/EvidenceRef，只接受本人明确归属、来源零额度、无授权占用且无已入账历史的新卡。非零存量卡拒绝，不生成补余额分录。

可选 `FUNDS_SLASH_CERTIFICATION_FILE` 要求 Connection/Entity/Account/KeyEnv/EvidenceRef，以及 ExclusiveControl/CollectiveLimitVerified/AuthorizationCoverageVerified/RecoveryVerified/LimitEnforcedBeforeAcknowledgment/PostLimitReadConsistent。这些是**待真实环境证明的条件**：额度修改返回前必须已经阻止超额新授权，修改后的交易查询必须覆盖此前已接受的授权。公开接口形式本身不足以证明这两个条件；未取得证据时不得配置/启用卡充提。

Slash 适配仅支持已核验的 collective utilizationLimit，V2 或未知状态拒绝；只修改相关额度且保留其他规则。完整分页双次扫描不一致、截断、未知状态均关闭可操作性。30 秒以上的占用快照不可报价；卡转钱包在降额确认后再同步消费/退款和复核占用，失败保持在途。重复消费/退款使用固定经济键，不重复影响余额。不得以这些本地检查代替上述渠道一致性验收。

## 恢复与待启用验收

- 地址任务 `queued→submitting→completed/unknown`。首次申请结果未知，或渠道成功但本地绑定未落库时，停止自动创建；当前没有已验收的按 alias 自动找回地址接口。须取得 Cregis 原任务归属证据后实施受控恢复，不手工猜地址、不直接把任务退回 queued。此项仍是正式启用前恢复演练项。
- 提款有 cid 时轮询原单；回调可以补回丢失 cid，再以查询和链上结果确认。没有 cid 且没有回调时保持预占；不调用第二次付款。正式启用前需验证渠道丢响应、回调缺失时的人工检索与恢复。
- 钱包、卡分户、预占、费用、对手账及渠道总账须完成独立对账。现有实现保存逐步 reference 与证据，但不宣称已通过真实三方对账或全量历史完整性验收。
- 卡源分页上限 100 页、一次最多同步 20 卡，超过覆盖能力关闭办理。真实速率/吞吐、授权延迟、额度并发及恢复必须按项目实际配置验收。
- 上线必须包含零期初、两条链、实际二维码/复制、卡额度联动、消费退款、未知恢复和对账证据。未通过能力保持关闭；生产迁移/激活/真实金额另授权。

## 本批证据（2026-09-18）

| 维度 | 结果 |
| --- | --- |
| 设计/代码 | 四入口、按客户按链延迟生成地址、二维码/复制、逐卡充提、网络提款报价、60 秒 OTC、最近 5 条/详情与双链适配已接线并发布代码；正式资金保持关闭 |
| 自动化 | `NODE_OPTIONS=--experimental-strip-types pnpm test` 122 项通过；两端 `pnpm typecheck`、`pnpm build` 通过；`go vet ./...` 通过；`test-crypto.sh` 隔离 PostgreSQL＋本地 fixture 通过。新增 live 构造器测试使用假的渠道及链证明，不能视为真实渠道验证 |
| 新增场景 | 开户/不可用网络不创建地址、首次进入请求一次、刷新复用、切链清旧二维码；报价方向/地址/网络绑定；两链请求独立、重复回调单次入账、零初始 USD、未知出金不重复发送；逐卡转入转出、占用/并发阻断、消费退款重复事件；Ethereum 错链/合约/金额/最终性/重组/歧义拒绝；Slash 额度写响应丢失后读回、不重复调额、保留其他规则、占用变动/未知状态拒绝 |
| 浏览器 | 本地合成身份＋真实 CustomerFunds/transport＋隔离 Go：1.234567 USDT→1.20 USD 订单 `2c5ca4fc-…` 完成、刷新详情仍已入账；USD→USDT 报价、60 秒到期后确认按钮禁用、OTC 最近 5 条、四页路由及 390px OTC 布局检查。卡列表为空与未启用充值网络明确提示 |
| 二维码组件 | 实际 QRCodeSVG 服务端渲染＋OpenCV 解码，两条合成链地址均与编码输入精确一致；这是组件产物检查，不是真实 Cregis 地址或浏览器扫描验收 |
| 未完成浏览器项 | 未使用真实 Cregis 地址，实际二维码解码和系统剪贴板未验收；真实卡选择、两端正式身份完整端到端及全部移动布局未验收。组件测试不是这些浏览器证据 |
| 真实渠道 | 未调用 Cregis/Slash 金融写接口；未在本批完成真实双链、卡授权时序及对账验收 |
| 部署 | 代码 9079821 已发布 API 和两端站点，29 项 HTTP 检查及 8 份资源比对通过；未执行生产 013/015、未激活账本。见[发布记录](../../deploy/2026-09-18-funds-center-release.md) |

复现：`DEVELOPER_DIR=/Library/Developer/CommandLineTools services/api/scripts/test-crypto.sh` 创建和清理自身本地测试库。`CRYPTO_BROWSER_PREVIEW=1` 配合 `tests/frontend/crypto-browser-preview.mjs` 为合成身份浏览器辅助，不进入正式构建。此前真实本地 Blnk 记录见[隔离资金证据](cregis-funds.md)，本批未据此追认真实 Blnk 重跑。

官方依据：[Cregis WaaS](https://developers.cregis.com/en/waas-quickstart-30min)、[充值通知](https://developers.cregis.com/en/reference/waas-api/depositCallback/)、[出金通知](https://developers.cregis.com/en/reference/waas-api/payoutCallback/)、[Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/)、[Slash 卡约束](https://docs.slash.com/api-reference/card-patch)、[Slash 交易查询](https://docs.slash.com/api-reference/transaction-get)。接口文档不等于本项目真实验收证据。

## 生产资金展示（2026-09-18）

FLOW-FUNDS-PRODUCTION-VIEW：用户要求线上只展示正式资金。首页移除测试钱包及重复占位余额，使用正式账本钱包；资金总览、分类记录及订单详情复用GET crypto契约。当前限定充值服务提供live命名空间的只读账本查询，不通过读取余额开启交易执行。正式钱包缺失为“尚未开通”，核对异常为“余额核对中”，不以测试额度或零值补齐。

页面链：首页ProductionWallet/资金中心CustomerFunds → cryptoRequest/现有同域白名单 → cryptoAPI → 客户所有权或后台MFA+资金查询授权 → 原live账本、正式订单、Blnk与journal核对。只读能力executionEligible/realWrites/canOperate均为false，POST交易仍拒绝；USDT充值沿用独立地址和既有额度，不提高限额或启用其他能力。订单详情返回原资金中心，跨客户仍404。

客户端及运营导航不再展示测试资金入口，旧客户链接跳转正式资金中心、旧后台链接跳转余额查询。生产API与两端网关设`FUNDS_DISPLAY_MODE=production`，拒绝test-wallet/test-funds读写；生产读服务拒绝shadow账本。旧测试数据、额度及订单不删除、不迁入，保留于原独立范围供隔离测试环境查询。

异常恢复沿用真实订单、Blnk引用、原幂等与渠道核验规则。页面只查询，不创建账户或补余额；回退页面展示也不得迁移测试余额。自动化覆盖正式余额、未知USD不伪装0、shadow响应拒绝、跨客户读取、正式只读时写操作拒绝以及网关/源站同时屏蔽测试API。本批已发布；真实客户浏览器会话未验收，自动化与部署证据见[生产展示发布](../../deploy/2026-09-18-production-funds-view.md)。

## FLOW-FUNDS-PRODUCTION-ACTIVATION（2026-09-18）

| 项目 | 本批内容 |
| --- | --- |
| 目标/基线 | d4aec90增量，隔离工作树，保留原目录并行卡片改动；正式TRC20与OTC接入 |
| 用户决策 | OTC两方向0.99，提款/卡充提费用0且后台可改；取消1 USDT验收上限 |
| 页面关系 | 客户funds/deposit、exchange、history及稳定订单详情；后台crypto费率页和balances余额页 |
| 业务身份/来源 | 原live_moventra_funds、Cregis客户地址、真实0.1 USDT最终入账订单；不重置、不导入测试额度 |
| 接口链 | 共享crypto transport→网关→cryptoAPI→ProductionFunds→原通知/TRON最终性/Blnk及journal；地址绑定接口不变 |
| 状态及操作 | worker健康后OTC可操作，充值最终核验后入账，无试点上限；提款/卡充提仍须各自渠道验收 |
| 跨端/恢复 | 现有轮询、稳定订单URL、持久幂等；旧受限通知重新核验，重复事件不重复入账 |
| 权限 | 客户所有权与开户/service检查，后台MFA及read/configure；manual查询独立授权，无默认扩权 |
| 验收 | 隔离PG覆盖超过1USDT、重复通知、双向0.99、同键重试、配置不重置、MFA/越权及其他能力拒绝；前端生产无额度文案 |
| 待定决策 | 运营配置账号待用户指定；ERC20供应商支持、真实出金及卡余额/占用/消费退款验收待完成 |

独立FUNDS_PRODUCTION_MODE=prepare/enabled与pilot/full ledger互斥。要求原真实最终入账订单及零期初审计，复用私有TLS连接；不伪造双链或卡片认证清单。configure-production-funds仅一次设置用户指定政策并审计，启动不覆盖后台更改。此profile无出金/Slash writer，原独立Cregis地址申请保留。

正式余额查询从已接通live账本读取，manual ReadOnly保证查询不开放人工写入。显式migrate-manual-funds仅安装016，校验前置版本，不创建余额或授权。133项前端及Go隔离PG race通过；真实渠道与部署另外记录。

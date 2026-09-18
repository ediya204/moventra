# FLOW-CLIENT-ISSUING-001：客户端开卡闭环

当前（2026-09-19）：第一批统一资金中心 USD 开卡已在本地实现，使用现有 Blnk 主钱包和卡分户，详见本文后半部分 FLOW-ISSUING-UNIFIED-001。尚未部署；以下2026-09-18内容保留为独立钱包阶段的历史基线。

历史日期：2026-09-18。隔离资金闭环已验收；生产目录与应用发布进度见[发布记录](../../deploy/2026-09-18-client-issuing-release.md)，真实执行未开放。实现基线为 main `1ed842a`，发布代码 `92cad84`。工作目录为 `/Users/ediya/Documents/ChatGPT/moventra`，独立发布保留并行数字货币模块改动。

## 范围、差异与决策

正式客户端原来没有挂载开卡组件；旧 `bins/CardOpeningPage` 属于免费 Demo，不作为正式实现。复用正式 issuing 目录、报价、订单、Blnk 分户及 Slash 适配器，新增正式客户端页面、同意证据、卡查询和 Worker 启动入口。默认 `ISSUING_MODE=disabled`，不改变生产资金权威。

用户确认 USD 开卡钱包支付；首充默认最低值、允许增加；发卡失败全退，发卡成功但首充失败只退首充，原卡补充首充不重复收费。本期不接外部收款或自动兑换。最低首充和价格来自后台配置，零费用和未配置区分；草稿/归档不公开。

## 完整流程卡

| 项目 | 实现与验收口径 |
| --- | --- |
| 起止与角色 | 获开卡资格的个人客户选择 BIN、确认报价及声明，支付后查询完成的新卡；运营查询同一订单、处理异常 |
| 页面关系 | 首页申请新卡/卡片中心 → `/portal/cards/new?product=UUID&q=...&page=1`；订单 `/portal/card-orders`、`/portal/card-orders/:id`；新卡 `/portal/issued-cards/:id`；原卡片投影保留。列表页码在 URL；详情有订单/卡片中心返回入口 |
| 后台关系 | `/card-bins/customers?customer=UUID&order=UUID&orderPage=1`；同页客户资格、钱包、到账申请/复核、订单详情、声明证据及恢复；需 MFA 和独立 issuing 授权 |
| 业务身份 | 客户主体、内部订单 ID、供应商范围与外部卡 ID；新卡内部 ID 为首笔开卡订单 ID，补充首充关联 parentId，不创建第二张卡 |
| 权威与模式 | issuing_orders 为业务状态；独立 Blnk 为该开卡钱包/卡分户记账依据；Slash 为发卡/限制来源。隔离模式只允许 moventra_test_ 库和 127.0.0.1 模拟端点，UI 明示隔离验收 |
| 接口链 | 正式 React 组件 → shared issuingRequest（Firebase bearer）→ 同域网关精确白名单 → Go issuingAPI → 客户所有权/运营 MFA+grant → PostgreSQL → issuing-worker → Blnk/Slash 适配器 |
| 状态和动作 | queued→reserved→creating→created→fee_charged→funded→enabling→active；订单未知保持预占/已有分户状态；失败仅在确认后释放，退款未完成显示 releasing |
| 跨端变化 | 客户订单与后台详情均读取同一 GET；处理中每3秒轮询，隐藏暂停、恢复刷新、终态停止；卡列表以订单归属读取，不依赖手动渠道投影导入 |
| 同意证据 | 两项声明默认不勾选；报价/金额/条款变化后重置。报价绑定条款版本；提交必须 lawfulUse/acceptedTerms=true。数据库原子保存 actor/customer/order、版本、文本、摘要及服务端时间，禁止修改/删除；历史无记录明确显示 |
| 幂等恢复 | 浏览器按登录 UID+customer 在 sessionStorage 先保存请求正文和 UUID；响应丢失重放同键；退出清理。服务端同键异载荷拒绝；同报价不能生成第二单；远端记账按稳定 reference 恢复 |
| 权限 | 客户仅个人所有权；后台沿用 customer:read、funding:submit/review、recovery:write；自复核拒绝；换客户/卡 ID、无 MFA/范围、审计失败均拒绝 |
| 资金 | USD 最小单位字符串，开卡费+首充先转订单在途；费收入与卡分户分别记账。首充失败确认卡仍受限后退首充；未知不退款，不把 spending limit 当渠道可用余额 |
| 恢复与监测 | 独立 Worker 3秒调度，状态持久化、单订单互斥、错误退避5–300秒；记录待处理/待核查计数，日志不含凭据/渠道响应；后台恢复只安排核查，不直接重开 |
| 验收 | E01–E07、E09 见下方；列表沿用服务端50+1分页，E08全量压测未执行 |

## 接口及兼容

在两端 `/.../v1/customers/{customerID}/card-issuing` 新增 GET `products/{id}`、`terms`、`cards`、`cards/{id}`。订单详情附加 consent 与最多200项有序处理事件；列表保持原数组契约。卡详情区分 known/unavailable/not_funded，余额未知返回 null。

POST orders 使用 quoteId、termsVersion、lawfulUse、acceptedTerms 及 Idempotency-Key。未同意返回400 consent_required；条款失效返回409 terms_changed；费用等额外字段拒绝。报价仍为5分钟，价格或产品配置变更需重新确认。topups 仅处理 funding_failed 原卡，开卡费为零。

机器契约见 [issuing.openapi.json](../../services/api/docs/issuing.openapi.json)。新增迁移014（013由并行任务使用），Ready要求014 checksum；旧迁移不变。历史订单可读，不补造声明；旧未包含声明的提交会被拒绝，前后端需成套发布。

当前声明为版本化应用政策 `issuing-2026-09-18-v1`，不是新增法务合规认证。正式条款和商业参数由运营/法务在真实上线阶段确认，确认人待分配；不阻塞隔离实现。

## 首轮隔离验证与证据（保留当时范围）

- 前端专项：金额精度、网关/transport一致性、声明门槛、修改金额重置、超时后重新挂载恢复相同请求、登录主体隔离、后台目录操作。
- PostgreSQL专项：缺声明/旧条款/伪造费用拒绝，同意证据不可变、幂等、两端订单相同、客户卡详情隔离；现有资金测试覆盖组价/专属价/免费价、并发预占、防超支、未知结果找回、首充失败退款及原卡补充首充、远端预占后本地回滚恢复和审计失败。
- 本地真实 Blnk Core v0.15.4（源码 f3067eb56a573055ce86c3328566145b467f393b）使用独立 PostgreSQL 和 Redis；不复用浏览器测试账本运行专项测试，固定测试客户 ID 不能跨测试库共用 Blnk 实例。
- 浏览器专项使用真实正式页面组件、shared transport、真实 Go HTTP handler、独立 PostgreSQL、本地 Blnk、模拟 Slash HTTP 和独立 issuing-worker；认证只注入测试身份，不代表真实 Firebase 登录验收。
- 浏览器实测：钱包1000 USD，开卡费5、首充20，完成后钱包975、卡分户20；客户端/后台订单完全相同；Worker预占后重启仍完成；详情刷新、390px手机无横向溢出通过。
- 该轮隔离验证没有执行生产迁移、实际渠道发卡、真实资金动作、推送或部署。独立本地二进制验证不替代 Docker 镜像运行验收。

复现入口：`bash services/api/scripts/test-issuing.sh`；设置 BLNK_TEST_URL/BLNK_TEST_KEY 时使用新的本地真实 Blnk 实例，否则使用有状态 HTTP fixture。前端专项为 `node --test tests/frontend/issuing.test.mjs tests/frontend/issuing-checkout.test.mjs tests/frontend/issuing-admin-ui.test.mjs`。

浏览器测试：新建 moventra_test_ 应用库及独立 Blnk/Redis，编译 cmd/issuing-worker；设置 TEST_DATABASE_URL、BLNK_TEST_URL、BLNK_TEST_KEY、ISSUING_WORKER_BINARY、ISSUING_BROWSER_OUTPUT，运行 `go test -run '^TestIssuingBrowserHarness$' -v ./internal/api`。再以同一 ISSUING_BROWSER_OUTPUT 启动 `pnpm exec vite --config tests/frontend/fixtures/issuing/vite.config.mjs`，执行 `node tests/frontend/issuing-browser.mjs`（可用 PLAYWRIGHT_MODULE/CHROME_EXECUTABLE 指定本机依赖）。测试凭据与模拟端点只在测试入口，不进入正式构建。结束时创建输出路径加 `.stop` 文件并清理本次独立资源。

本次结果记录见 [隔离验收 JSON](../testing/client-card-issuing-2026-09-18.json)。前端开卡专项8项通过；全仓前端107/109通过，剩余为并行数字货币导航期望和 CryptoFunds 测试替身导入。整套隔离 PostgreSQL Go race回归、Go vet/build通过；两端typecheck/build通过（保留既有大包提示）；docs检查及diff检查通过。首次真实Blnk专项误复用了浏览器测试账本，固定客户ID导致余额断言不匹配；改为独立新Blnk库/Redis后通过，未修改金额断言掩盖问题。

## 交付与回退

能力等级：隔离闭环，生产真实执行仍关闭。设计、本地实现、专项自动化和上述隔离浏览器范围通过。随后获授权的生产014迁移与8个BIN目录配置已完成，统一开卡费10 USD、最低首充20 USD；发布候选116项前端测试及两端构建通过。应用部署状态见[发布记录](../../deploy/2026-09-18-client-issuing-release.md)，迁移证据见[生产迁移记录](../../deploy/2026-09-18-issuing-checkout-migration.md)。先前全仓并行改动的失败保留为历史证据，未将测试费用5 USD当作正式价格。

回退时先禁用执行入口并保留订单、账本和同意证据，不删除在途事项；前端可关闭开卡入口，查询和核查保留。生产激活仍需独立账本、供应商验证清单、零限制/累计限制/未知恢复/对账验证及明确授权。

## 连接准备增量（2026-09-18，已部署只读模式）

API与独立Worker已发布2b4a905，Blnk私有CA认证连接及Worker重启检查通过；新增prepare只读检查模式与Blnk私有CA支持；Worker仅检查连接和订单计数，不调用金融处理，数据库会话只读、Blnk禁止非GET。私有TLS进程与Blnk同容器，开卡客户端远端连接加密、代理明文转发固定loopback。真实执行条件保持不变，具体配置与验证见[准备记录](../../deploy/2026-09-18-issuing-preparation.md)。

## FLOW-ISSUING-UNIFIED-001：资金中心 USD 开卡（2026-09-19，统一本地闭环）

本轮用户明确要求实现开卡，并选择从资金中心 USD 统一扣费及首充。基线 main `14fe215`，共享工作区已有 UI、消息、资金及卡片详情改动，保留原改动。本轮不授权生产部署、迁移或真实发卡。

| 项目 | 实施范围 |
| --- | --- |
| 起止 | 已获开卡资格客户选产品、报价、同意、提交，Worker预占资金中心USD、发卡、收费、首充及查询结果 |
| 页面 | `/portal/cards/new` → `/portal/card-orders/:id` → `/portal/issued-cards/:id` → 普通 `/portal/cards/:cardId?connection=...`；后台 `/card-bins/customers?customer=UUID&order=UUID` |
| 业务身份 | customer、开卡订单、供应商范围及来源卡ID；订单快照固定账本namespace，旧单保留原钱包 |
| 权威 | 共用现有ledger钱包wallet-USD与ledger_journal，开卡状态仍由issuing_orders维护；本地测试使用隔离数据库和模拟渠道 |
| 接口链 | 现有React→issuing transport→网关→issuingAPI→归属/MFA授权→订单→Worker→统一ledger→Blnk/Slash；不新增公开金融写入口 |
| 状态/恢复 | 沿用queued/reserved/creating/active及失败、退款、未知状态；跨数据库事务重放相同经济键，结果未知不重新发卡 |
| 跨端 | 现有同单查询与轮询；资金中心读取同一USD余额及卡/在途分户，不复制到账金额 |
| 权限 | 保留客户资格、产品/供应商暂停、渠道验收、客户归属、MFA及独立运营权限；旧开卡入金不得写入统一钱包 |
| 兼容 | 新配置显式选择资金中心；旧订单快照无namespace继续原账本；切换namespace时拒绝处理不匹配订单，不隐式搬迁旧余额 |
| 验收 | E01/E04/E05/E06/E07/E09：同钱包扣款、幂等、余额不足、恢复、失败退款及旧单隔离；E02/E03沿用稳定路由并回归；E08无新增全量查询 |
| 待核实 | 真实渠道受限发卡/限额/恢复与对账验收及生产配置由本轮后续发布阶段核验；本地测试不替代这些证据 |

### Blnk 与账户映射

复用资金中心现有 Blnk 客户端与 ledger 服务，不另建第二份 USD 可用余额。每个客户在同一 namespace 下只有 `wallet-USD`；订单持久化 `fundsNamespace`、`fundsWalletId`、`connectionId` 和 `virtualAccountId`。历史无 namespace 的订单仍走原开卡账本；改变配置不会改变历史退款路径。

| 资金用途 | 统一账户 | 处理规则 |
| --- | --- | --- |
| 客户 USD | wallet-USD | 与 OTC 共用余额、锁、journal 及 Blnk 精确记账 |
| 订单预占 | issuing-hold:订单ID | 先预占，再发卡；未知结果保留核查并用原幂等键恢复 |
| 开卡费 | issuing-fee-USD | 发卡确认后记费，发卡失败全退 |
| 首充/原卡补首充 | funds-card:连接:渠道卡ID | 同一卡同一分户，内部划转不新增收入、不重复统计资产 |
| 退款 | 原订单快照账户 | 首充失败核验受限后退首充，重复恢复不重复退款 |

新卡写入可追溯的来源回执及客户项目归属，自动出现在普通卡片中心，统一详情链接原开卡订单。后续完整渠道导入优先于创建回执，不复制同一卡。分户初始账务可核对，但授权占用尚未接入的卡仍禁止通用充提；限额不冒充可用资金。

### 盘点范围与第二批

本轮完成代码、隔离测试数据和账户路径盘点，未连接生产数据库。生产两套钱包余额、在途订单、历史卡授权占用及归属仍须逐笔只读盘点。旧开卡钱包退出统一模式下的新入金业务，历史记录保留；未完成旧入金留待核查，不能直接转入主钱包。历史余额迁移必须使用有来源、审批和审计的迁移分录，禁止覆盖余额。拥有旧快照但尚无项目归属的客户由 `card_scope_migration_required` 阻止隐式迁移。

### 配置、迁移与回退候选

统一模式显式配置 `ISSUING_FUNDING_SOURCE=funds_wallet`，复用资金中心 `DEPOSIT_PILOT_BLNK_*` 连接及 `DEPOSIT_ADDRESS_NAMESPACE`；正式模式还要求既有资金执行开关和验收证据，开卡验收文件必须固定同一资金来源和 namespace。旧开卡 Blnk 连接需继续保留供历史订单恢复。prepare 只读模式不会发卡或扣款。

迁移021仅增加新卡归属回执及来源投影兼容视图，不搬迁余额。受控命令 `api migrate-issuing-unified` 核验001–019校验和，仅执行021，不顺带执行消息迁移020。后续生产方案依次为：获授权后只读盘点、备份校验与隔离恢复、执行021、关闭执行开关部署、指定客户与产品验收、核对真实扣款/发卡/启用/退款证据后扩大。回退先关闭执行，保留021、原订单快照和账本，继续查询和核查；不得删除在途记录或改退款账户。

### 本轮验证边界

隔离 PostgreSQL 全套 Go race 回归通过；统一专项覆盖成功、发卡未知恢复、首充失败退款、原卡补首充、幂等、预占已提交而本地事务回滚、客户越权、后台 MFA、同单跨端查询、与其他资金操作并发防超支、余额不足及 namespace 变更拒绝。专项随后在新建独立 PostgreSQL、Redis 和真实本机 Blnk 进程上重跑通过（Slash 模拟）；不是生产 Blnk 或真实发卡验收。历史订单路由另有 `TestOrderKeepsOriginalLedger` 回归。

两端 typecheck/build、43项相关前端测试通过。全仓前端测试曾遇到并行修改中的 funds navigation 断言失败，未作为全绿验收。浏览器统一链路使用真实 Go HTTP、独立数据库、独立 Worker 重启及有状态 Blnk/Slash 模拟；桌面与390px手机验证通过：声明、报价、支付、刷新、Worker重启、新卡详情、两端同单及1000→975 USD主钱包/20 USD卡分户/5 USD费用均已核验；不能和真实 Blnk 专项混为同一轮。

复现统一专项：新的本地 Blnk 数据库与 Redis、设置 BLNK_TEST_URL/KEY 后，在新建 moventra_test_ 应用库运行 `go test -race -count=1 -run '^TestIssuingUnifiedFunds$' ./internal/api`。浏览器增加 `ISSUING_BROWSER_UNIFIED=1`；使用模拟 Blnk 时同时设置 `ISSUING_BROWSER_FAKE_BLNK=1`。`live_issuing_test_` namespace 仅在本地隔离模式及 loopback 检查通过后用于正式响应结构测试，不代表启用生产。

本轮未执行生产迁移、部署、真实渠道发卡或真实资金操作。

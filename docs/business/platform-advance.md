# FLOW-PLATFORM-ADVANCE-001：余额查询与人工出入金

核对日期：2026-09-19。正式 API 与后台已发布无需审核版本 bf05e56，人工资金已启用。新单按授权直接处理，旧待审核单须显式继续原单。本次授权的 1,000 USD 原单已完成，钱包由 0.09 增至 1,000.09 USD；未执行其他历史计划或外部付款。完整证据见[发布记录](../../deploy/2026-09-19-manual-funds-activation.md)。

用户采用“资金与财务 → 余额查询 → 用户详情 → 人工出入金”。不设置用途字段或仅刷卡限制；平台垫资是账务来源，资金使用沿用统一余额、预占及现有业务规则。本次指定账户 ediyanghk@gmail.com 的一次性合计 10,000 USD 仍为待执行事项，不是每张卡各加 10,000 USD。

## 页面与流程

- 后台 `/finance/balances`：全局查询权限可见所有已注册客户用户，包括尚未建立客户或资金账户的用户；范围权限只见授权客户。支持邮箱精确匹配、名称/客户 ID、状态、USD/USDT 查询及每页 20 条。汇总覆盖当前筛选与权限范围，不仅汇总当前页。
- `/finance/balances/:customerId`：账户信息、资金概览及人工出入金、资金流水、关联卡片三个标签。人工入金/出金在记录区操作。未开通或未知金额为 `—`，已登记零余额为 `0`。
- `/finance/balances/:customerId/orders/:orderId`：查看原单、审批、钱包变动、凭证及最近 100 条操作事件。支持刷新、深链、返回筛选；记录和资金流水均分页。
- 客户端 `/portal/funds/manual` 及 `/portal/funds/manual/orders/:orderId`：本人同源订单，只读；内部备注、凭证和人员 ID 不返回。资金中心提供入口，人工订单不冒充数字货币充值。

人工表单仅含当前客户、USD、金额、来源/类型、原因、凭证及适用的原单 ID。金额为精确 cents 字符串。首期不自动计算费用或兑换，输入金额即本单总变动金额；线下收付款资料由受控凭证引用承载，不采集银行卡/PAN/CVV。

| 类型 | 已实现账务流程 | 边界 |
| --- | --- | --- |
| 平台垫资 | 授权运营提交 → 清算分户到钱包 → 完成 | 不证明平台外部资金已经到账或形成正式应收科目 |
| 线下到账补录 | 核实凭证后提交 → 钱包入账 | 由人员核实真实到账且尚未入账；尚无银行自动核验或跨系统经济事项去重 |
| 垫资回收 | 关联已完成垫资 → 钱包预占 → 预占转清算 | 不超过原单及已申请回收限制；卡上金额必须先经原资金流程退回钱包 |
| 线下付款登记 | 钱包预占 → 待线下付款 → 真实结果凭证确认 → 结算 | 不调用银行/链上付款；批准不表示付款，未知结果不能确认失败或释放 |
| 冲正 | 已完成垫资/回收的全额反向申请 → 必要预占与处理 | 原单不可删除；不支持线下收付款或冲正单再次冲正 |

拒绝、取消或确认付款失败通过独立释放分录退回预占。余额不足失败不会进入待审核。记账结果未知时保留处理中及错误提示，重试查询原操作；不得换单重复入账。入账前后余额来自实际钱包分录；出金显示预占时的变动，后续释放单独出现在流水。

## 数据权威与兼容边界

余额来源为当前账本 namespace 的 `ledger_journal`、钱包/预占/在途/卡分户映射。钱包可用、预占、卡资金分别计入已登记合计，内部划转不增加总资金。页面明确标为“已登记资金”，不是上游共享资金池或实时银行余额。未登记历史卡不计入；不把 Slash 消费限额补作余额。USD 与 USDT 分别显示，人工操作首期仅 USD。

复用已有 ledger 操作、固定 reference 和钱包映射；新增人工订单、命令、权限及不可变审计。与 online_test 隔离。不导入或伪造缺失的数字货币入金/卡充提，不按 BIN 自动认领卡片。正式钱包到账后，转卡仍走独立卡资金链；本次没有改变 Slash 执行或验证真实刷卡。

人工凭证在本 namespace 唯一，但尚未与银行/自动同步共用经济事项键。正式使用线下补录前必须完成来源核对及重复项排查，不能把该唯一索引说成跨渠道去重。平台垫资应收、偿还、利息及自动抵扣政策尚待财务确认；当前仅有内部清算与客户资金分户。

## FLOW 流程卡

| 项目 | 本批实现与验证边界 |
| --- | --- |
| 起终点 | 运营查询用户 → 授权提交 → 持久 Worker 记账 → 两端查询原单及余额；真实外部付款由人员另行执行 |
| 页面关系 | 资金与财务/余额查询 → 用户详情 → 订单；客户端资金中心 → 人工出入金记录 → 订单 |
| 身份 | Firebase 会话 → 服务端用户/客户映射；父子客户与订单严格校验，不接受任意账本账户 ID |
| 接口链 | 既有认证 transport → 同域网关精确方法/路径 → Go handler → 客户范围/MFA/动作权限 → PostgreSQL 订单/审计 → manual-funds-worker → ledger/Blnk → 查询原单 |
| 状态 | pending_review、reserving、processing、awaiting_payment、releasing、completed、rejected、cancelled、failed；未决错误不当成付款失败 |
| 跨端 | 两端查询同一订单与钱包；前台记录裁剪内部字段，后台状态定时刷新；提交后重新查询余额 |
| 权限 | 运营 MFA＋独立 read/create/review/execute 授权，scope 为具体客户或全局；无需审核时创建另须execute；旧审核模式保留兼容；禁止给运营本人个人账户操作；客户端本人只读 |
| 异常恢复 | 请求 UUID＋载荷哈希，同键异内容拒绝；revision 防旧页面动作；固定 ledger reference，崩溃后复查并推进原单；浏览器刷新保留待确认请求键 |
| 验收 | 隔离PostgreSQL与模拟Blnk覆盖权限、精确金额、幂等、预占、恢复及无需审核；正式1,000 USD原单已入账，外部付款/刷卡未验证 |
| 文件边界 | 新 manualfunds 服务/Worker/016迁移/接口契约、共享记录组件、余额页及路由/网关定点接入；不覆盖其他任务代码，不改既有已应用迁移 |
| 回退 | 关闭人工执行开关并停 Worker 前先核对未决单；保留已产生订单、审计及分录，不删除数据或直接改余额 |

## 接口、迁移及运行

机器契约见 [manual-funds.openapi.json](../../services/api/docs/manual-funds.openapi.json)。

- GET `/admin-api/v1/balances`、GET `/admin-api/v1/balances/{customerId}`。
- GET `/{admin|client}-api/v1/customers/{customerId}/manual-funds`、GET 对应 `/orders/{orderId}`。
- POST `/admin-api/v1/customers/{customerId}/manual-funds/orders`。
- POST 同订单的 `approve`、`reject`、`cancel`、`confirm_payment`、`payment_failed`、`reconcile`；冲正通过新建订单并关联原单，无额外 reverse 路由。

新增 `016_manual_funds.sql`；依赖既有客户/账本迁移，不能在生产盲跑全量迁移。API 不自动迁移，缺表时该能力不可用；既有 readiness 未强制要求016，不阻断其他模块。

权限表 `manual_funds_grants` 默认无授权，普通 admin 身份不自动获得资金权限。019 的有效全局管理员通过 `effective_manual_funds_grants` 继承全局动作权限；仍要求 MFA、对应动作权限、禁止操作本人个人账户。其他运营人员按客户范围独立授权，不能为了开启按钮扩大授权。

独立 Worker：在服务目录运行 `go run ./cmd/manual-funds-worker drain` 单次恢复或 `go run ./cmd/manual-funds-worker run` 持续处理。Docker 镜像包含二进制但不会自动启动。复用现有 ledger 环境；disabled 拒绝，shadow 为隔离验证，live 额外要求 `MANUAL_FUNDS_ENABLED=true`。该独立命令继续用于原 LEDGER_MODE 路径，不适用于当前分能力生产资金配置；不调用任何外部付款客户端。当前正式配置的启用入口与健康门槛见下节，不设置虚构验收清单或启用未验收的渠道能力。

## 本次证据

| 维度 | 2026-09-18 结果 |
| --- | --- |
| 设计/本地实现 | 页面、API、订单、权限、审计、Worker 与客户端记录已实现，无用途分类 |
| Go 自动化 | 隔离本机 PostgreSQL race 全套通过；人工资金生命周期9个子场景通过，含模拟 Blnk 已成功而本地事务失败后的恢复；go vet/build 通过 |
| 前端 | 127项回归、两端类型检查及构建通过；人工组件4项覆盖精确金额、同键恢复、禁止自审、付款状态分离及客户端只读 |
| 浏览器 | 本机隔离合成账户检查余额列表、未开通账户、详情、入金表单无用途、资金流水/订单关联；未执行真实资金 |
| 跳过项 | 真实 Firebase、真实 Blnk/PostgreSQL 组合及既有开卡浏览器专用测试未配置，不能称为已验证 |
| 真实渠道/部署 | API与两端代码已发布；未连接生产数据库、执行正式迁移、授权、垫资、Slash写入或刷卡。见[发布记录](../../deploy/2026-09-18-balance-query-release.md) |

Go 在本机需 `GOFLAGS=-buildvcs=false` 绕过系统 Git 的 Xcode 许可探测，Git 审阅使用已安装 Xcode 内的 Git。构建与模拟测试不证明生产资金可用。

## 上线交接与待定事项

| 事项 | 负责人/阻塞阶段 | 当前状态 |
| --- | --- | --- |
| 正式身份、现有垫资、实际卡归属及历史期初 | 运营/工程，正式资金启用前 | 未复验；不能仅凭 BIN 或历史测试资料确定 |
| 平台真实资金、凭证、科目与偿还政策 | 财务，真实垫资前 | 待确认；不默认赠款、免息或自动回收 |
| 016迁移、最小权限、运营审批与Worker | 工程/授权运营，上线前 | 后续发布已安装016/019；有效全局权限沿用019。人工资金已正式启用，无需审核；同一运营须实际具备create和execute授权 |
| 正式 Blnk、资金池、存量卡占款、转卡与消费闭环 | 工程/持卡人，真实刷卡前 | 尚待受控验收，本次仅已授权的1,000 USD原单完成真实Blnk内部入账；未验证转卡或刷卡 |

上线验收后，授权人员可搜索指定邮箱，经人工入金“平台垫资”提交一次 10,000.00 USD，授权运营提交并核对分录。钱包入账不自动给所有卡加额；按实际卡归属与资金流程分配，并由持卡人完成小额刷卡验证。

## 前期离线工具（保留）

[配置模板](platform-advance-review.json) 与 `scripts/prepare-platform-advance.mjs` 仍只表达一次性计划，customerId/requestId/allocations 留空等待真实证据；不是 Worker 输入，也无 apply 模式。其历史6项测试仅验证配置结构、精确合计、重复卡和确定性，不替代上述资金测试或正式验收。

## 2026-09-19：正式资金模式人工操作接通（实现与启用规则）

本轮用户请求“后台开启人工出入金”。差异：正式余额通过 `ProductionFunds` 读取，但人工服务强制 ReadOnly，且原独立 Worker 仅从 `LEDGER_MODE` 初始化；仅设置 `MANUAL_FUNDS_ENABLED=true` 无法完成接通。

沿用 FLOW-PLATFORM-ADVANCE-001 的页面、业务身份、接口、权限和订单状态。本轮基线 main `9f747ab`，修改正式资金服务选择、API 内持久订单恢复及016依赖检查；共享工作区的开卡页面与测试不在本轮范围。目标为人工 USD 申请、单人授权审核、后台记账恢复及两端同源查询，不代替用户创建订单或执行历史文档中的垫资计划。

- 当前生产模式须同时满足 `FUNDS_PRODUCTION_MODE=enabled`、`MANUAL_FUNDS_ENABLED=true`、live 账本及既有 `ProductionReady()` 健康门槛。沿用已核实的最终充值证据、TLS Blnk和原 namespace；prepare、pilot、未就绪或开关关闭时继续拒绝人工写入。
- API 启动及 `/readyz` 核对001/006/016/019校验和，不自动迁移。显式开启后，API 每5秒恢复现有 reserving/processing/releasing 订单，沿用订单锁、显式确认和固定账本 reference；没有待处理订单时不创建分录。
- 不额外启动原 manual-funds-worker，不修改充值、OTC、开卡、链上提现或卡充提开关；线下付款仍由人员核实并提交独立凭证。
- 回退关闭人工开关并部署前先核对未决订单与预占；保留订单、审计及账本，不能删单或覆盖余额。开启前还须只读核对既有待处理订单，避免意外恢复历史事项。

验收：本轮隔离PG验证正式模式下开关关闭/prepare拒绝、迁移校验错误拒绝、MFA、缺少动作权限拒绝、创建幂等、单人授权审核、Worker恢复和重复运行仅记账一次、生产不健康与pilot拒绝；原人工生命周期覆盖出金预占、失败释放及未知恢复。具体运行结果同步于当前状态。本段为接通阶段的本地证据。后续正式部署与已授权原单真实Blnk入账见发布记录；未调用银行、链上或Slash付款。


### 2026-09-19 阶段决定：单一授权（审核步骤已被后续决定替代）

用户明确要求“单一授权即可”，人工资金流程改为一名持有read/create/review/execute相应权限的运营即可完成创建、审批及线下付款确认。actor_id和reviewer_id可相同，审计仍记录每个动作；普通admin或只有create权限不因此获得review/execute。后台批准及确认付款按钮同步开放给原申请人。该决定仅适用于人工出入金，不改变开卡或其他渠道审批政策。

创建不自动批准或记账；线下出金批准仍进入awaiting_payment，必须另行提交已核实的付款凭证才进入记账。金额、预占、未知结果恢复和幂等规则不变。旧2026-09-18的禁止自审测试为历史证据，不再代表当前人工资金政策。

### 2026-09-19 revised decision: no review

The user clarified that no review step is wanted and explicitly authorized the existing 1,000 USD platform advance. Production now uses `MANUAL_FUNDS_REQUIRE_REVIEW=false`. New credits process after submission; debits reserve first, with offline payouts still requiring actual payment evidence. Creation requires create and execute grants, plus the existing MFA and customer checks. Audit records the policy, without inventing reviewer identities. Existing pending orders stay unchanged until explicitly resumed; only the identified 1,000 USD original order is authorized in this release. This supersedes the earlier same-operator approval step above. Release evidence is maintained in the manual-funds activation record.

## FLOW-BALANCE-UI-001：用户资金详情排版（2026-09-19，本地未部署）

| 项目 | 本轮范围 |
| --- | --- |
| 目标与基线 | main `0677a8c` 加既有工作区增量；仅重排后台资金详情，保留其他任务修改 |
| 页面关系 | 余额查询 → `/finance/balances/:customerId` → 人工订单、资金流水、关联卡片；原 URL 参数和返回查询上下文保留 |
| 身份与数据依据 | 既有 customerId、orderId 和账本查询；未知金额仍为破折号，零值仍显示零，币种独立 |
| 接口链 | BalanceContent → manualRequest → 同域人工资金白名单 → 既有 Go balances/manual-funds handler → 授权与账本/订单查询；没有接口修改 |
| 设计 | 紧凑客户栏，右上币种与刷新，四列资金摘要；完整口径可展开，更新时间常显；下划线标签、金额右对齐及中文语义色状态；手机摘要两列、记录横向滚动 |
| 状态与操作 | 原申请、审核、付款确认、记账状态与权限保持；只给状态文字增加样式，不更改判断；订单详情期间其他标签禁用，返回记录后可切换 |
| 跨端与权限 | 余额10秒、订单5秒既有轮询，原单提交后刷新余额；后台MFA/主体授权与客户只读边界不变；客户端状态仅增加无样式span，样式限定后台详情 |
| 异常恢复 | 原错误重试、加载、空状态和未知提交的幂等恢复保留；展开口径不触发接口或写操作 |
| 验收环境 | `node tests/frontend/balances-preview.mjs`，127.0.0.1:8906；仅合成数据，所有写请求和真实API被拒绝 |
| 待定决策 | 无新增金融政策；本轮不提交、不部署，不连接生产数据库或真实渠道 |

验证结果在本节末记录；本轮视觉验收不替代原完整人工资金生命周期验收。

本轮验证：`pnpm typecheck`、两端生产构建、`pnpm check:boundaries`、`node --test tests/frontend/manual-funds.test.mjs tests/frontend/finance-money-display.test.mjs`（8项）、`pnpm docs:check`及`git diff --check`通过。浏览器合成数据核对桌面、390px无页面横向溢出、三标签及空状态、订单深链和返回；手机客户行与工具栏换行已修正。E01–E03仅上述读取导航范围获得证据；E04–E09的完整生命周期、真实身份与渠道未重新验收。没有生产部署、迁移或真实资金操作；并行任务对人工审批政策的修改由该任务独立维护，本轮只增加状态样式。

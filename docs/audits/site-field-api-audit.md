# 全站字段与接口审计

> 历史审计快照：静态字段清单和行号生成于本次卡关联补采、手动同步及六类卡状态筛选完成之前，未作为本轮全量审计重跑。当前行为见 [V1现状](../current-state.md)。下方测试数字属于该轮证据，不等同本次GitHub同步验证。

日期：2026-09-07。范围：8852 当前运行的后台/客户端 Demo、真实 Slash 只读投影，以及规范仓库 Moventra 的对应前端和正式 Go API。

## 结论与证据边界

本地主要业务页面具备对应的查询接口，但**不能判定全站所有字段均已接入正式后端**。真实 Slash 只读数据、本地 SQLite Demo、前端派生值和正式 Go 基础接口是不同的数据源。本次未把缺失数据伪造成接口数据，没有接管真实账本或支付通道。

- [字段清单 CSV](page-field-inventory.csv)：1,055 处静态字段绑定（不是唯一业务字段数），附文件、行号、表达式、接口族与数据来源。
- [完整静态清单 JSON](page-field-inventory.json)：129 个 TS/TSX 文件、121 处请求调用。排除 Minimals 内部实现字段。
- [接口检查结果](api-contract-results.json)：独立内存数据库的 60 次 HTTP 查询/错误边界检查，0 失败；包括响应结构、列表/详情前端类型检查和前端白名单检查。
- 静态清单的接口族是追溯入口，不是每行字段的实测证明。动态 JSX、动态列及复用组件需结合类型和调用方阅读；空集合未实际验证其元素。不能将 60 次请求解释为所有页面、所有状态的浏览器验收。

## 页面、字段和接口对应

以下本地路径在前端以 `/local-slash-demo/` 开头，经 Vite 代理到 `/admin-api/settlement-management/demo/`。`management/` 均需本地运营会话；正式接口另列。

| 页面入口 | 主要字段及计算 | 对应接口 | 来源及剩余边界 |
|---|---|---|---|
| `/workbench`、`/approvals` | 待审核/启用用户、费率方案数、用户状态分布、待办、更新时间、审计 | `management/console/overview`、`management/users`、`management/groups` | 本地管理数据库；不代表生产客户统计 |
| `/user-groups/users`、用户详情/开户 | 名称、邮箱、状态、所属费率方案、开户账户、用户覆盖费率、审核记录 | `management/users[/:id]`、`catalog`、用户创建/审核/资料/费率/密码重置接口 | 现有本地用户表 `mg_users`，不得和 Slash 持卡人名称混用 |
| `/pricing`、费率方案详情 | 费率基点、固定费用、继承/覆盖来源、版本、审计 | `management/groups[/:id]`、`users/:id/fees`、`groups/:id/fees`、`fees/preview` | 沿用内部继承，不恢复 V1 团队入口 |
| `/customers`、账户详情 | 名称、邮箱、状态、available/posted、币种、类型、快照时间、关联卡片/交易 | `accounts[/:id]`、按 accountId 查询 `cards`/`transactions`、CSV | 本地来源 Demo；真实用户/真实钱包余额不能从此合成数据推断 |
| `/cards?source=slash` | 卡名、尾四位、渠道状态、创建时间、渠道、所属用户、采集失败信息 | `management/live/cards[/:id]` + 内部归属 JOIN | Slash 卡事实；所属用户只来自内部数据库 |
| 真实卡详情 → 所属用户 | 内部用户姓名、邮箱、绑定原因/版本/时间 | `management/card-ownership/cards/:id` GET/POST；`management/users` 搜索分页 | 新增本地维护；无绑定显示“未绑定”，不按卡名或邮箱猜测归属 |
| `/transactions?source=slash`、详情抽屉 | 原币/账户金额、两层来源状态映射、授权/来源日期、尾四位、商户描述/MCC/地区、订单标识、采集时间 | `management/live/transactions[/:id]`；卡详情补充 | 金额用来源整数；状态色/日期是前端派生。所属用户复用同一卡片绑定，可选列与详情可见。附件仍未接入 |
| `/cards?source=demo`、卡管理详情/审批 | 卡状态、自主/风控冻结、审批状态、执行状态、可用金额、操作权限、流水 | `management/card-admin/{identity,cards,operations}`；preview/operations/review/refresh | 独立本地卡片账本和模拟服务商；真实渠道冻结、扣款、转入转出未接入 |
| `/card-bins`、渠道管理/产品详情 | BIN、产品ID、渠道、产品状态、币种、限额、目录核验信息 | `management/bins[/:id]`、`management/channels[/:id]`、`:id/products`、导入/保存接口 | 内部配置及已核验目录；不代表真实开卡写接口 |
| `/transactions` Demo/跨币种、报表/详情 | 原币和账户金额、汇率、费用/退款关联、历史、入账汇总、差异 | `management/fx/{meta,transactions,report,export}`、交易 timeline/relations、cards/:id | 精确本地跨币种测试模型；关联证据和未确认规则独立保存 |
| `/finance/crypto-flows`、`/finance/otc`、`/finance/withdrawals`、详情 | 资产/网络、金额/费用、钱包预占、报价版本、审批/执行/账务/链状态、收付款、交割、审计 | `management/finance/{context,flows,orders,export}`、quotes/pricing、订单 confirm/review/execute/reconcile 等 | 本地资金沙盒；真实 KYC/KYT、收付款及出金通道未接入。审批不等于到账 |
| `/finance/orders`、`/reports`、`/risk`、`/reconciliation`、场景库 | 订单、场景、来源状态、净额、冻结、差异、关系证据 | `management/console/orders`、`summary`、`scenarios`、来源记录详情、fx/report | 必须按各页标识区分本地模型与渠道事实，不能当作真实资金总账 |
| `/system/audit`、`/system/channels`、`/system/access`、`/system/settings` | 操作人/时间、接入状态、权限说明、展示设置、版本 | `management/console/{audit,system,settings}`、live/status | 权限页是现有权限说明，不是完整生产角色配置系统 |
| `/portal/overview`、卡片列表/详情、申请开卡 | 个人资料、预算/卡片金额、状态、BIN选项、图表 | `portal/state`、`portal/bin-products`、`portal/action` | 本地持久化状态；图表为派生。卡片列表仍从 state 读取，非正式大规模分页 API |
| `/portal/transactions`、详情、账单 | 商户、卡片、来源状态、订单、金额、时间 | `portal/transactions[/:id]`、transactions.csv | 交易/资金订单统一查询；后端筛选分页；本地演示归属不能当生产客户隔离证明 |
| `/portal/funds/*` | 钱包/预占、充值提现、原始/获得资产、费率、订单、地址 | `portal/state`、`portal/action` | 修复报价展示读取返回值；旧 Portal 演示费率与财务工作台固定报价策略仍独立 |
| `/portal/messages`、资料/支持 | 消息内容、分类、已读、关联业务；个人资料及支持请求 | `portal/messages[/:id]`、`portal/state`、`portal/action` | 本地消息与资料；不是正式通知/工单服务 |
| 注册/登录、正式个人首页 | 登录用户/角色/客户ID、账户ID/名称/状态、交易最小单位金额/币种/方向/日期 | Firebase SDK；Go `/api/v1/register`、`/api/v1/me`、`/client-api/v1/customers/:id/{accounts,transactions}` | 正式基础只读能力；不包含上述所有业务字段 |
| 官网、静态协议/说明、通用组件 | 文案、导航、标签、颜色、格式、输入中状态 | 不要求为静态字段伪造 API | 表达来源数据的统计、余额、状态不能以静态值替代 |
| 旧 `src/pages` 中未启用模块 | 历史运营接口字段 | 原 `/admin-api/*` 接口族 | 保留兼容代码；本轮未调用旧远程服务，不能宣称可用 |

## 本轮修复

1. **内部用户归属**：新增 `internal_card_owners`，外键指向现有 `mg_users(namespace,id)`；来源唯一键为 namespace/platform/connection_id/card_id。读接口 JOIN 内部用户，返回现有 `internal.customerId/customerName/email` 命名及 `ownershipSource=internal_database`。交易按 cardId 使用同一绑定，用户改名无需改渠道缓存。
2. 绑定维护新增只接受现有授权连接中的卡片；用户必须存在；本地仅 `demo-operator` 可维护，普通查看身份不可写。记录操作者、原因、版本、时间和前后用户；重复同值不重复审计，并发变更返回 409。绑定不是客户资金权限或历史交易归属快照；本轮采用**当前卡片归属**展示。真实卡未自动绑定任何 Demo 用户。
3. 卡片列表、详情、交易可选列、交易抽屉接同一内部字段。无绑定明确“未绑定”；更新相关错误说明。
4. 旧 Portal 报价返回 `rate/feeBps/rateSource`，界面由报价响应展示，计算与返回值共享精确策略常量。历史未含汇率的报价明确缺失，不补猜测。
5. 规范仓库财务页面兼容 `mode=fixed`、`priceVersion` 与 nullable `expiresAt/rate`。固定报价核验版本，旧报价仍核验过期；出金费用展示/预估读取 `context.withdrawalPolicy`；补齐固定报价维护的前端请求白名单。
6. 开卡页去掉“BIN 均为合成前缀”的错误笼统说明，区分真实产品目录与模拟开卡。
7. 新增可重复运行的静态清单、HTTP/前端类型/白名单检查脚本。

## 仍缺失或需要后续接入

| 优先级 | 差异 | 当前处理 |
|---|---|---|
| P0 | 正式 Go 无完整卡片、BIN、钱包余额、商业费率、OTC、出金审批、详细 Slash 交易接口 | 保持 Demo 与正式入口隔离；本轮未创建假生产接口或真实资金写接口 |
| P0 | 本地 Portal 使用固定演示主体；内部 `mg_users` 与正式 Postgres `users/customers` 不是同一数据源 | 本次绑定使用8852实际内部用户表；接生产时必须基于正式主体和授权关系重建适配，不能把 Demo 关联当正式客户授权 |
| P1 | 现有真实卡没有已确认的用户绑定记录 | 提供内部绑定维护；等待运营按真实归属选择用户，不批量猜测 |
| P1 | 真实 Slash 附件、部分商户/费用/有效期等字段未采集或未返回 | 无值保持缺失；需要接采集和证据来源后才能展示，不以0或成功替代 |
| P1 | 真正账户余额的币种语义未核实，且仅固定40卡/近30日的只读覆盖 | 按来源单位显示并标注覆盖；不能声称完整客户资产/全平台资金统计 |
| P1 | Portal 旧 Demo 0.997/1.001、0.5%与财务工作台可配置0.99存在两个策略 | 已修正字段来源；本轮未擅自统一两套账本/费率继承，需明确产品适用范围 |
| P1 | 正式通道到账、链上确认、附件/凭证上传、KYT、完整权限配置未接入 | 页面能力和模拟状态不作为生产验收 |
| P2 | 部分本地客户端列表来自整体 state、部分记录使用宽泛类型/动态字段 | 静态审计不能替代所有状态的契约与分页验收；正式接入前收敛DTO及分页 |

## 迁移与回退

- 新增 `013_internal_card_ownership.sql`，不删除/重命名旧字段，也不改余额、订单或历史审计。
- 仅本地 Demo `openStore` 增量建表；已有 `assertLocal` 继续拒绝生产及非本地数据库配置。
- 本地数据库已在迁移前通过 SQLite backup 备份到 `demo-server/slash/data/pre-field-audit-20260907-033215.sqlite`，未提交数据库或凭据。
- 回退先停止本地API、导出需要保留的绑定，再执行 `013_internal_card_ownership.down.sql` 并回退本次读取/维护代码；不得直接还原整个旧快照覆盖之后业务变动。DOWN 只移除新增绑定表/索引和迁移版本，不移除审计记录。
- 当前 API 已在8862重启，8852前端热更新；保留此前授权的 Slash 只读同步。没有执行 Slash 金融写接口、生产迁移、Git推送或部署。

## 验证结果

- 60 次隔离 HTTP/类型/白名单检查通过；不会启动真实 Slash bridge，`upstreamCalls=0` 仅指该检查脚本。
- 旧运行目录213个相关测试通过，覆盖资金状态、幂等、跨币种、权限、绑定隔离、版本冲突、内部改名、列表/详情一致性等。
- 旧目录全量命令初次受 `react-test-renderer` 本地依赖缺失阻断 `admin-admission.test.mjs`；未把它记为通过。该测试位于规范仓库的完整测试中已运行。
- 规范仓库31个前端/网关测试通过；新增固定报价版本、历史报价期限、null契约测试。
- 两个前端工程构建/类型检查通过；旧工程保留既有大包警告。
- Go `go test ./...` 通过非外部测试；显式未提供 `TEST_DATABASE_URL`、`LIVE_AUTH_FIXTURES`，Postgres集成/Firebase真实身份测试按设计跳过，不能据此声称数据库业务验收。
- 浏览器核验了管理总览、真实卡列表、卡详情及内部用户搜索下拉，真实卡显示未绑定且未选用户/未填原因时不能保存；没有替用户分配真实卡。其余页面主要通过隔离API和自动化测试核验，未声称逐屏人工验收。

## 重跑

在旧运行目录：

```sh
npm run audit:fields
npm run audit:contracts
node --test tests/live.test.mjs tests/portal-finance.test.mjs
npm run build
```

在规范仓库：

```sh
pnpm test
pnpm build
```

规范仓库保存本报告副本；私有本地 Demo 后端仍在旧目录，不因前端迁移而假定正式 Go 已拥有相同接口。

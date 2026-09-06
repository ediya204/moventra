# Slash 清算 Demo：实施与本地验收

本轮先盘点字段差异，再实施本地查询存储、生成器和页面。字段定义及差异见 [字段差异表](slash-field-gap.md)。核对时间 2026-09-06；官方机器可读约束摘录位于 `demo-server/slash/official-schema.json`（含来源URL），测试不会为了业务场景扩充来源枚举。

## 本地入口

- 登录：http://127.0.0.1:8852/login
- Demo凭据：`demo@adsflow.local` / `demo-only`。仅本地模拟认证；不代表真实SSO或API授权。刷新会清除内存会话。
- 工作台 `/workbench`；账户 `/customers`；卡片 `/cards`；交易 `/transactions`；风险 `/risk`；对账 `/reconciliation`；报表 `/reports`；场景 `/demo/scenarios`。
- 客户端已接入同一套数据：http://127.0.0.1:8850/portal/cards （8852/portal/cards同样可用）。保留原工作台、资金和卡片界面，融合 Slash 来源交易与内部资金订单；已取消两套模式切换。Go/PostgreSQL基础API及生产数据未迁移。

## 初始化、重复导入与清理

```sh
cd '/Users/edi/Documents/ChatGPT/adsflow 后台/adsflow-admin-react'
# Node需支持node:sqlite（本机验证v25.7.0）；新检出时安装依赖
npm ci

# 初始化本地SQLite迁移并导入20个小样本场景；重复运行不产生重复记录
npm run slash:import
npm run slash:status

# 启动隔离API 8862及前端8852（固定loopback，不使用旧远程代理）
npm run slash:demo

# 批量开关：20 × 100 = 2000场景，每25个场景提交一个事务
# 固定种子；相同命名空间不能换种子。默认前端展示固定命名空间。
npm run slash:import -- --replicas 100 --batch-size 25 --seed 20260906

# 仅清理本批：不改旧snapshot.json、不触碰其他namespace或业务库
npm run slash:clean
# 清理并重新导入后可恢复相同ID的小样本
npm run slash:import

# 可使用独立命名空间保存额外样本（当前UI默认展示slash-clearing-v1）
npm run slash:import -- --namespace slash-scale-check --replicas 2
npm run slash:clean -- --namespace slash-scale-check

# 迁移回退：先停止本地Demo服务、清空此SQLite中的全部Demo批次
# 有批次残留时拒绝回退；不允许顺便删除残留数据
npm run slash:clean
node demo-server/slash/cli.mjs rollback
# 再次import会自动初始化查询schema
npm run slash:import

# 自动化校验与构建
npm run slash:test
node --test tests/*.test.mjs
npm run build
npm run build -- --mode slash-demo
```

`NODE_ENV=production`、生产ADSFLOW_ENV及已设置的非loopback数据库/渠道/代理环境变量会在打开存储前拒绝。该命令没有真实Slash网络客户端。普通模式原有远程代理不用于隔离Demo；新模式固定代理127.0.0.1:8862。端口冲突时启动失败，不静默换端口。不要将Demo静态构建当成生产API接入。

## 存储与迁移

新增 `demo-server/slash/migrations/001_source_projection.sql` 与 `.down.sql`。只创建本地 `demo-server/slash/data/projection.sqlite`，新增以下表，不改现有业务字段：

|表|用途|
|---|---|
|schema_migrations / demo_batches|本地schema版本、命名空间与固定种子|
|scenarios|业务说明、独立预期净额/冻结额与确认边界|
|source_records|平台+实体+kind+来源ID唯一键；来源白名单JSON与可空查询列；系统元数据独立JSON|
|source_versions|内部顺序版本、当时来源对象及采集时间；保留授权与清算金额变化|
|source_events|来源事件元数据，eventId按实体去重；不塞入交易单行|
|event_deliveries|多次投递、去重/旧响应忽略/无通知补同步结果|
|internal_relations|清算、退款、费用、争议关联与证据；Demo关联标注待确认|
|internal_adjustments|争议贷记/扣回、费用冲回、返现及调整；不是伪造Slash交易|
|balance_snapshots|每步可用/已入账金额、币种、余额类型和时点|

每个场景另存独立JSON批次文件，沿用原Demo的JSON快照技术。目录已gitignore。重复导入校验已有JSON一致；生成规则修改导致内容不一致时要求新namespace或仅清理该批后重导，不静默覆盖。

查询索引集中在日期、卡ID、账户ID、状态及事件所属交易。SQL金额列与SUM采用整数；JS影响计算使用BigInt。API返回精确美元字符串和整数分。图表只将展示值除100，图表数字不参与账务计算。未知来源状态显示原值及“未知状态”，余额计算遇到未知status拒绝自动推导。

## API与展示

使用现有只读网关允许的`/admin-api/settlement-management/demo/`命名空间。列表、排序、分页、汇总在SQLite执行，浏览器最多拉取100条列表数据；图表使用服务器汇总。交易、账户、卡片和余额CSV在服务端分批读取输出。业务客户ID与来源账户ID没有合并。

交易详情有金额/状态、时间、商户、平台标识、关联记录、来源同步六组，外加来源版本、事件和余额快照。未提供字段显示“—”或原因，真实零保留0.00。`postedAt`仅从posted交易date派生；其他状态不称为清算时间。卡片月限额500 USD与父账户余额分别显示，卡余额不编造。

官方状态直接保留，不把退款/撤销/争议压入旧0/1/2枚举。旧系统DTO及页面路径在普通模式保持原实现；来源DTO在`src/slash/types.ts`独立定义且字段可选，支持旧/其他平台缺值的展示边界。真实其他平台端到端业务接口未调用，本轮兼容性证据是类型构建、原44项Portal测试和缺值/未知枚举适配断言。

## Demo假设与待Slash确认

1. 授权与最后入账采用同一来源对象版本的情况，以及多次capture、超额capture、部分撤销、过期和延迟清算的实际ID/金额变更方式。历史authorization金额来自内部保留快照，不从最终金额推断。
2. 退款与原交易的可靠关联证据、失败退款的实际状态组合；不能只靠orderId匹配。本批脚本给出的父子关系不是Slash公开保证，未匹配记录保持待确认。
3. 争议、临时贷记、扣回、费用冲回和返现调整的官方交易表示与入账顺序。本批只用内部调整表达，不伪造来源事件或状态。
4. `feeInfo.relatedTransaction.amount`单位未明确，本批不生成该不确定金额；`FeeTransaction.feeType`为自由字符串，本批`demo_fx_fee`/`demo_service_fee`仅测试假设。`fxFeeInfo`、`cashbackInfo`是信息，不能自动重复记账。
5. 外币例使用-100 EUR、1.1汇率和-110 USD，汇率定价/舍入及原币符号约定属于Demo假设；不计算真实兑换或费用报价。
6. 内部版本号模拟权威GET对象；Slash未提供通用updatedAt/version。Webhook时间是来源事件时间，采集时间单列；真实系统仍需权威拉取、签名校验、重试和补偿策略。
7. 每场景独立USD借记账户及1000 USD期初为内部假设。客户、实体、卡产品及卡组均为Demo ID，不证明实际开立或产品可用性。虚拟账户本批不推导独立资金余额。

## 验证记录

- 首轮自动化13项全部通过；补充引用完整性和实体作用域后15项全部通过。最终全量59项（15项Slash + 44项原Portal）全部通过，失败0项。机器可读导入/汇总/验证记录见`slash-demo-validation.json`。
- 旧Portal44项测试继续通过；普通模式构建与Slash模式构建均已执行。构建仍有原ApexCharts大chunk提示，不是失败。
- 本地浏览器已使用Demo账号登录，检查工作台、场景表、外币交易详情、卡片详情、账户详情、风险搜索、列选择器和报表。风险页S09仍为未匹配/待确认，报表将9月退款+25单独展示。外币场景显示-100 EUR/-110 USD/费用2.20 USD/账户887.80 USD。部分撤销场景显示available940、posted1000，月限额500单独展示。
- SQLite外键检查、同种子重复导入、不同namespace批量导入及清理、未知状态与零/缺值、API空结果/404、CSV筛选输出均有断言。
- 未执行生产迁移、真实Slash API调用、真实Webhook签名验收、真实清算或资金操作。大规模压测未执行，规模参数及分批提交已用2轮副本自动化校验。


## 客户端融合（2026-09-06，取代此前模式切换）

保留原客户端工作台、资金中心和卡片中心。卡片、对应交易与内部资金订单统一查询，不再显示“Slash场景数据 / 原资金流程演示”切换。旧 `source=prototype` URL 自动移除该参数。原 UI 的充值、兑换、提现、转回、团队划拨继续可用，保存到本地 SQLite。

### 数据和入口

- [卡片中心](http://127.0.0.1:8850/portal/cards)：原3张卡 + 20张场景卡，共23张。按卡名称、后四位、状态、平台、项目及开卡日期查询。
- [统一交易与账单](http://127.0.0.1:8850/portal/transactions)：初始39条，包括33条 Slash交易、3条原客户端交易、3条内部资金订单。后台筛选、分页、排序和CSV导出；列表可选择更多列。
- [资金中心](http://127.0.0.1:8850/portal/funds)：原USDT充值/兑换/提现流程；消费与退款趋势来自服务端完整交易集，不从首页的5条最近记录推算。
- [S01 卡片详情](http://127.0.0.1:8850/portal/cards/DEMO-SLASH-S01-R001-CARD)：同一张卡显示100 USD历史消费、100 USD内部充值；分为概览、交易、资金、操作页签。
- 单卡三级详情 `/portal/cards/:cardId/records/:entryId`；交易二级详情 `/portal/transactions/:entryId`。旧 `/portal/cards/:cardId/transactions/:transactionId` 仍兼容。返回链接保留查询参数，并校验所属卡片。
- 多次退款入口 `/portal/transactions?scenario=S12-R001`，对应 `DEMO-SLASH-S12-R001-T1` -100 USD、`REF1` +20 USD、`REF2` +30 USD；原消费仍保留。
- 其他场景ID沿用上方清单。S05拒绝、S06撤销、S07部分撤销、S13退款失败、S15外币和独立费用均可通过场景号查询，来源字段与后台一致。

### 内部资金订单与金额边界

|内部订单ID|类型与状态|金额影响|
|---|---|---|
|DEMO-PORTAL-SEED-DEPOSIT|USDT充值，已完成|USDT +100；保留检测、复核、完成事件|
|DEMO-PORTAL-SEED-CARD-TOPUP|S01卡片充值，已完成|内部USD钱包 -100，S01内部卡预算 +100|
|DEMO-PORTAL-SEED-WITHDRAW|提现，待审核|USDT可用 -52，冻结 +52；含2 USDT演示手续费，未视为提现成功|

内部USD钱包初始28,450，融合后28,350；USDT初始5,000，融合后可用5,048、冻结52。Slash历史消费只影响其来源账户快照，不再次扣减内部钱包/卡预算。S01来源账户available/posted均900 USD，与内部卡预算100 USD分开展示。

原卡余额沿用内部预算字段；新场景卡内部预算默认真实0，只有明确资金分配才增加。它不是Slash Card余额、消费限额或utilization。关联客户、预算与来源账户之间的资金路由仍是Demo假设，未执行真实渠道划款。内部资金订单ID与Slash商户orderId是不同字段。

### 增量存储、命令与范围

- `002_unified_portal.sql`新增 `portal_state(namespace, revision, state_json)` 与 `portal_actions(namespace, request_id, action_json, record_id)`；均归属于Demo批次，主键包含namespace。未修改/删除旧业务表。
- 原资金模型以JSON持久化，保留订单事件。每次读/写先从白名单来源表刷新Slash投影，因此来源更新不会被客户端资金操作覆盖。动作字段使用白名单，写入采用事务、修订号冲突检测、requestId去重。
- API：`GET /local-slash-demo/portal/state`（仅5条最近交易+服务端趋势）、`GET portal/transactions`（后端分页）、`GET portal/transactions/:id`、`GET portal/transactions.csv`、`POST portal/action`。这些路径固定代理至loopback8862，不经过原远程admin-api代理。
- 当前客户端固定导入R001的20个场景，便于人工体验；后台生成器仍支持replicas批量。卡片选择数据和资金模型为小样本JSON；交易查询在服务端筛选，不向浏览器发送全量交易。尚未进行大规模客户端压测，也不是生产多租户鉴权实现。

```sh
# Node 25.7.0 已验证（需要node:sqlite及直接导入TypeScript支持）
npm run slash:import  # 同时初始化客户端；重复运行保留操作且不重复充值
npm run slash:demo    # API 8862 + 页面8852；已有8850页面可直接使用
npm run dev          # 仅在8850开发页面未运行时，另开终端启动
node --test tests/*.test.mjs
npm run build
# 可选：只重置本批客户端资金流程，保留Slash源记录；下次读自动重建初始Demo
node demo-server/slash/cli.mjs portal-reset --namespace slash-clearing-v1
# 清理整个本批数据，包括其客户端模型、动作收据和Slash源记录
npm run slash:clean -- --namespace slash-clearing-v1
```

迁移回退文件 `002_unified_portal.down.sql` 仅撤销客户端表；整体 `rollback` 命令仍要求先清理所有Demo批次。当前未执行清理或回退，导入数据保留供体验。

### 本轮验证

70项自动化测试通过（新增6项融合测试），类型检查与生产构建通过。新增验证覆盖资金守恒、刷新/重开持久性、重复动作去重、修订冲突、来源状态刷新与未知值、退款累计、跨月口径、服务端分页及CSV一致性、仅本批清理、外部Origin拒绝。

浏览器核对了原资金中心、23张卡片、S01消费与充值同卡展示、三级来源详情和余额快照。所有数据均为本地合成Demo；未执行真实Slash写接口、生产迁移或真实资金操作。官方清算关系、争议/临时贷记/费用调整的待确认边界仍沿用上文。

### 客户端菜单精简

已移除客户端“账户余额”和“清算场景”菜单及页面。旧 `/portal/customers/*` 地址返回资金中心，旧 `/portal/demo/*` 地址返回交易与账单。交易详情不再提供场景入口或来源账户详情跳转；客户资金、卡片与交易数据继续保留。运营后台 `/customers`、`/demo/scenarios` 及来源API不受影响。

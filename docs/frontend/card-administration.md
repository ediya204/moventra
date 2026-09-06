# 卡片管理闭环（2026-09-07）

## 盘点与实施顺序

| 层 | 当前事实 | 本次增量 |
|---|---|---|
| Go/PostgreSQL | 身份、主体授权与交易只读投影；无卡写接口、资金账本 | 不把本地能力冒充 Go/生产能力；不接管旧账本 |
| React 后台卡详情 | 旧 API 只读；8852 SourceDemoPage 也是来源展示 | 本地卡目录、状态、审批、执行记录和资金流水 |
| Portal | 自助冻结、riskFrozen 拦截；预算钱包 JSON 持久化 | 后端统一风控覆盖、受管卡自助冻结状态机、账本投影；原预算不迁为资金 |
| 审批 | 用户开户审批，固定 Demo 操作员 | 卡操作单独权限与两人审批、审批/执行分离 |
| 资金 | Portal 原型直接修改预算，不是双边账本 | 独立测试账户、不可变双边分录、预占、幂等、失败释放、审计 |
| 渠道 | 无真实写适配器 | 持久化执行任务与隔离测试驱动；不调用 Slash 写接口 |

实施顺序：增量009存储 → 后端权限/状态机/账本/执行 → 后台卡详情和审批 → Portal投影与写约束 → 自动化及页面联调。

## 本次资金和审批规则（内部设计，非 Slash 规则）

- 本模块只为 `CARDOPS-*` 合成卡建立独立 USD 测试账本。原 Slash/Portal 卡没有资金映射时，金额显示未知，禁止扣款/转账，卡限额和原预算不冒充可扣款余额。
- 测试客户资金账户 → 卡分户账户为资金转入；卡分户账户 → 同客户资金账户为转出。不是外部充值/提现。双方必须同客户、同币种。
- 强制扣款只用于有凭证的内部应收款收取，卡分户账户 → 平台应收结算账户；不表示网络卡消费。当前测试政策费用为明确零，提交绑定政策版本；不臆造产品费率。
- 风控冻结权限可立即建立本系统限制；服务商最终状态独立。冻结失败保留内部限制及失败记录。解冻需另一人批准及执行权限，渠道成功后才解除风控；自助冻结不随风控解除而解除。
- 解冻、扣款、转入、转出全部需要双人审批。冻结为紧急风控操作，免审批且审计。拒绝不执行；批准与执行分别存储，执行失败不能把审批改成未批准。未知渠道结果保留处理中与预占，不猜测失败/重复发起。
- 新权限逐项校验，操作员从服务端会话解析，主体范围从服务端授权读取。请求中的actor/role不参与授权。
- 所有金额整数最小单位字符串传输，BigInt计算；预计余额由后端报价返回，提交二次确认，执行再次检查状态、余额和账户归属。

## 官方依据与边界

2026-09-07 查阅 [Card](https://docs.slash.com/api-reference/schema-card)、[Update card](https://docs.slash.com/api-reference/card-patch)、[Retrieve card](https://docs.slash.com/api-reference/card-get-by-id)。Slash卡状态 active/paused/inactive/closed；riskFrozen、自助冻结、审批和账本账户全部为内部字段。公开状态接口存在不代表本租户写权限或资金扣款能力已确认。没有向真实渠道发起请求。

## 页面与接口（LOCAL）

- 后台目录 `/cards?source=demo`（与同时接入的真实只读目录分开），详情 `/cards/:id`，原来源资料保留 `/cards/:id/source`。
- 卡片操作审批 `/card-operations`、`/card-operations/:id`；原 `/approvals` 增加入口，原开户审批保留。
- 客户端 `/portal/cards/:id` 读取同一后端状态/账本投影，页面可见时每5秒更新，回到窗口时更新。写入始终再次校验，不依赖轮询作为权限控制。
- 受管卡资金记录归入客户端“资金记录”；冻结属于“操作记录”，金额显示不涉及资金。后台强制扣款不伪装成 Slash 消费。
- 原本地客户端 `1001/1002/1003` 及本地生成卡可进行状态操作；`1003` 可演示风控解冻双人审批。其原预算未迁移到新账本，不提供资金扣划。Slash 来源卡未验证写能力则明确禁用，不会假装已完成上游操作。

API 浏览器前缀 `/local-slash-demo/management/card-admin`，后端前缀 `/admin-api/settlement-management/demo/management/card-admin`：

| 方法 | 路径 | 契约 |
|---|---|---|
| GET | `/identity` | 当前服务端会话操作人、独立权限 |
| GET | `/cards` | keyword/status/page/pageSize，服务器分页，稳定ID排序 |
| GET | `/cards/:id` | 基本状态、账本资金、可执行动作及禁止原因、同客户资金账户、分页操作/分录/审计 |
| POST | `/cards/:id/preview` | kind、amountMinor字符串、currency、counterpartyAccount；服务端试算及cardRevision |
| POST | `/cards/:id/operations` | requestId、cardRevision、kind、reason、evidence、金额/账户、confirmed；白名单、幂等和状态验证 |
| GET | `/operations` | cardId/status/keyword/page/pageSize；审批状态过滤 |
| GET | `/operations/:id` | 审批、执行、驱动凭据、审计、双边分录 |
| POST | `/operations/:id/review` | decision=approve/reject、note；非发起人，有审批及执行权限；重复相同决定幂等 |
| POST | `/operations/:id/refresh` | 查询本地驱动最终结果，不能从浏览器传入“成功”，不能绕开审批 |

卡操作不复用远程旧写接口。浏览器白名单新增上述精确路径，服务端验证 HttpOnly operator 会话、Origin 和每项权限。Portal 仍是固定本地演示客户，不等同真实客户登录/租户授权；这是生产接入尚未完成的边界。

## 权限与状态机

| 权限 | 用途 |
|---|---|
| card.read | 授权范围内卡片/审批/账本查询 |
| card.freeze | 紧急风控冻结 |
| card.unfreeze.request | 发起解冻申请 |
| card.unfreeze.execute | 审核后执行解冻，不能只凭申请权限解冻 |
| card.debit | 发起强制扣款 |
| card.transfer_in / card.transfer_out | 分别发起转入 / 转出 |
| card.approve | 审批他人申请 |
| card.execute | 审批后执行与查询处理结果 |

发起人 `demo-operator`；复核人 `demo-reviewer`；只读 `demo-viewer`。权限存于 ca_principals，owner_scope 在后端强制校验。隔离身份选择器仅用公开合成测试登录，不能作为生产管理员角色切换方案。新增复核/观察身份没有其他后台写权限。

- 审批：pending → approved / rejected；freeze 与客户端自助操作为 not_required。
- 执行：pending → processing → succeeded / failed；拒绝为 not_executed。错误审计不覆盖原审批决定。
- 提交阶段验证卡片版本、余额；审批执行阶段再次验证；预占事务内提交。queued 在发出前发现卡状态变化则停止。已进入结果未明阶段不自动解除预占或重发。
- 风控解除成功后仍保留自助冻结；关闭/未激活/未知卡不能通过解冻重新激活。
- SQLite BEGIN IMMEDIATE 串行化余额检查、预占和写入；分录在同一事务内成对产生，每个 operation 唯一 journal。事务失败不会只写一边；分录禁止 UPDATE，删除仅限显式本模块测试清理。
- 执行任务以操作ID作为稳定标识，重启处理已保存 queued 任务；DB处理失败阻断自动热重试，保留预占与原因，人工查询可恢复。没有接入真实 Webhook 验签/回调。

## 数据与迁移

增量 `009_card_administration.sql`，不改旧业务表定义，不回填旧卡资金。

| 表 | 作用 |
|---|---|
| ca_principals | 会话主体对应权限和客户范围 |
| ca_cards | 内部冻结两个独立标记、渠道镜像状态、原因/操作人/时间、revision、测试驱动模式 |
| ca_accounts | 客户资金、卡分户、平台应收结算及期初权益账户，明确币种/归属 |
| ca_operations | 申请、审批、执行三类参与人、凭证、用途、账户两端、金额/费用、政策版本、幂等哈希及错误 |
| ca_journals / ca_entries | 不可变双边资金分录，operation唯一入账 |
| ca_holds | 执行预占，成功/明确失败释放，未知结果保留 |
| ca_jobs | 持久化执行任务、稳定测试凭据、状态/尝试/结果 |
| ca_audit | 申请、拒绝请求、审批、执行、错误处理记录 |

每表按namespace隔离；卡和账户以复合外键引用。不采集PAN、CVV、OTP或真实渠道密钥。所有合成资金明确来自期初权益对手分录，不是充值成功事件。

## 初始化、启动、清理与回退

在 `apps/admin` 目录，使用支持 `node:sqlite` 的项目Node版本：

```sh
npm run slash:import
npm run cards:init
npm run slash:demo
npm run cards:status
npm run cards:test
node --test tests/*.test.mjs
npm run build
```

`cards:init` 可重复运行，不重复增加资金。新增本地管理数据首次访问也会按需初始化。

停止Demo服务并关闭管理页面后执行 `npm run cards:clean`，只清本模块当前 `slash-clearing-v1` 的 ca_* 记录、CARDOPS卡片和 CA操作投影，保留原来源交易、Portal钱包及其他管理模块。再次初始化恢复期初。

回退：先备份本地SQLite，清理本模块，再执行 `009_card_administration.down.sql` 并切回不依赖009的代码。不要直接运行整个Demo的rollback替代本模块回退。已有本地迁移前备份 `/tmp/adsflow-before-card-admin-20260907.sqlite`；它不是生产备份。

## 隔离数据和验收

| 卡片/账户 | 默认数据及用途 |
|---|---|
| CARDOPS-001 / 尾号7001 | 初始USD500；成功驱动，冻结/扣款/转入/转出及审批验收 |
| CARDOPS-002 / 尾号7002 | 初始USD500；渠道拒绝，失败不入账并释放预占 |
| CARDOPS-003 / 尾号7003 | 初始USD500；渠道结果未明，保留预占和处理中 |
| CARDOPS-WALLET | 同一客户USD1000，转入/转出对手账户 |
| CARDOPS-RECEIVABLE | 平台应收结算账户，强制扣款去向 |
| CARDOPS-OTHER-WALLET | 另一客户零余额，越权验证 |
| 1003 | 原客户端风控冻结卡；允许审批解除限制，原预算不是可扣资金 |

浏览器本次实测：

- 扣款 `CA-8ab48980-1750-42cf-95bd-dba8ac1f6de4`：USD10，凭证 `DEMO-UI-INVOICE-0907`，运营提交 → 禁止自审 → 复核人批准 → 后台任务执行成功 → 双边 −10/+10；卡可用资金500→490。
- 冻结 `CA-2e198c0e-8cac-4567-b821-7361c1df79ad`：运营理由和时间保留；后台渠道状态paused、客户端风控冻结、禁止充值/转回、只提供申请处理入口。
- 卡列表按 CARDOPS-001 查询返回1条、余额490。修复查询参数放进URL路径导致前端白名单拒绝的问题；参数通过现有apiGet查询参数传输。

自动化覆盖清单：正常扣款/双边归属、双向划拨守恒、风控同步、客户端绕过拦截、自助冻结保留、逐项权限/客户隔离、防自审、余额/币种/关闭状态/凭证/确认校验、请求/审核/执行幂等、拒绝、渠道失败、未知结果预占、审批时余额变化、新冻结阻断排队划拨、账本写失败事务回滚、清理隔离、持久化重启恢复、客户端资金分类及原风控卡解冻。

真实渠道接入、产品费率/扣款法律业务政策、真实身份与MFA、客户映射、上线迁移及生产部署均未实施。本轮只完成本地执行领域及前后端闭环，测试驱动成功不能作为真实 Slash 扣款、冻结或退款的证明。真实资金权限和正式对手科目需财务/渠道负责人确认；尚未分配负责人。

最终本轮验证：`node --test tests/*.test.mjs` 143/143 通过（本模块20项），`npm run build` 通过；仅现有ApexCharts大包提示。迁移前后115条来源记录、133条历史版本、12条原关联及18条FX记录逐行摘要一致。重启后本模块29张状态映射、7个账本账户、2笔页面操作、10条双边分录、0条资金预占保留。

补充验证：较早客户端解冻结果不覆盖较新后台风控及其原因；执行任务入库故障会回滚本次预占，保留“审批通过 / 执行失败”，不会留下无法解释的冻结资金。

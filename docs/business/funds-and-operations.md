# 资金、定价与运营业务说明

更新日期：2026-09-07。业务源码基线：`0d5158d`，发布记录已随 `2918584` 追加。本页通过源码只读核查整理；本轮没有运行资金动作、读取私有数据库/快照/凭据、连接真实 API、执行测试或部署。渠道投影的 Go/Worker 部署已有独立证据，本人登录业务验收仍未完成；下文不把正式代码路径或部署等同真实资金能力。

## 1. 当前范围与入口

正式后台代码已实现**客户交易投影的只读运营总览，以及独立授权的渠道卡交易/卡资料查询**。两者使用不同数据表与授权，不合并金额，也不产生账本分录。充值、内部兑换、提现、金额审批、费率配置、风险调查和完整管理菜单仍属于 DEV/旧本地服务；三层资金对账属于 DESIGN。出现页面、按钮或演示成功状态，不代表正式金融渠道可以执行。

| 页面路径 | 现行业务 | 范围与数据源 |
| --- | --- | --- |
| `/workbench` | 资金流、交易活跃度、状态分布、每日明细及 CSV | 正式入口使用 Go 只读交易投影；DEV 同名入口另外组合本地客户管理数据和已导入来源数据 |
| `/transactions` | 已导入渠道卡交易的服务端筛选分页、商户/原币与 USD 金额、来源状态及详情 | 正式代码，独立 `channel_*` 投影；不是客户 `transactions` 列表或总览数据源 |
| `/cards/:id?connection=...` | 精确渠道连接内的卡资料，未绑定内部用户明确显示未绑定 | 正式代码，只读；不提供资金余额或卡管理操作 |
| `/session?security=1` | 运营身份与客户资源权限查询 | 正式 Firebase/Go 身份入口 |
| `/approvals` | 用户开户申请列表及详情审核；Slash DEV 模式另提供独立卡操作审批入口 `/card-operations?status=pending` | DEV，开户列表为 `mg_users`；数字货币出金在 `/finance/withdrawals` 独立审批 |
| `/finance/orders`、`/finance/orders/:id` | 查询旧 Portal 的充值、兑换、提现、卡转回订单及摘要 | DEV，只读；不是 `fn_*` 资金工作台订单，也没有批准付款按钮 |
| `/finance/crypto-flows`、`/finance/records/:id` | 已记账数字货币/法币流水及关联订单 | DEV，独立资金账本；按资产和网络汇总 |
| `/finance/otc`、`/finance/otc/new`、`/finance/otc/:id` | 内部 USD ↔ USDT 报价、草稿、确认交割、查看关联出金 | DEV，`finance-workbench-v1` |
| `/finance/withdrawals`、`/finance/withdrawals/new`、`/finance/withdrawals/:id` | 创建、检查、复核、执行及查询隔离出金任务 | DEV，合成 TRON 通道；没有真实转账 |
| `/pricing`、`/pricing/plans`、`/pricing/plans/:id?tab=fees` | 费率方案目录、编辑和继承关系 | DEV，底层仍使用 `mg_groups/mg_fees`；“方案”不是客户团队或企业成员权限 |
| `/user-groups/users/:id` | 用户独立费率、方案归属、开户审核及相关操作记录 | DEV 用户管理；不改变 Go `staff_grants` |
| `/risk`、`/reconciliation` | 待确认/未匹配来源交易与关联证据调查 | DEV，二者当前都使用 `SourceDemoPage` 的风险筛选列表 |
| `/transactions/report`、`/transactions/balances`、`/transactions/differences`、`/fx/*` | 跨币种演示报表、快照与差异 | DEV，`FxPage`；余额页是历史兼容路由，不是已建立正式全平台对账 |
| `/reports`、`/operations`、`/demo/scenarios` | 场景来源报表、经营入口与场景列表 | DEV，合成来源；不能当作正式收入分析 |
| `/system/audit`、`/system/channels`、`/system/access`、`/system/settings` | 本地操作日志、数据范围、身份说明、名称与公告 | DEV；不是正式权限管理或渠道密钥配置 |
| `/portal/funds`、`/portal/messages`、`/portal/support` | 客户资金流程、站内消息和支持请求 | 仅 DEV Portal；正式客户端不提供资金执行 |

路由依据：[后台 App](../../apps/admin/src/App.tsx)、[DEV 路由](../../apps/admin/src/DemoApp.tsx)、[客户端 App](../../apps/client/src/App.tsx)、[Portal](../../apps/client/src/portal/Portal.tsx)。生产不加载完整 DemoApp/Portal 原型；仅启动规范仓库前端不足以复现旧本地服务。

## 2. 资金与来源数据必须分区

| 数据域 | 金额与权威 | 与其他域的关系 |
| --- | --- | --- |
| 正式 Go `transactions` | 只读查询投影，正数 `amount_minor` 加方向，状态 `pending/succeeded/failed`；USD 2 位、USDT 6 位 | 不是账本，没有余额及真实资金写接口；运营总览只统计 USD |
| 正式 Go `channel_*` | 手动导入的渠道卡资料和交易白名单，保留来源状态、时间及精确金额字符串；按连接、导入版本、资源类型和外部 ID 定位 | 独立 `channel_read_grants`；不写客户 `transactions/accounts`，不进入运营总览，不推定客户归属或可用余额 |
| 旧 Portal 状态 | JSON 演示钱包、卡预算、订单、预占与消息；计算限制在安全整数范围 | 客户操作学习模型；不迁成真实资金余额，不等同 ca_* 分录账本 |
| 独立 `finance-workbench-v1` | 本地 `ca_*` 双边分录，加 `fn_wallets/orders/holds/reviews/jobs/events/movements/audit` | 复用卡管理记账原语，但使用独立 namespace；不合并另一套卡管理 Demo，不二次扣来源历史消费 |

本地资金账户包括客户、内部兑换库存、手续费、外部结算和期初权益对手账户。金额以最小单位字符串和 BigInt 计算，已入账与预占分开；本地可用余额是该账本已入账减有效预占。流水只计实际记账影响，预占/释放属于状态与审计，不能当作资金流入。

来源交易、内部演示预算、分析余额、卡限额和真实可用资金不互相替代。资金工作台拒绝直接新建充值/退款/调整订单；现有写入口只创建内部 OTC 或隔离出金，其他类型可作为夹具/历史流水展示。正式充值入账来源仍待接入，不能以手工填写的预期金额证明链上到账。

依据：[Go 模型](../../services/api/docs/account-model.md)、[渠道投影结构](../../services/api/internal/database/002_channel_projection.sql)、[受控导入](../../services/api/internal/projection/import.go)、[财务 DTO 与金额显示](../../apps/admin/src/finance/types.ts)、[领域规则](../domain/transactions-and-funds.md)；旧本地 `demo-server/slash/crypto-finance.mjs` 的 `reserve/postTransfer/financeWrite` 及 `card-admin.mjs` 记账原语。

## 3. 客户资金演示流程（DEV Portal）

客户从 `/portal/funds` 发起演示充值、兑换、提现或维护地址；订单详情有折叠的演示控制区，用于模拟检测、审核、未知及最终结果。这些控制不是正式客户权限，也不是后台多节点审批。

| 流程 | 状态变化与金额影响 |
| --- | --- |
| USDT 充值 | 创建后 `待检测`，模拟检测后 `确认中`，可进入 `需核查`；仅模拟完成时增加 USDT，最终 `已完成`；相同事件不重复入账 |
| USD ↔ USDT 兑换 | 先获取 60 秒演示报价；确认时检查未使用及未过期，预占卖出总额并进入 `处理中`；可转 `待核实`，成功才增加目标资产，明确失败释放卖出资产 |
| USDT 提现 | 选择启用的演示地址并勾选演示二次确认；预占本金+费用，进入 `待审核`；待审核可取消/拒绝并释放；批准后 `处理中`，不可取消；超时 `待核实` 保持预占；成功最终结算，明确失败释放 |
| 卡片转回 | 检查卡未冻结且演示余额充足，先减少卡可用金额并进入处理中；成功才增加主钱包，失败恢复原卡。已由独立管理账本控制的卡，旧本地服务拒绝使用原预算入口转入/转回 |

旧 Portal 常量：最低充值 10 USDT；提现 10–100,000 USDT，另外收 2 USDT；地址仅为不可用于真实收款的演示标识。兑换支付总额含 0.5% 费用，费用向上取整、目标最小单位向下取整。旧方向报价分别为 `1 USDT → 0.997 USD`、`1 USD → 1.001 USDT`，来自 `PORTAL_QUOTE_POLICY`，不是市场价格，也没有改成下节的可配置 0.99 比例。

该模块及订单通知保留在 [Portal model](../../apps/client/src/portal/model.ts)、[FinancePanel](../../apps/client/src/portal/FinancePanel.tsx)。历史示例见 [客户资金演示](../frontend/client-finance.md)；其中测试记录不代表本次重新执行。

## 4. 运营数字货币工作台（DEV/旧本地服务）

### 4.1 角色与客户范围

前端可以选择隔离测试身份；服务端从 HttpOnly 操作员会话取得身份，按 `ca_principals` 的权限和 `owner_scope` 再次判定。它不等于生产 Firebase MFA；切换下拉选项不能创建正式权限。

| 隔离身份 | 初始权限与职责 |
| --- | --- |
| `demo-operator` 经办人 | `finance.read/export/create`；创建及修改自己的申请、确认自己的有效 OTC 报价 |
| `demo-reviewer` 审核员 | `finance.read/export/approve/execute/risk_check`；检查合成风险、复核别人的申请、执行与查询原任务 |
| `demo-controller` 控制员 | `finance.read/control/execute`；大额第二节点；固定报价初始化另赋 `finance.price_manage` |
| `demo-viewer` 观察者 | 仅 `finance.read` |

权限来自本地初始夹具而非正式公司政策；已有权限记录不因页面选择自动重置。逐项查询和命令都检查客户范围；没有权限时服务端拒绝。`requestId` 绑定操作路径、身份和请求摘要，同键同请求返回原结果，同键不同内容返回冲突。

### 4.2 OTC：固定报价、内部交割、关联出金

当前旧服务已采用**默认 `1 USDT = 0.99 USD` 的可配置固定比例**，两个方向使用同一精确比值及倒数。页面显示为后台固定报价，不标为市场报价。

1. 经办人选择客户及卖出资产/金额，服务端创建绑定该经办人、客户和价格版本的报价。
2. 用报价创建 OTC 草稿；报价只能绑定一次订单，草稿阶段没有完成收付。
3. 仅经办人可确认，服务端检查订单 revision、报价版本及客户/库存余额；同一事务记卖出净额、独立费用、目标资产三组双边分录并完成内部交割。
4. 完成后 `state/execution=completed`、`accounting=posted`、`approval=not_required`；收款/付款字段只是内部库存交割状态，不证明外部银行或第三方付款。
5. 若买入 USDT，可另建关联出金单。累计有效关联出金本金不得超过该 OTC 买入金额，子单仍需独立审批与执行。

当前报价 `expiresAt=null`，**没有倒计时**。调价需全局范围 `finance.price_manage`、旧版本和原因；追加新版本及审计，不覆盖已成交记录。调价后未确认的旧版本报价不能继续确认，需重新报价。历史 `fn_quotes` 仍按其过期时间检查，因此不能把所有历史订单描述成无过期限制。

测试兑换费固定为卖出总額的 0.5%，包含在卖出总额内；费用向上取整，到账向下取整。例如 100 USDT，费用 0.5 USDT，按 0.99 比例得到 98.50 USD。比例支持最多 8 位小数、必须大于 0 且不超过 1000；这是技术与测试边界，不是正式定价政策。

### 4.3 出金：审批、执行、入账、链上状态分别保存

| 阶段 | 实际规则 |
| --- | --- |
| 提交 | 仅 USDT/TRON 合成地址，金额 10–100,000 USDT；预占本金和额外 2 USDT 测试费；初始 `approval=pending`、`execution=not_submitted`、风险 `unchecked` |
| 风险检查 | 只做合成地址/测试规则检查，通过是 `demo_checked`；不代表真实地址或交易风险已通过 |
| 审批 | 申请人不能自审；每版本每审批人只记一次决定。≤1,000 USDT 需要 reviewer，>1,000 USDT 还需 controller；两节点由不同人完成，规则标记 `sandbox-only-v1`，正式策略未配置 |
| 全部批准 | `approval=approved`、业务状态 `awaiting_execution`，资金仍预占，尚未付款 |
| 拒绝/撤销 | 拒绝或发起人撤销未提交执行的申请，终止审批并释放预占；意见/原因必填 |
| 退回资料 | 未提交执行时可退回；保持预占。经办人修改后重新检查和审批，不能把退回当作资金已释放 |
| 修改申请 | 仅发起人、未提交执行；金额、地址、Memo、凭证等变更使 revision 增加，旧审批保留但失效，风险重置，重新计算节点及预占 |
| 执行 | 要求全部批准、合成风险通过、预占一致和执行权限；持久化唯一提交任务，进入 `submitting/processing`；不发送网络付款 |
| 结果未知 | `execution=unknown`、业务 `exception`，保留资金预占；只能查询原任务，禁止重发出金 |
| 部分确认 | 夹具按累计确认金额计算增量分录，显示已交割/剩余；未确认部分继续预占，不能把累计金额反复扣款 |
| 全部完成 | 夹具确认数达到 20 且本金全部确认后，费用独立记一次、清预占、`execution/state=completed`；20 次确认只是当前夹具规则 |
| 明确失败 | 失败结果不得夹带新的未核实交割量；已确认部分保留，只释放剩余预占，`execution=failed`、业务 `exception` |

审批、执行、入账、链上、风控是独立字段。通道事件绑定提交键与订单版本；重复相同事件不重复记账，同 ID 内容冲突拒绝，回退的累计值和终态后的旧事件保留为忽略记录。事件处理入口是受控适配函数，不是公开免认证回调。

金额内部保持 USD 2 位、USDT 6 位。列表显示两位是展示规则；编辑从原始最小单位恢复精度，不能用四舍五入后的列表文本反算金额。技术上限为正整数最小单位 `10^12`。手续费原始订单字段与已记账费用流水不得加两遍。

依据：[FinancePage](../../apps/admin/src/finance/FinancePage.tsx)、[状态/精度类型](../../apps/admin/src/finance/types.ts)；旧本地 `crypto-finance.mjs` 的 `permit/quoteValue/confirmOtc/approve/amend/execute/applyEvent/financeWrite`。详见 [历史实现与当前差异](../frontend/crypto-finance.md)。

## 5. 商业费率方案与实际计费的边界（DEV）

`/pricing` 展示方案列表及自定义费率用户数；方案详情维护费率，用户详情可逐项覆盖或恢复继承。兼容旧 `/user-groups/groups` 地址时重定向为 `/pricing` 或 `/pricing/plans/:id`。底层的 group 是费率归类，不能推导客户团队成员或资金所有权。

有效费率顺序为：**用户覆盖 → 所属方案配置 → 系统演示默认值**。每项同时返回来源 `user/group/default`、bps、固定最小单位、币种和精度。切换方案只影响继承项；显式覆盖项仍保留。

| 默认类别 | 本地演示值 |
| --- | --- |
| USDT 充值 | 0 |
| USDT→USD、USD→USDT 兑换 | 各为支付币种的 50 bps（0.5%） |
| USDT 提现 | 固定 2 USDT |
| 开卡、卡充值、卡转回、内部划拨、卡消费 | 0 USD |
| 外汇消费 | 200 bps（2%） |

预览公式：`ceil(amountMinor × bps / 10000) + fixedMinor`。服务端限制 bps 为 0–10000、最小单位为安全整数，预览金额上限 `10^12`；写入需 owner revision，更新与审计一同提交。恢复继承删除该层覆盖记录，不把零费率等同于继承。

**当前没有把 `mg_fees` 方案接到独立 `fn_*` OTC/出金或旧 Portal 固定策略执行。** 因而保存费率、查看预览，只证明本地配置生效；不能声称它已影响在途订单、修改上游渠道收费或改变所有业务执行费率。也不能把方案中外汇消费 2% 当作真实来源已收费用。

依据：[费率页面](../../apps/admin/src/management/ManagementPage.tsx)、[方案兼容路由](../../apps/admin/src/management/routes.ts)；旧本地 `management.mjs` 的 `feeKinds/effectiveFees/previewFee/managementWrite`，以及与之独立的 `crypto-finance.mjs::quoteValue`、Portal `PORTAL_QUOTE_POLICY`。

## 6. 风险调查与三层对账

当前 DEV `/risk` 和 `/reconciliation` 都查询待确认或未匹配的来源记录，展示原始状态、关联证据和明细。未匹配不使原始已入账金额从来源统计消失；调查页面不创建调账分录，不因关联成功就证明整个账户余额对平。

跨币种演示另提供交易时间线、退款/费用关系、独立费用与已含费用区分、来源余额快照和差异页。这些页面使用隔离示例或有限来源投影，不证明正式渠道全量覆盖。另存的旧 `ReconciliationPage/reconciliationEngine` 前端样本推算没有接入当前 DEV `/reconciliation`；其最多取样、Number 计算、默认零及旧容差规则不能充当正式账务验收。

DESIGN 的三层规则为：内部账分录及期初/变动/期末一致；业务订单与资金影响逐笔一致；内部控制账户与上游资金池经明确映射及证据桥接可比。日终核对、客户分户、上游资金池、差异分派/复核，以及固定版本批次/导出仍待实现。缺期初、部分卡/交易、来源失败或不同时间截点时，结果应为数据不足；不能拿相反差异相抵或造流水配平。

依据：[当前来源调查路由](../../packages/shared/src/slash/SourceDemoPage.tsx)、[FxPage](../../apps/admin/src/fx/FxPage.tsx)、[V1 三层规划](../domain/reconciliation-v1-plan.md)、[资金场景与 R 系列验收要求](../testing/financial-scenarios.md)。这些验收要求不是本轮已执行的测试报告。

## 7. 管理总览统计与更新

正式 `/workbench` 要求运营身份及已验证 MFA；网关对精确 GET `/admin-api/v1/ops/overview` 要求 admin 站点，客户端站点拒绝。Go 每次按身份当前 `transactions:read` 客户集合统计；没有该权限返回 `scope_required`，只有账户查询权限不足以访问。授权、聚合及逐客户读取审计使用同一事务，审计失败不返回统计。新增渠道投影读取端点使用独立授权，未改变此总览的查询表、客户范围和口径。

- 最近 7/14/30 个香港自然日，含今天；首日 00:00 至本次查询时点，`[from,to)`；固定 USD，USDT 不混入金额或笔数。
- 只对 `succeeded` 的 credit/debit 分别求流入/流出，净流量为两者相减；pending/failed 单列笔数。`posted` 兼容字段在生产指 succeeded，不是上游已结算事实。按 `occurred_at` 分桶，不改称入账日。
- 服务端精确求和并返回整数字符串；图表只把几何比例转数值，金额标签和每日表保留精确值。没有记录的日金额 null；整个周期没有记录时金额显示 `—`，不推断真实资金流为零。
- 本总览没有完整来源覆盖证明，始终 `complete=false`；其卡片、商户、客户运营统计及渠道最近成功读取时间仍不可用，不补 0 或假商户排行。独立 `/transactions` 已有渠道商户/卡片信息与采集、导入时间，不代表这些字段已接入总览。
- 首次进入、切换周期、点击刷新重新查询；图表没有后台自动轮询，也不会触发渠道同步。失败清空当前统计并给重试；周期切换忽略旧响应。每日明细 CSV来自当前已读取的聚合，不是服务端异步全量导出。
- DEV 总览复用旧本地已保存的来源交易，可显示 merchant、选定卡及最近读取时间。旧渠道当前保持手动同步；点图表刷新只重算已有投影，不能说“已重新向渠道同步”。

收支是授权范围内捕获到的记录流量，不是平台营收、利润、完整清算或可用余额；未确认内部转账不自动抵消。`asOf` 为查询时点，`revision` 为内容指纹，不是上游事件版本或持久化报表凭证。

渠道卡交易查询另要求有效 Firebase 身份、启用用户、MFA、既有运营权限记录及指定连接的 `channel_read_grants`。客户 `transactions:read` 不自动授予渠道权限，渠道授权也不增加客户交易查询或总览范围；客户端站点网关拒绝渠道端点。读取与 `channel_read_audit` 在同一事务，审计失败不返回记录。

渠道列表按来源 `date` 筛选 UTC 半开区间，每页 20 条，版本不一致返回 `projection_updated`；它的日期不是总览 `occurred_at` 香港日切。`sourceAt` 是采集时间，`importedAt` 是导入时间，`revision` 是已保存的导入版本；返回 `complete=false`、`syncMode=manual_import`。页面刷新只读已导入数据；新数据须经单独采集及受控手动导入，既有版本保留，失败回滚，不产生资金影响。正式服务没有线上 Slash 一键同步或金融写接口。

依据：[页面说明](../frontend/operations-overview.md)、[正式 Go 口径](../../services/api/docs/operations-overview.md)、[总览组件](../../apps/admin/src/operations/FundsOverview.tsx)、[渠道读取](../../services/api/internal/api/channel.go)、[渠道页面](../../apps/admin/src/operations/ChannelTransactionsPage.tsx)、[渠道投影发布记录](../releases/channel-projection-2026-09-07.md)、[手动同步现状](../frontend/slash-manual-sync.md)。

## 8. 日志、消息与系统设置

`/system/audit` 查询本地 `mg_audit`，按关键字、动作、日期和服务端分页查看操作者、目标与描述，并可跳转用户、方案、BIN/渠道或设置页面。该筛选历史实现按 UTC 日期解释；不能默认与总览香港日切相同。独立资金订单的审批、事件和操作时间线来自 `fn_reviews/events/audit`，卡管理还有自己的记录；此日志页不是把全部审计库统一汇总后的正式审计平台。

`/system/channels` 显示本地存储本次读取、迁移版本、来源记录数/采集时间及接入说明；DEV另外展示真实只读同步状态组件。成功读取本地存储不等于上游已连通。页面不录入密钥，也不提供切换真实资金通道的操作。`/system/access` 解释当前后台会话与本地角色，尚无正式管理员创建、自定义角色或 `staff_grants` 分配入口。

`/system/settings` 仅保存后台名称（1–40 字）与首页公告（最多 300 字），带 revision 冲突保护和同事务审计。公告展示于 DEV 管理总览，不是邮件、短信或企业通知发布服务；不能用该设置修改正式身份策略、费率或出金通道。

客户端 DEV `/portal/messages` 显示本地通知，支持选择已读/未读和全部已读，单次选择最多 100 条；卡片及资金操作可产生站内状态消息。`/portal/support` 将支持内容写入本地 tickets 状态。未接入真实邮件/短信投递、客服分派/SLA 或正式工单系统。后台正式 `/workbench` 导航提供资金与运营、卡交易流水、身份与权限和退出，没有正式消息中心。

依据：[AdminConsolePage](../../apps/admin/src/admin/AdminConsolePage.tsx)、[客户 Portal 状态](../../apps/client/src/portal/model.ts)；旧本地 `console.mjs::consoleRead/consoleWrite` 与 `portal.mjs`。旧本地服务源码、迁移及运行数据不属于本次文档发布包。

## 9. 本次核查结论与已知差异

本页现以 `0d5158d` 的正式/DEV 路由为准，已静态核对新增渠道页面、Go 读取/导入、002 结构及网关。渠道投影与客户查询和总览隔离；[发布记录](../releases/channel-projection-2026-09-07.md)中的迁移、导入、历史测试和 Go/Worker 部署描述属于该任务的证据，本轮没有重新验证，也不代替本人登录后的业务验收。

前次 `d9a5d40` 核查中，规范工作区的 AdminConsolePage、FinancePage、财务类型、DemoApp 与运营总览模块与该旧基线内容相同；Portal model 当时的新增未提交差异仅涉及卡解冻申请摘要字段，不改变本页财务策略。这是前次核查范围，不把本轮未复核的工作区或旧服务增量称为已合入、已部署能力。

应避免继续使用的混同说法：开户审批就是出金审批；资金订单列表就是资金执行；报价都还剩 60 秒；保存商业费率就改变 OTC 执行费用；来源关联调查就是三层对账；总览刷新就是渠道同步；已批准或内部 succeeded 就证明真实付款成功。

本轮交付是业务文档及链接核对。旧文档的历史测试数字、浏览器记录和既有发布记录仅作为历史材料；没有在本轮重跑金融测试或进行真实业务验收。

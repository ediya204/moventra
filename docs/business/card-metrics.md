# 卡片历史回填与指标（2026-09-19）

状态：本地已实现，隔离验证通过；未迁移、未部署，未宣称已下载真实历史。用户确认先对指定邮箱正式归属卡建立基线，再将历史和通知统一落库；不得生成资金期初或重复扣款。

## FLOW-CARD-METRICS-001

| 项目 | 内容 |
| --- | --- |
| 目标/基线 | 基于 main b300b97 的独立 card-metrics 工作树；客户端/运营查询只读来源指标 |
| 页面关系 | `/portal/cards` → `/portal/cards/:id` → 同卡统计消费明细；保留连接和返回上下文 |
| 身份/范围 | Firebase 核验邮箱、UID、启用和已验证状态，再核对个人客户及 project_wallet_cards 逐卡正式归属；manifest 固定连接/卡/客户/账户/钱包/绑定时间 |
| 数据依据 | Slash GET 官方交易 USD cents，posted 时 date 是入账时间；utilization 是周期可消费额度，非客户资金余额 |
| 接口链 | 通知验签收件箱/受控初始化CLI → 持久任务 → Slash GET → 脱敏观察/当前交易 → channelRead批量指标 → 客户列表与详情 |
| 状态与恢复 | queued/done/review，分页提交后推进游标，重试退避；401/403、范围变化和循环游标进入review，手动补同步创建新窗口 |
| 跨端 | 当前交易进入现有 channel_current_records；管理员权限和客户逐卡权限均保持；旧固定版本快照不切换 |
| 权限 | 页面刷新先按既有 channelRead 认证和卡归属校验；执行前后重新核对绑定、连接启用和客户状态；归属撤销后停止采集 |
| 验收 | E01/E03/E05/E06/E07/E08/E09：分页失败不推进、未全量不填零、重复导入/通知不重复、超JS安全整数精度、退款分开、旧通知回查、无授权不采集、无账本写入 |
| 待验证 | 真实账户API历史可取范围、全页覆盖及逐卡额度规则；生产迁移/上线与真实数据回填需单独记录，不用隔离样例替代 |

## 来源与口径

官方依据：[交易列表](https://docs.slash.com/api-reference/transaction-get)、[交易字段](https://docs.slash.com/api-reference/schema-transaction)、[卡利用情况](https://docs.slash.com/api-reference/card-utilization-get)。交易查询按连接、账户、虚拟账户、卡ID和 `filter:category=card` 固定；日期查询上游为闭区间毫秒，内部为UTC半开区间，结束参数减1毫秒。

近30天消费为最新完整扫描截至时点向前30×24小时内，category已由来源过滤确认、status=posted/detailedStatus=settled的负金额绝对值；退款单列，pending/failed/费用不混入消费。未知类别或矛盾状态不提供完整汇总。显示截至时点，不把旧基线声称为实时。

可消费额度直接保存来源availableBalance，可空；缺失为未提供，0为真实0，不用limit-spend回算。保存卡/卡组限制的白名单字段、当前spend、nextResetDate和采集时点；卡组额度不重复汇总为客户资产。

## 初始化与持续更新

迁移020新增只读表。`api card-metrics-plan EMAIL`核验Firebase后输出逐卡manifest；受控保存，不提交Git。`api card-metrics-enroll EMAIL`从stdin读取该清单，核验上游单账户并再次核对归属，幂等登记。Render一次性任务可传第三个参数为plan数组紧凑JSON的SHA256（无末尾换行），重新读取的清单必须逐字节一致才登记；归属变化拒绝。`api card-metrics-status EMAIL`只读输出逐卡指标和分页/失败/区间进度。先完成各卡近30天，再扫描接口可取得的更早历史；全历史查询起点1970不是历史保留无限的保证。只有游标全部读取完成才记录窗口完成。

每页白名单数据、观察证据及游标在同一事务提交，金额为numeric(38,0)/十进制字符串。页面沿用已有15秒本地数据库查询刷新，不额外重载整页；这不会触发渠道轮询。当前交易以连接+交易ID唯一，观察日志追加保留。周期 worker 只消费已排队通知/回填任务，空闲不请求Slash。

通知回查后更新同一交易并排队卡片窗口/额度刷新。新增交易的消费类别由后续过滤回填确认，不能仅凭cardId猜测。处理通知与历史采集共用现有全局advisory lock，不让旧分页并发覆盖较新通知结果；回填后额外扫描交接窗口。手动点击补同步与期间新增通知持久合并，固定窗口途中不改变结束时间，结束后继续处理晚到请求。

## 客户查询合同

原卡片列表/详情行新增可选`metrics`，不扩大卡授权。字段：currency/scale、availableMinor/availableAt/availability、sharedGroup/nextResetAt、from/to/updatedAt、coverage、spendingMinor/refundMinor、syncState。金额为字符串或null；coverage=complete仅证明指定截至窗口分页完成且无已知分类/状态缺口，不证明上游从未漏事件。

原交易列表增加`metric=spending`，与同一from/to及cardId组合，仅返回构成消费统计的已核实交易。`POST .../cards/:id/metrics-sync`只创建查询任务，返回202；不触发调额、冻结、充值或提现。使用相同网关白名单及客户授权。未初始化卡返回409。

## 运行边界

新增表不写原transactions、funds或Blnk。生产数据迁移使用定向`api migrate-card-metrics`，核对002/010/011/017/018/019 checksum；常规迁移也纳入020，但不得用全量迁移替代定向发布。上线前做数据库备份及恢复核验。`CARD_METRICS_ENABLED`默认关闭，允许先发布兼容程序；迁移020并核验checksum后才能设置为`true`，开启时启动及readyz检查020。回退程序应保留020表和已采集事实。

## 本次验证与交付边界

- 独立随机PostgreSQL数据库全量race回归通过，包括新增指标查询/越权、重复刷新合并、分页失败断点、重复导入、重复/乱序通知、未知分类、循环游标、归属撤销、规则周期白名单及无账本写入。迁移版本计数断言已从19更新为20。
- 整合交易UI e030d88 后前端157项回归通过，新增完整性/0与未知区分、大金额精度及消费明细区间一致性；客户端类型检查及生产构建通过。Go vet/build通过。文档/机器合同同步维护。
- Render只读任务 `job-damn1np42hec739ol490` 成功，确认指定邮箱为active customer、Firebase已验证且未禁用。未把身份核验等同于逐卡manifest完成。
- 本机直连Render PostgreSQL被IP白名单拒绝；Render SSH公钥认证未通过。未改白名单、密钥或权限。已有Render一次性任务环境可用。
- `api card-metrics-plan` 与 `api card-metrics-enroll` 尚未上线，故未生成真实逐卡manifest，也未回填真实历史。本次无生产迁移、部署、账本或真实金融写入。

历史任务到达review后，可在纠正原因后执行`api card-metrics-retry EMAIL`，第三个参数传任务UUID，或stdin传`{"runId":"任务UUID"}`。保留原游标；归属变更仍拒绝。若存在更新的同用途queued任务，唯一约束拒绝并发恢复；不要通过清空表强行重试。

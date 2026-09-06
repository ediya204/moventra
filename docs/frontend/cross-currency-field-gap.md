# 跨币种卡消费字段差异与实施顺序

## 当前仓库状态（2026-09-07）

以下映射与查询矩阵属于旧跨币种 Demo。当前 Go 不支持该 FX DTO、时间线、来源关系和多币种汇总；后续实现以领域规范和机器契约为准。

本页为历史设计/实现档案。下方的“当前”“已实现”“本次”均指原记录当时；历史端口、脚本、迁移、数据及测试结果不代表现有仓库可复现或生产已验收。当前能力与可执行命令见 [文档索引](../README.md)、[开发总纲](../DEVELOPMENT.md)。

## 历史记录正文

核验日期 2026-09-06。检查 React/旧查询 DTO、SQLite source_records/source_versions/余额/关联表、Node 适配层与 Go 基础契约。Go 的正数 amountMinor+direction 及三状态契约不适合直接覆盖；本次不改 Go 业务库。旧 S01–S20、Portal 钱包和 BIN 数据保留。统一列表通过008只读视图联合两套数据；精确跨币种报表保留独立统计范围。

官方依据：[Transaction](https://docs.slash.com/api-reference/schema-transaction)、[单笔](https://docs.slash.com/api-reference/transaction-get-by-id)、[费用详情](https://docs.slash.com/api-reference/transaction-get-fee-details)、[余额](https://docs.slash.com/api-reference/account-balance-get)、[事件](https://docs.slash.com/api-reference/schema-webhook-event)。2026-09-06 获取 https://api.slash.com/openapi，info.version=0.0.1，SHA256 `013031ce79340b529594d6401ee84d00a71ae1802d6a097aa971b80cfecab481`。版本号不代表长期不变。

| 字段 / 官方类型 | 已有情况与差异 | 本次采用及展示 | 依据 |
| --- | --- | --- | --- |
| id/string、accountId/any、cardId/virtualAccountId/string可选 | 已存，旧 Go 唯一键范围不足 | 复用来源白名单，新投影按namespace+connection+entity+sourceId隔离；详情标识组 | 来源；内部范围为设计 |
| amountCents/number必填 | 已存安全整数；旧接口嵌套金额number | USD账户金额为整数字符串+scale=2；列表、详情、日报；pending不当最终金额 | USD分/符号为来源规则 |
| originalCurrency.code/amountCents/conversionRate | 对象可选、子字段必填；已存但汇率和金额number，格式统一除100 | 原币金额、原币scale、来源精确汇率字符串分开；缺失子字段视为质量缺口 | 来源；CNY/AED scale=2为明确Demo单位假设 |
| status/detailedStatus | 已保留但三态汇总不足 | 分开显示中文和原值；未知枚举保留并进入差异 | 来源 |
| authorizedAt/string可选 | 无完整授权金额历史 | 只从实际采集到的pending观察取授权金额；缺失null | 时间来源，授权金额为观察派生 |
| date/string必填 | 已保存状态相关语义 | sourceDate原值，postedAt仅posted时派生，pending/failed为创建日期 | 来源+派生 |
| accountSubtype/cash或credit | 已存 | 详情保留；不当Balance.type | 来源 |
| fxFeeInfo.amountCents/number | 已存USD分注释 | 单独入账/已包含/未知为内部证据；注释不产生额外资金影响 | 注释为来源；入账策略待确认 |
| cashbackInfo.amountCents/rate | 已存 | 返现注释不当收入；仅实际posted返现记录计入，待入账单列 | 来源；记录分类为Demo假设 |
| feeInfo.relatedTransaction.id/amount | 已存；amount单位未明确 | 保留白名单，金额字符串原值但不参与计算；只将关联候选交由证据模型 | 部分来源，amount单位待Slash确认 |
| FeeTransaction.id/dateCharged/feeAmountCents/feeType/accountId | 独立费用对象已有，跨币种无去重链 | 费用明细与费用资金记录使用相同来源身份关联；仅交易记录计资金 | 来源结构；feeType值不冒充已确认枚举 |
| orderId/referenceNumber/providerAuthorizationId | 已存 | 详情与后端关键词筛选，不作为唯一键，不据商户orderId认定退款 | 来源 |
| Balance.available/posted/type/timestamp | 已存，但缺跨币种报表核对 | 按账户/币种/cash-credit-debit分别保存与展示；币种来自明确账户上下文 | 来源+上下文派生 |
| eventId/eventTimestamp/entityId/event | 旧Demo版本是模拟权威版本 | 新事件表按连接/eventId去重；事件时间不为GET响应定版本；采集请求序号单独存储 | 来源+内部采集模型 |
| 无官方通用父退款/分次清算ID | 旧关系仅Demo假设 | 独立证据关系，未匹配不计原订单净额；可计账户资金流 | 内部设计，待Slash确认 |
| 无统一费用策略/完整同步标识 | 缺失 | feeTreatment、matching、syncState、scopeComplete、assumption，明确内部字段 | 内部设计 |
| 无每日币种汇总 | 已有即时SQL汇总，无原币/跨月口径 | 按账户类型、币种、UTC/Hong Kong、入账/原订单日预聚合 | 内部派生 |

顺序：增量存储与精确金额 → 来源适配与采集历史/证据 → 固定种子隔离Demo → 日报/列表/详情/导出 → MUI后台列表/详情/报表/余额/对账 → 金额不变量及HTTP/页面验收。

新模块使用独立 `/local-slash-demo/management/fx` 查询接口，继承本地操作员会话，不替换 Go 草案 `/financial`。当前仅隔离Demo，不宣称生产MFA、客户租户授权、真实Webhook验签或真实渠道同步已完成。官方未确认的原币符号、非两位币种编码、退款父关联、分次清算、返现资金记录与费用实际政策均为上线前待核实项，负责人待分配。


## 查询和展示能力矩阵

“来源必填”指官方完整对象；投影允许缺失以兼容旧采集。金额在我们的API中为字符串，不修改Slash对外字段类型定义。

| 字段路径 | 完整来源必填情况 / 含义 | 列表默认/可选 | 筛选 | 排序 | CSV |
| --- | --- | --- | --- | --- | --- |
| id | 必填string，来源交易身份 | 商户副标题 | 关键词 | ID | 是 |
| accountId | 必填，当前OpenAPI未限制具体type；账户身份 | 可通过账户筛选，详情标识 | 精确账户/关键词 | 否 | 是 |
| virtualAccountId、cardId | 可选string，关联虚拟账户/卡 | 详情/本卡入口 | card服务端支持；关键词 | 否 | CSV未含virtualAccountId；详情可见 |
| status | 必填enum，pending/posted/failed | 默认中文 | 是 | 否 | 是 |
| detailedStatus | 必填enum，保留refund/reversed/dispute等区别 | 默认中文 | 是 | 否 | 是 |
| amountCents | 必填number，账户USD分，负扣款正入款 | 默认账户金额 | 币种/状态 | 精确金额 | 是 |
| originalCurrency | 可选object；code/string、amountCents/number、conversionRate/number在对象中必填 | 原币金额默认、汇率可选 | 原币、是否跨币种 | 否 | 是 |
| authorizedAt | 可选string；平台授权时间，不是授权金额 | 默认 | 授权日期范围 | 是 | 是 |
| date | 必填string；posted为入账，pending/failed为创建 | 入账时间默认、来源日期可选 | 来源/入账日期 | 是 | 是 |
| accountSubtype | 必填cash/credit，不等于余额type | 详情 | 无单独UI筛选 | 否 | 来源详情保留 |
| orderId / referenceNumber / providerAuthorizationId | 可选string，原订单/参考/授权标识；不是全局唯一键 | 详情 | 关键词 | 否 | 当前CSV未展开，详情保留 |
| merchantData.description/categoryCode | merchantData可选；出现时两者必填string | 描述在详情；交易description默认 | 关键词（包括MCC） | 否 | 当前CSV不展开商户对象 |
| merchantData.location.city/state/country/zip | location可选；出现时四个string必填 | 详情 | 关键词 | 否 | 否 |
| fxFeeInfo.amountCents | fxFeeInfo可选；出现时amountCents/number必填，USD分 | 详情 | 独立fee分类 | 否 | 独立费用交易金额可导出 |
| cashbackInfo.amountCents/rate | cashbackInfo可选；两者number必填 | 详情 | cashback/adjustment分类 | 否 | 独立返现流水可导出 |
| feeInfo.relatedTransaction.id/amount | feeInfo可选；relatedTransaction子字段为来源关系候选；amount单位未明确 | 详情白名单来源展开 | 关键词 | 否 | 否 |
| FeeTransaction.id/dateCharged/feeAmountCents/feeType/accountId | 全部必填；originalTransaction/card可选。feeAmountCents为费用分，feeType string无公开封闭枚举 | 详情费用说明表 | 按独立费用交易查找 | 否 | 交易流水层导出 |
| Balance.accountId/type/available/posted/timestamp | 全部必填；type=cash/credit/debit，available/posted是分别的Money对象 | 余额快照表；页面暂缓，保留只读接口 | 账户/币种（接口） | 否 | 本次无余额CSV |
| WebhookEvent.event/eventId/entityId/eventTimestamp | 全部必填；event为官方事件类型，entityId为触发事件的对象ID | 详情展开 | 按交易取得事件 | 采集请求有序显示 | 本次无事件CSV |

内部字段：accountAmount/ originalAmount各含minor字符串、currency、scale；sourceKind标注fx/legacy查询投影；crossCurrency仅按已知币种身份派生；displayRatio为计算比值；postedAt条件派生；sourceDate保留原值；category/feeTreatment/matching/syncState为内部设计；observations.requestSequence不是Slash版本；net.scopeId/scopeKind明确原订单或孤立记录的计算范围。

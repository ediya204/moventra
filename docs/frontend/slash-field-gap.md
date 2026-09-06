# Slash 字段差异与实施顺序（2026-09-06）

## 当前仓库状态（2026-09-07）

以下字段表记录旧 Node/SQLite Demo 的映射，不能当作当前 Go 已实现字段。当前 Go 查询投影仅支持 USD/USDT、正数 amountMinor + direction；跨渠道来源模型仍为设计。

本页为历史设计/实现档案。下方的“当前”“已实现”“本次”均指原记录当时；历史端口、脚本、迁移、数据及测试结果不代表现有仓库可复现或生产已验收。当前能力与可执行命令见 [文档索引](../README.md)、[开发总纲](../DEVELOPMENT.md)。

## 历史记录正文

检查范围：React `src/api`、`packages/shared/src/types.ts`、运营页面、Node `demo-server/server.mjs` / snapshot.json、独立 Go API 的 `001_initial.sql`。现有运营页面实际接 Node / 旧 admin-api；Go/PostgreSQL 不参与该链路。本轮沿用 Node Demo 技术栈，增加独立本地入口、命名空间 JSON 批次和可重建 SQLite 查询投影，不迁移或填充 Go 业务库，不覆盖旧 snapshot.json。SQLite 为本地 Demo 新增存储；生产数据库迁移与真实渠道接入不属于已完成结果。

实施顺序：P0 来源模型、金额/状态/时间与余额 → P1 商户、费用、卡片及关联 → P2 版本/事件/对账记录 → 参数化场景导入 → 后端过滤排序分页 → 现有运营页面与场景入口 → 自动化和浏览器验证。

类型和必填以官方 schema 为准；可选对象的必填子字段仅在对象存在时必填。来源字段位于 `source` 白名单对象，业务归属、分类、关联证据和同步信息位于 `internal`。所有 Demo 关联均不能当作 Slash 保证。

|优先级 / Slash 路径|官方类型 / 必填 / 含义|现有字段与差异|采用字段 / 展示位置|来源|查询能力|
|---|---|---|---|---|---|
|P0 Transaction.id|string 必填；来源交易标识|billId/cardTransactionId 命名与范围不同|source.id；列表/详情。旧 billId 保持原样，不作为来源唯一键|直接|筛选/排序/导出|
|accountId|any 必填；所属来源账户|userId 是内部客户，语义不同|source.accountId；平台标识/账户详情|直接|筛选/导出|
|virtualAccountId|string 可选；来源虚拟账户|缺失|source.virtualAccountId；关联标识|直接|筛选/导出|
|cardId|string 可选；关联来源卡|现有 cardId 是内部ID|source.cardId 与内部cardId分别保留|直接|筛选/导出|
|status|enum 必填；pending/posted/failed|tradeStatus 0/1/2 丢失原值|source.status；列表/金额状态组|直接|筛选/排序/导出|
|detailedStatus|enum 必填；pending/pending_approval/in_review/canceled/failed/settled/declined/refund/reversed/returned/dispute|缺失，现有成功/失败不足|source.detailedStatus + 中文解释，未知值显示未知状态并保留原值|直接|筛选/导出|
|amountCents|number 必填；USD分，负借记正贷记|amount 字符串美元、无可靠方向|source.amountCents；SQLite INTEGER signed_amount_cents；兼容 amount 精确美元字符串|直接|范围/排序/导出|
|无独立币种字段|amountCents 文档明确 USD|currency 可复用|currency=USD，标记文档派生|派生|筛选/导出|
|无独立方向字段|按 amountCents 符号|缺失|direction=debit/credit/zero；无值不当零|派生|筛选/导出|
|originalCurrency.code|string 对象内必填；原币代码|缺失|source.originalCurrency.code；金额组|直接|筛选/导出|
|originalCurrency.amountCents|number 对象内必填；原币分|现有 amount 混用风险|独立 original_amount_cents INTEGER；金额组|直接|导出|
|originalCurrency.conversionRate|number 对象内必填；交易时原币转账户币种汇率|缺失|source 原值；索引投影 conversion_rate_decimal TEXT；不使用浮点累计或重算金额|直接|导出|
|authorizedAt|string 可选；UTC 授权时间|createTime 不能等同授权|source.authorizedAt；时间组|直接|时间筛选/排序/导出|
|date|string 必填；posted为UTC入账时间，pending/failed为创建时间|createTime/finishTime 语义不同|source.date；来源日期，旁注状态相关含义；postedAt仅posted派生|直接+派生|时间筛选/排序/导出|
|accountSubtype|cash/credit 必填；debit账户交易也为cash|缺失|source.accountSubtype；金额状态组|直接|筛选/导出|
|Balance.accountId / type|string 必填；cash/credit/debit（注意不同于accountSubtype）|channel accountType='card'不等价|source余额对象；账户详情分行展示|直接|账户定位/导出|
|Balance.available.amountCents|number 必填；立即可用|availableBalance 美元字符串|复用兼容字段并新增来源整数分；账户/报表|直接|排序/导出|
|Balance.posted.amountCents|number 必填；已入账不含pending|缺失|postedBalance兼容展示及来源整数分|直接|导出|
|Balance.timestamp|string date-time 必填；计算余额UTC时点|snapshotTimeText 可语义映射|来源原值与采集时间分别展示|直接|排序/导出|
|P1 orderId|string 可选；商户订单号，不是全局唯一|缺失|source.orderId；订单关联组|直接|筛选/导出；不设唯一键|
|referenceNumber|string 可选；Visa参考号|缺失|source.referenceNumber；关联组|直接|筛选/导出|
|providerAuthorizationId|string 可选；渠道授权标识|tradeAuthCode 不是同义字段|source.providerAuthorizationId；关联组|直接|筛选/导出|
|merchantData.description|string 对象内必填；商户原始描述|merchantName/tradeDetail简化|source原值；merchantName兼容适配；商户组|直接|筛选/导出|
|merchantData.categoryCode|string 对象内必填；MCC|缺失|source 原值；商户组|直接|筛选/导出|
|merchantData.location.city/state/country/zip|string 可选；商户地区|缺失|source 地区白名单；商户组|直接|导出|
|memo|string 可选；交易备注|notes/tradeDetail不能覆盖|source.memo；商户组|直接|关键词/导出|
|declineReason|string 可选；仅declined|failureCode不完全等价|source原值；金额状态组|直接|导出|
|approvalReason|string 可选；pending或settled|缺失|source原值；金额状态组|直接|导出|
|fxFeeInfo.amountCents|number 对象内必填；USD分费用信息|tradeFee泛化|source.fxFeeInfo；费用组，不再次作为独立扣款累计|直接|导出|
|cashbackInfo.amountCents / rate|number 对象内必填；已知返现金额与适用比例|缺失|source.cashbackInfo；费用组，不自动入账|直接|导出|
|feeInfo.relatedTransaction.id / amount|string/number 对象内必填；官方未说明amount单位|缺失|白名单保留；不换算或作为对账依据；Demo不伪造未明确单位|直接（未明确部分待确认）|详情/导出|
|FeeTransaction.id/dateCharged/feeAmountCents/feeType/accountId|string/string/number/string/string 必填|缺失|独立 fee 来源对象；费用交易详情返回items；金额不与交易行重复累计|直接结构；Demo feeType值待确认|详情/导出|
|FeeTransaction.originalTransaction/card|对象 可选；关联原交易及卡|缺失|白名单嵌套对象；费用关联组|直接结构；Demo关联是假设|详情|
|Card.status|active/paused/inactive/closed 必填|cardStatus 1/2/999 不完整|原值独立，中文解释；不把未知状态当正常|直接|筛选/导出|
|Card.last4/name/isPhysical|string/string/boolean 必填|cardNoMasked/cardName 可复用展示|来源原值；仅后四位，卡详情|直接|筛选/导出|
|Card.expiryMonth/expiryYear|string 必填；MM/YYYY|缺失|来源原值；卡详情|直接|详情/导出|
|Card.accountId/virtualAccountId|string 必填/可选|内部userId不等价|来源归属与客户映射分开|直接|筛选/导出|
|Card.cardGroupId/cardGroupName/cardProductId|string 可选|缺失|来源原值；卡详情|直接|详情/导出|
|Card.spendingConstraint|对象 可选；消费规则|cardBalance不能映射|来源白名单限额规则；与账户余额独立分组；卡余额显示未提供|直接|详情|
|Card.createdAt|string date-time 可选|createTime 毫秒|来源原值，兼容派生毫秒|直接+派生|排序/导出|
|P2 Webhook.event/eventId/entityId/eventTimestamp|enum/string/string/date-time 必填；通知元数据而非实体快照|缺失|独立 source_events + deliveries；交易可关联多个事件|直接|详情/事件ID查询|
|无来源对象updatedAt/version|文档未提供通用事务版本|缺失|internal.version 仅用于Demo模拟权威GET版本；不伪造source.updatedAt|Demo假设|详情|
|无来源采集与同步字段|非Slash字段|缺失|internal.firstCollectedAt/lastSyncedAt/syncError/entityId/platform|内部|筛选/导出|
|无可靠通用清算/退款父ID|orderId不足以可靠匹配|缺失|独立 relations：from/to/type/evidence/confirmation；未匹配保留|Demo假设|场景/详情/风险|
|无完整业务清算事件|部分场景未公开表达|缺失|internal_adjustments 与版本/余额快照：争议临时贷记、扣回、费用冲回、返现调整；明确待Slash确认|Demo假设|详情/场景/报表|

## 来源与明确边界

核对 [Transaction](https://docs.slash.com/api-reference/schema-transaction)、[Card](https://docs.slash.com/api-reference/schema-card)、[余额](https://docs.slash.com/api-reference/account-balance-get)、[费用](https://docs.slash.com/api-reference/transaction-get-fee-details)、[事件](https://docs.slash.com/api-reference/schema-webhook-event)、[Webhook](https://docs.slash.com/api-reference/webhook-overview)。嵌套结构以费用接口发布的 OpenAPI schemas 交叉核对。

Webhook 仅存通知元数据；使用 eventId 去重，再模拟 GET 当前实体。事件乱序不能靠时间戳直接覆盖当前对象；Demo版本是内部测试假设。`payments.refund.*` 不当作卡退款事件使用。真实签名校验没有伪造；本批不调用 Slash API。

账户现金、信用与debit余额不跨类型合计。Demo只生成debit账户，其交易accountSubtype按官方使用cash。客户、实体和虚拟账户资金归属关系是内部Demo映射。敏感PAN、CVV、OTP和真实凭证在采集白名单之外；即使上游对象包含也不会保存或返回。

## 最终落地范围与接口能力

- 本地入口 `npm run slash:demo`：页面 127.0.0.1:8852，Node API 127.0.0.1:8862，固定 loopback；8850的Portal现已通过独立本地代理接入同一来源数据，原资金流程与卡片/交易已融合，取消模式切换。新页使用现有后台路径（`/workbench`、`/customers`、`/cards`、`/transactions`、`/risk`、`/reports`、`/reconciliation`）的隔离模式分支。
- 数据结构：`source_records` 内白名单 `source_json` + nullable 查询列；`internal_json` 单独存系统字段。金额是 SQLite INTEGER，汇率查询投影为十进制 TEXT，汇总为 SQLite 整数 SUM，JS计算使用 BigInt。没有新增/改名旧业务字段。
- 查询前缀 `/admin-api/settlement-management/demo/`，交易、卡片、账户目录及详情；`summary`、`scenarios`。列表 SQL 过滤、排序和LIMIT/OFFSET，单页上限100；返回统一来源DTO。旧 admin-api DTO/Go模型不强制添加 Slash必填项，非Slash旧页面保留原实现。
- 交易筛选：keyword（含事件ID）、status、detailedStatus、platform、entityId、currency、originalCurrency、accountSubtype、accountId、virtualAccountId、cardId、scenario、orderId、referenceNumber、providerAuthorizationId、mcc、matchingStatus、minAmount/maxAmount（整数分）、from/to（UTC日，结束日含当天）、timeBasis=date/authorizedAt。UI显示常用筛选；调查字段支持URL/API查询，不全部堆进列表。
- 排序白名单：id、amount、date、authorizedAt、status、detailedStatus、originalCurrency、createdAt、timestamp、available、posted；仅相关对象适用。UI当前交易常用列排序；其他排序可通过API。没有对所有新列建索引。
- 导出：`transactions.csv`、`cards.csv`、`accounts.csv`、`balances.csv`，服务端分批100条输出白名单列。费用嵌套来源对象/版本/事件完整信息保留在详情JSON，CSV不导出原始平台完整对象。
- 可选账户银行路由和账号字段不入采集白名单。VirtualAccountModel.accountType为`default|primary`，本批为`default`；不能用debit/cash替代。未使用未明确语义的虚拟账户balance/spend聚合代替父账户余额。
- 所有后台来源字段都由同一SQLite查询投影返回；独立Go/PostgreSQL业务API尚未迁移，真实Slash读写/签名验证未接入，不把本地结果称为生产能力或真实对账结果。

## 客户端内部投影补充

`Card.slash`、`Entry.slash` 保留白名单来源字段；`Card.sourceBalance` 独立展示来源账户available/posted，`balanceKind=internal_budget`标识既有balance的内部预算语义。`Entry.orderId`仅用于内部资金订单，Slash商户订单保留在 `Entry.slash.source.orderId`。`statusText`用于两层来源状态中文展示；原兼容status不替代来源枚举，未知值标记未知状态。新增portal_state/portal_actions迁移002为内部存储；范围、回退、命令与本地测试见 [客户端融合说明](./slash-demo.md#客户端融合2026-09-06取代此前模式切换)。

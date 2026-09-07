# 运营总览只读契约

2026-09-07。本页描述已实现的客户交易聚合契约；`a42e2b9` 已随后台资金概览发布，运行版本及验证见[此前发布记录](../../../deploy/2026-09-07-operations-overview.md)。`0d5158d` 新增独立渠道只读投影，`2918584` 的[发布记录](../../../docs/releases/channel-projection-2026-09-07.md)已确认 Render 与两端 Worker 部署，但该数据未合并进本概览统计源。本轮 Markdown 整理仅引用历史记录，没有重新部署、运行测试或完成本人登录后的业务验收。身份与开通边界见[正式身份与业务开通](../../../docs/business/identity-and-production.md)。

`GET /admin-api/v1/ops/overview?days=14`，返回 `{ "data": OperationsOverview }`，机器定义见 [OpenAPI](openapi.json)。仅接受单个 `days=7|14|30`，默认 14；未知参数或重复参数返回 400。不接受调用方自报客户 ID、角色、币种或授权范围。

认证使用现有 Firebase Bearer，检查撤销、邮箱验证、本地用户状态和已验证 MFA。查询只包含该身份已有 `transactions:read` 的客户；仅有 `accounts:read` 或普通客户身份无权访问，返回 403 `scope_required`。本接口没有创建新资源权限或全局授权，不查询账户/客户/卡/商户元数据。每次请求重新检查授权；授权、统计及逐客户 `transactions:overview:read` 审计处于同一 Repeatable Read 事务。审计失败返回 503，不返回聚合数据。响应禁止缓存。

资金及时间口径：

- 固定 USD、scale=2；USDT 不参与金额、笔数或状态统计，也不进行汇率换算。
- 仅现有 `transactions.status=succeeded` 的正数 `amount_minor` 按 `credit`/`debit` 分别计流入/流出；净额为流入减流出。`pending` 和 `failed` 只统计笔数。
- `totals.posted`、`daily.posted` 是现有 `succeeded` 计数的页面兼容字段；`statuses` 仍返回 `succeeded/pending/failed`。现有成功状态不证明渠道结算，本接口没有新增授权/入账/退款/争议状态维度。
- 分桶使用 `occurred_at` 和 `Asia/Hong_Kong`；包括今天在内的最近 7/14/30 个自然日，从首日 00:00 到本次请求时间，区间 `[from,to)`。不是滚动 N×24 小时，也不冒充结算日。
- PostgreSQL 的 bigint 求和生成 numeric，转十进制整数字符串；Go 使用 `math/big` 合计每日值，支持累计超过 int64。所有金额在 JSON 中保持字符串。
- 缺少记录的日期金额为 null；有记录但没有成功交易的日期金额为字符串 `"0"`。总计零仅表示所读投影内没有成功金额，不证明渠道没有资金活动。
- 没有来源覆盖证明，`coverage.complete=false`。没有明确内部转账关联，统计不消除转账两端，不命名为平台营收、利润或可用余额。
- `activeCards/selectedCards/customers/activeCustomers=null`，对应 `availability=false`；`merchants=[]` 表示该能力不可用；`review=0` 仅是兼容字段，生产模型没有复核状态维度，不作为“无需复核”的结论。
- `sync.lastSuccessAt=null`、`state=not_connected`、`mode=projection_read`；请求时间 `asOf` 是投影查询时点，不是上游同步成功时间。
- `revision` 为身份、授权客户集合、日期范围和精确聚合内容的哈希，用于页面辨认内容更新；不是渠道版本，也不是可重放/持久化的报表快照。

查询仅覆盖上限 30 个自然日，数据库按授权范围和既有客户时间索引处理，返回最多 30 个日桶；继承请求 10 秒超时。概览功能本身不需要结构迁移，不提供资金写接口或上游渠道调用。独立渠道增量另有 migration 002 与受控导入，不能用本页概览边界否认该增量，也不能将其数据自动合入概览。尚未实测生产数据量，不承诺全量负载指标。

本地自动化覆盖 `overview_test.go`：自然日跨 UTC 边界、参数白名单、超过 JS 安全整数及 int64 的累计金额、USD/USDT 隔离、无记录日、pending/failed 不入流量、匿名/伪造凭证/禁用身份/MFA、accounts-only 默认拒绝、跨客户范围、范围撤销、审计失败、状态更新和 revision 更新。数据库用本地随机 `moventra_test_*` 及独立 schema，测试后销毁；不调用真实 Firebase 或资金渠道。

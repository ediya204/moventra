# FLOW-CARD-TEST-01 客户卡片测试快照

2026-09-18。用户授权将当前线上卡片及关联数据绑定到指定客户邮箱用于测试，并确认补齐查询链路。基线 origin/main bdb7c7f，独立 codex/customer-card-binding 工作树；共享目录改动不纳入。

## 范围与兼容

受控 CLI 核验 Firebase 邮箱、UID、未禁用及已验证状态，匹配 active/customer 本地身份和既有个人主体。先输出计划；执行要求明确连接、导入 revision 和卡片数量。只授权当前已导入快照内卡片及同连接/cardId 的交易，不自动开放未来导入或新增卡。不改原始金额、状态、客户角色、开户审批、钱包和资金账本。绑定是内部测试数据查看授权，不声称历史资金所有权。

每卡按连接隔离且拒绝改绑；同客户同连接固定一个 snapshot revision，重复执行幂等。绑定、原因、目标身份、时间和批次及读取均审计。任何冲突整批回滚。没有 HTTP 绑定写入口。目标无主体时先报告，不能偷偷开通或激活。

## 页面与接口链

/portal/cards → 卡列表 → /portal/cards/:id?connection=... → 该卡交易 → /portal/card-transactions/:id?connection=... → 卡片详情；查询参数保留分页，浏览器返回恢复。/portal/transactions 增加卡片快照交易区，保留既有业务交易。

客户端 liveGet → 同域 Cloudflare 精确 GET 白名单 → Go Firebase 验证及 active/customer → 个人主体所有权 → 显式快照/逐卡绑定 → 来源白名单字段 → 原子读取审计。无绑定返回空连接列表；跨主体、连接、卡、交易及父子不匹配返回 404。内部处理不改上游 Slash。来源数据覆盖不全，页面说明来源时间、导入时间、测试快照；金额直接使用来源整数字符串，不计余额。

GET /client-api/v1/customers/{customerID}/card-projections
GET /client-api/v1/customers/{customerID}/card-projections/{connection}/{cards|transactions}[/{id}]

列表每页20条；沿用 page/keyword/revision/cardStatus 或 detailedStatus/from/to/cardId。未知和重复参数拒绝。返回 data.rows,total,page,revision,sourceAt,importedAt,complete=false,syncMode=test_snapshot。客户端裁剪 accountId 和未声明字段，不返回渠道授权信息。

## 验收

验证绑定幂等、数量/revision变化拒绝、冲突回滚、禁用/管理员/其他客户拒绝、跨连接同ID、25张卡分页、无卡交易排除、精确金额、导入更新不扩大测试范围、审计失败不返回数据。网关验证仅客户端 GET、跨端和写请求拒绝。页面验证加载、空态、错误、深链和返回。生产迁移前备份、校验、隔离恢复；绑定后读取计数与快照关联一致，原金融表不变。

设计：已记录。实现、自动化、浏览器、线上绑定、部署：待本次执行更新。真实渠道调用不适用（只读既有导入数据）。

## 同批开户状态文案修正

用户反馈已审核账户仍见待审批；线上本人会话与审批面板确认已审批开通。发现快捷入口及未接入模块把所有 `enabled=false`（包括状态加载/失败、暂停、已审核未激活）统一称为待审批。改用实际 onboarding 状态文案，未读取到状态不再声称等待审核；不写审批记录，不重新提交申请。

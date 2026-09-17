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

设计、实现、自动化、线上绑定、部署已完成；本人浏览器验收等待双重验证。真实渠道调用不适用（只读既有导入数据）。

## 同批开户状态文案修正

用户反馈已审核账户仍见待审批；线上本人会话与审批面板确认已审批开通。发现快捷入口及未接入模块把所有 `enabled=false`（包括状态加载/失败、暂停、已审核未激活）统一称为待审批。改用实际 onboarding 状态文案，未读取到状态不再声称等待审核；不写审批记录，不重新提交申请。

## 本次验证记录（发布前）

- 2026-09-18：最新 main 运行优化已合并，保留连接池、Worker 和 2 秒 readiness checksum 校验；readiness 新增必需 007，006 仍仅 ledger 模式要求。
- 前端/网关及实际 React 页面回归共 89 项通过；覆盖七项客户端导航的未知、审批通过、暂停、审核通过未激活状态，以及审批面板加载与读失败恢复。两端 typecheck/build 通过（既有大包提示）。Go 隔离 PostgreSQL race、vet/build 通过；真实 Firebase/Blnk 集成依赖用例未执行。
- 平台备份 `2026-09-17T16:55Z` 已下载，SHA256 `79e4a08f921dcd2cc5d5b15cef75db0937569f4528e243a780e20983b09d9f18`；在本地全新数据库恢复应用库，通过 001–005 checksum、007 迁移及重复执行验证。
- 还原库真实快照验证：260 张卡全部可查询；关联交易 3818 笔，卡/交易页各返回20条及准确总数，客户响应无共享 accountId。其余1755笔交易引用缺少卡资料的269个 cardId，未授权、未伪造卡片，也未转移历史资金归属。
- 原 users/customers/memberships/accounts/transactions/staff_grants/channel_connections/channel_records 计数及逐行聚合摘要已保存，生产迁移与绑定后复核。线上账户核验 active/customer、approved/active，未重新审批。
- 生产执行与本人浏览器验收结果另行追加；本节只记录以上已经执行的验证。

## 生产执行记录

- main 代码 `d70b04a51bb8de66b6a20c7fba27493cdd7d0bea`，Render `dep-dam1r97qj5pc73bhcb50` 已 live。healthz/readyz 均正常。
- 备份及隔离恢复验证后，仅应用 007（作业 `job-dam1qe7qj5pc73bh9qp0` 成功）；生产迁移版本为 1–5、7，未启用 006 或 Blnk。
- 受控 CLI 计划核验 Firebase 和既有客户后，作业 `job-dam1sb0u01pc73b66oi0` 新增260条测试绑定、1个固定快照；复核作业 `job-dam1sgmk1f9s73e5v5hg` 确认关联3818笔交易。1755笔缺少卡资料的交易仍不开放。
- 迁移前、迁移后、绑定后八张原表的计数及逐行聚合摘要完全一致：users、customers、memberships、accounts、transactions、staff_grants、channel_connections、channel_records。未改变角色、审批、源数据或金融账本；未调用真实金融写接口。
- 客户端 Worker `37f0091f-64f7-404a-883d-499bd9c3e1ba`、后台 Worker `c7ad27de-678f-4f68-9c71-a38ae6b8f4a7` 已发布。通过 curl 验证客户卡片接口未登录401、POST405、后台域名跨端访问404。
- 新窗口通过 Google 选择指定客户账户后到达双重验证页面；已请用户自行完成，尚不把页面登录后的业务验收标为通过。自动化及还原库读取结果见上文。

## 登录后发现的渲染回归

用户完成 MFA 后截图显示多个开户面板及顶部状态冲突。定位为 ClientHome 同级 OnboardingPanel 与 CardSnapshots 同用 customer.id 作为 React key，状态更新导致错误组件复用。分别使用 onboarding/cards 命名空间，保留客户切换时卸载旧状态。集成测试以真实 OnboardingPanel 连续刷新三次，同时验证卡片、交易两页面板唯一、顶部状态同步、无重复 key 警告；修复前失败，修复后通过。

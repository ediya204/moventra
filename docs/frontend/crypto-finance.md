# 数字货币资金工作台（本地隔离实现）

## 当前仓库状态（2026-09-07）

数字货币页面保留在 `apps/admin/src/finance`；fn_* 数据、010 迁移、出金任务及合成通道服务未纳入仓库。生产没有 OTC、链上出金或审批执行能力。

本页为历史设计/实现档案。下方的“当前”“已实现”“本次”均指原记录当时；历史端口、脚本、迁移、数据及测试结果不代表现有仓库可复现或生产已验收。当前能力与可执行命令见 [文档索引](../README.md)、[开发总纲](../DEVELOPMENT.md)。

## 历史记录正文

## 1. 现有能力与缺口

| 能力 | 检查结果 | 实施边界 |
|---|---|---|
| 钱包/订单 | Portal JSON 持久化 USD、USDT；充值/提现/兑换演示 | 保留旧订单查询，不把预算迁移成可出金余额 |
| OTC 方向 | 已有内部钱包 USD ↔ USDT；固定演示报价 60 秒、卖出总额含费 | 沿用方向和报价公式；不增加银行收付或币币方向 |
| 账本 | ca_accounts/journals/entries 双边整数分录与不可变触发器 | 复用记账原语，finance-workbench-v1 独立范围 |
| 旧 Vue 审批 | digitalTransferReview 已有 approve/reject/retry 接口封装；当前 Go 未提供这些执行实现 | 保留旧前端；不调用未知旧付款接口，不假定通道重试安全 |
| 审批 | 卡片模块有身份、审批/执行分离；旧提现演示无后台复核 | 增加独立出金预占、版本审批、多人复核与持久通道任务 |
| 风险/通道 | 无可执行数字货币风险服务或真实支付通道 | 明示未接入；仅测试检查器和隔离通道夹具 |
| 权限 | 本地 HttpOnly 操作员会话；不等于生产 MFA | 逐项后端 finance 权限，继承会话，不接受浏览器指定角色 |
| 查询/菜单 | 资金订单只读列表；无数字货币专属流水与 OTC | 新增三个入口，服务端筛选/分页/导出；旧入口保留 |

## 2. 菜单、页面与流转

资金与财务 → 数字货币流水 `/finance/crypto-flows`、OTC 管理 `/finance/otc`、出金审批 `/finance/withdrawals`；独立订单详情 `/:id`。流水可快速抽屉查阅并进入关联订单。

- 订单：draft → pending → processing → completed；另有 rejected/cancelled/exception。审批、执行、入账、链上状态独立保存。
- OTC：草稿锁定报价 → 确认（再次检查服务器有效期）→ 同一事务内部钱包收/付两侧入账 → 完成。内部兑换没有等待银行到账的步骤；不伪造银行交割。兑换后的 USDT 可另外创建关联出金审批单。
- 出金审批：pending → reviewing → approved / rejected / cancelled。修改金额/网络/地址使版本递增、旧审批保留但失效，并重建预占。退回资料只允许未提交执行的订单；不自动释放未结案资金。
- 执行：not_submitted → submitting → channel_processing / unknown → chain_confirming → completed，明确失败为 failed。超时查询原任务，不能重复发送；部分交割显示累计与剩余，最终失败仅释放未交割预占。
- 流水仅统计已记账影响；冻结/释放只进入审计和预占，不能算收入。费用独立分录，订单费用字段不再累计。

## 3. 数据、接口与规则

增量迁移 010。复用 ca_* 账本，新增 fn_wallets、fn_orders、fn_quotes、fn_holds、fn_reviews、fn_events、fn_jobs、fn_movements、fn_requests、fn_audit。所有外键范围含 namespace，金额最小单位 TEXT/BigInt，报价为十进制字符串/整数比，USDT/TRON 精度 6，USD/FIAT 精度 2。查询索引仅客户时间、状态时间、订单关联。

API 前缀 `/local-slash-demo/management/finance`；实际后端为 `/admin-api/settlement-management/demo/management/finance`。沿用现有 success/data/message 包装。GET context、flows、flows/:id、orders、orders/:id、export；POST quotes、orders、orders/:id/{confirm,review,amend,cancel,return,risk-check,execute,reconcile,payout}。命令带 requestId 并校验载荷摘要，重复请求返回原结果。未知路径/参数拒绝。

权限：finance.read、finance.export、finance.create、finance.approve、finance.control、finance.execute、finance.risk_check。申请人与审批人分离；大额测试策略要求 reviewer 与 controller 两个不同权限节点。只在本地 fixture 生效：<=1000 USDT 一位审核员，>1000 USDT 再加控制员；这些是测试假设，不是正式业务授权。正式策略仍未配置。

地址：执行只允许明确合成的 DEMO:TRON: 标识。TRON 地址校验支持 Base58Check 校验和，参考 [官方账户说明](https://developers.tron.network/docs/account)。格式正确不代表风险通过，也不能单凭地址前缀区分主网/测试网。真实地址在本执行模块禁止付款。

## 4. 待确认/未接入

正式审批阈值/人数/角色、MFA、法币银行资金来源与凭证核实、OTC 对手方/锁价协议、币币兑换、真实风险/地址白名单、钱包托管/签名、通道验签/查询协议、网络确认数和重组规则、真实费用及部分失败收费规则均待确认。正式能力不启用。现有 Portal 历史演示订单只读保留，不补造账务分录。

测试夹具的同一出金以累计已确认交割数表示部分交割；这不是任何真实通道协议。凭证保存为文本引用，文件上传/恶意文件扫描没有接入。无实时法币估值，资产分别统计。分页为本地 offset，并非跨页一致性快照；详情与汇总每次服务端读取。

# Moventra 当前功能与接入状态

更新日期：2026-09-18。静态核对基线为本地 `main` 的 `89ca9c3`；运行代码发布记录为 `a2fa1f6`。本次仅更新文档，未重新执行测试、登录验收、渠道调用、迁移或部署，也未查询云端当前版本。

## 能力与证据

| 范围 | 当前源码及已有记录 | 边界与证据 |
| --- | --- | --- |
| 官网咨询 | 客户端同域 POST /api/contact 转交邮件服务，已有发布记录 | 邮件接受不等于最终送达；见[咨询发布记录](releases/2026-09-07-website-contact.md) |
| 身份与开户 | Firebase、customer/admin 两角色、独立登录、开户申请/审核及功能资格 | 后端角色、客户资源授权与运营 MFA 分别检查；不再用前端邮箱名单准入。见[登录隔离](business/two-role-login.md) |
| 客户查询 | 个人账户/交易、明确授权的卡片和关联交易，支持卡片深链与分页 | 卡片归属不授予真实资金执行权；共享钱包余额不复制为客户余额。见[测试快照](business/customer-card-binding.md)、[项目钱包](business/project-wallet.md) |
| 后台查询与管理 | USD 概览、客户目录、注册用户及详情、开户审核、渠道卡片/交易、连接状态、BIN 目录、测试资金审核 | 各模块权限与数据源独立；完整历史 Demo 菜单不等于生产能力 |
| 后台卡片归属 | 列表、详情及交易从项目钱包逐卡分配/有效测试绑定读取同一归属 | 还需该客户 accounts:read；缺权限返回 restricted，来源范围不符返回 scope_mismatch。代码及 API/后台发布见[统一发布记录](../deploy/2026-09-18-session-consolidation.md) |
| 线上测试资金 | 独立测试额度、模拟充值/兑换/提现、订单与后台审核 | 不调用真实付款或 Blnk；未知结果持续预占。见[测试资金流程及发布证据](business/online-test-funds.md) |
| 本地业务服务 | Node/SQLite 业务服务及 Python 采集工具源码已恢复到 services/local-workspace | 默认合成数据；私有数据库、快照和凭据不随源码迁入，不直接作为生产资金服务。见[运行说明](../services/local-workspace/README.md) |
| Slash 投影 | 已导入来源版本查询、客户卡片范围隔离、项目钱包与逐卡分配机制 | 手动导入与普通通知来源观察是两条链；刷新页面不触发上游采集，不宣称全历史覆盖 |
| Slash 普通通知 | 验签、持久化收件箱、异步只读 GET 与来源观察已有上线及真实投递记录 | 独立于前端查询投影和账本；done 不等于入账或前端已更新。见[上线记录](../deploy/slash-webhook-online-2026-09-18.md) |
| BIN 与开卡模块 | 正式供应商/BIN 目录、来源导入及三级价格；持久化随机卡名和默认 holder 请求规则代码已发布 | 目录记录为 8 个草稿产品、供应商暂停、商业价格未配置；真实发卡、首充及 issuing-worker 未启用，默认 holder 真实行为未验收。见[BIN 发布](../deploy/2026-09-18-bin-catalog-sync.md)、[统一发布](../deploy/2026-09-18-session-consolidation.md) |
| Blnk | 本地 shadow 多卡分户、持久化任务、Worker、观测和恢复工具；有私有服务基础设施记录 | 生产账本未激活，不能作为真实可消费余额；不代表完成上游资金池对账。见[接入规范](integrations/blnk.md)、[私有服务记录](releases/2026-09-18-blnk-private-service.md) |
| 客户卡片详情扩展 | 四标签、资金记录与敏感展示方案 | DESIGN；不能由规划推断 PAN/CVV、充值或转出已接通。见[详情规划](business/card-center-detail-plan-2026-09-18.md) |

## 当前工作区增量（未部署）

2026-09-18 新增 Cregis 离线签名与回调报文校验包；没有 HTTP 入口、来源存储或正式资金功能。等待产品类型及配置位置确认，见 [Cregis 接入](integrations/cregis.md)。

2026-09-18 后台刷新恢复身份采用 browserSessionPersistence，客户端保持内存会话；恢复后仍需 Go 角色、账号状态、MFA 及资源授权检查。此项为并行任务的本地改动，尚未部署，验证结果引用[该任务记录](business/admin-session-persistence.md)，本次未重跑，不覆盖上方 `a2fa1f6` 的发布结论。

## 数据和运行口径

- 只读渠道投影、客户账户/交易、online_test、本地 Demo 和 Blnk shadow 分开，不跨模式合并余额或权限。
- 运营概览以获授权 USD 客户交易为依据；Slash 来源交易未自动并入。来源 status/detailedStatus 与内部状态独立保留。
- 金额精确计算，USD/USDT 分资产；已知零、未知、不支持、失败分别显示。授权、入账、退款、费用和资金执行不能混算。
- 查询覆盖、来源时点、导入版本和分页限制按接口说明表达。历史本地 UTC 日期筛选与正式半开区间不能混用，见[接口范围](business/routes-and-api.md)。
- Slash 网络可用性按调用环境记录。已有 Render 只读成功与历史 MCP 失败不能相互替代；本次未复验，也不要求重复配置白名单。见[复用规则](integrations/slash-allowlist.md)。

## 后续开发与验收

先按[业务闭环标准](business/delivery-standard.md)补全流程卡，逐层核对页面、transport、网关、handler、权限及持久化，再完成深链、跨端、错误恢复和幂等验收。金融模型、期初、授权占款、真实执行与三层对账仍按专题逐项确认，不能通过文档更新追认为已完成。

发布记录中的自动化测试及 HTTP 探测属于当时证据；最新统一发布仍未完成本人认证后的浏览器业务验收及真实默认 holder 验证。本次没有新增这些验证结论。

9 月 7 日的详细状态、旧端口和待办保留在[历史状态快照](releases/2026-09-07-state-snapshot.md)，仅供追溯，不覆盖本页与后续专题记录。

## 2026-09-18 财务入口与 main 合并候选

新增正式卡费率管理与 USD 投影报表入口，本地实现、未部署；数字货币、OTC、出金审批等仍待取得现有渠道代码与配置后接通。见[财务流程](business/admin-finance-migration.md)和[main 核对记录](releases/2026-09-18-main-consolidation.md)。

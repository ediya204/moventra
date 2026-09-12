# 已有后台功能恢复记录

2026-09-13。用户要求更新已写好的后台模块。本次区分已有实现、当前正式接通和数据迁移，不再把旧服务已有能力统称为未开发。

## 基线和范围

GitHub main `a9f4253`；隔离工作分支 `codex/restore-existing-admin-modules`。旧 ADSFLOW 和共享 Moventra 主目录没有改写。完整旧服务恢复到 `services/local-workspace`；正式卡片、客户账户、渠道查询复用当前 Go/PostgreSQL。旧本地业务数据迁入线上范围已询问用户，尚未确定；本批不复制这些数据。

| 流程 | 旧实现证据 | 本批结果 | 尚需衔接 |
| --- | --- | --- | --- |
| 用户、费率 | management.mjs、003_user_management.sql | 源码与测试恢复，可在隔离环境保存、继承/覆盖费率 | 正式身份、管理权限及选定旧数据迁移 |
| BIN、渠道配置 | bins.mjs、channels.mjs、005/006 SQL | 源码与测试恢复，配置/状态写入仍可复现 | 正式配置权限及目录迁移；不新增真实开卡 |
| 卡片、归属、审批 | card-admin.mjs、card-ownership.mjs、card-workspace.mjs | 原本地完整流程恢复；正式新增全部卡片查询、名称/尾号/状态筛选、分页和详情返回 | 本地绑定与经办/复核权限迁移；真实卡执行保持原限制 |
| 资金、OTC、出金 | crypto-finance.mjs、portal.mjs、010–012 SQL | 原隔离持久化流程及测试恢复 | 正式客户/账本归属和资金执行政策不能从 Demo 推断 |
| 账户目录 | 已有正式客户 accounts GET | 正式页面按现有 accounts:read 范围选择客户、分页读取账户 | 不复制 Demo 账户，不制造余额 |
| 渠道与数据 | 已有 channel-projections GET | 正式页面展示连接、采集/导入时间，关联卡片和交易 | 仍为手动导入，页面刷新不调用 Slash |
| 风险、报表、对账、设置 | console.mjs、fx/query.mjs 等旧模块 | 原服务源码保留；正式菜单标注“待迁移” | 分模块正式数据源和授权验收 |

## 流程卡：FLOW-RESTORE-CARDS

| 项目 | 内容 |
| --- | --- |
| 目标 | 正式全部卡片 → 翻页/筛选 → 卡详情 → 此卡交易 → 卡详情/卡片目录 |
| 身份 | 既有连接与来源卡 ID；不绑定内部客户、不新增资金权限 |
| 接口链 | CardsPage / ChannelTransactionsPage → liveGet 精确白名单 → 同域网关 → channelRead → channel_records |
| 数据 | 既有授权导入版本；sourceAt/importedAt/coverage 保留，不重新导入 |
| 查询 | cards 支持 page/keyword/cardStatus/revision；transactions 另支持 cardId；资源不适用参数拒绝 |
| 权限 | 正式 admin、MFA、staff 及 channel_read_grants 全部保留，审计失败拒绝返回 |
| 状态 | 加载、空列表、无权限、版本冲突、服务错误与重试；查询不会执行资金操作 |
| 验收 | 25 张合成卡跨页、名称和尾号查询、精确卡关联、跨连接/缺 MFA 拒绝、前端翻页与详情上下文 |

## 流程卡：FLOW-RESTORE-ACCOUNTS

已有 session.staffScopes 中 accounts:read 客户 → /customers 选择客户 → 分页账户列表。服务端每次重查 staff_grants 和 MFA，并写入既有审计；不从 Slash 名称推断客户。`liveGetPage` 保留后端 hasMore，空值/异常不当作余额为零。复制 URL 的 customer/page 仍可重查；不在会话范围的客户不请求数据，后端另行拒绝越权。

## 验证及发布状态

原服务 135 项隔离测试通过；正式查询 PostgreSQL race 回归通过，包括新增卡片分页/筛选和资源权限。前端/网关共 70 项测试通过（含目录交互、上下文保留和 transport）；两端 TypeScript/Vite 构建通过。Go vet/build 通过。浏览器控制工具本次返回 HTML/JSON 解析错误，未完成浏览器业务流程验收；本地入口 HTTP 和隔离登录接口已验证。真实渠道调用、真实登录/MFA 业务验收、旧数据生产迁移均未执行。

本批生产部署状态以发布记录为准，源码恢复不表示所有旧写流程已上线。Slash 卡字段复核依据 https://docs.slash.com/api-reference/schema-card （2026-09-13）；本批只用既有白名单字段，不采集 PAN/CVV。

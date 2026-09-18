# FLOW-ADMIN-TX-OWNER：后台交易尾号与所属账户

2026-09-18。用户确认“所属账户”是卡片分配给的内部客户；放在所属卡片后的表格列。

| 项目 | 内容 |
| --- | --- |
| 范围 | 后台交易列表、详情抽屉、关联卡片详情；修复尾号，新增客户归属列 |
| 基线 | main c283b71；在现有独立工作目录增量修改，保留主工作区其他工作 |
| 页面关系 | /transactions?connection=… → 交易抽屉 → /cards/:id；所属账户 → /customers?customer=:id |
| 身份与依据 | connection + revision + cardId；真实内部project_wallet_cards或冻结customer_card_bindings；不是渠道持卡人姓名、渠道钱包标签或具体资金账户 |
| 接口链 | ChannelTransactionsPage → liveGet → admin-api/v1/channel-projections/:connection/transactions[/:id] → 同域网关 → Go channelRead → channel_records及现有归属、授权表 |
| 尾号 | 将现有客户端同连接/同版本/同账户及虚拟账户的卡片尾号补取用于后台；列表、详情、尾号搜索共用；缺失不从卡ID猜测 |
| 客户归属 | 新增admin-only customerAssignment：assigned带id/name，restricted只带state，unassigned只带state。账户目录链接仅assigned时显示 |
| 状态及恢复 | 数据加载/错误/重试沿用现有机制；未分配与已分配但无读取权限分开，不以缺权限冒充未分配 |
| 权限 | 原运营MFA、channel_read_grants、审计门槛保留；客户名称/ID另需该客户accounts:read；撤销立即生效；客户DTO不返回内部归属扩展 |
| 跨端 | 读取同一持久化分配关系；客户端授权裁剪保留，无写操作、无新绑定、无金额状态变更 |
| 验收 | 后台列表列顺序/链接/未知值、抽屉归属、Go列表/详情/尾号筛选、项目钱包及历史快照归属、无权限/撤销/跨钱包/客户端DTO裁剪 |
| 待定 | 无业务决策待定；没有把客户关联解释为财务资金所有权 |

本地实现完成。相关前端18项通过；后台类型检查与构建通过（既有大分包提示）。本地临时PostgreSQL回归结果以本次命令日志和交付为准。真实浏览器、线上归属数据及部署未执行。

本轮最终执行 `bash services/api/scripts/test-postgres.sh`：34个顶层测试通过，真实Firebase和Blnk集成2项按环境跳过；脚本仅使用本地随机临时数据库并自动清理。边界检查及git diff --check通过。没有执行生产迁移、生产数据写入或发布。

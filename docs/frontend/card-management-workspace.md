# 卡片管理工作台：实施记录与后续接入边界

更新：2026-09-07。范围：本地 Node/SQLite 后端与后台、客户端预览；不是正式 Go API / 生产执行能力。

文档发布范围：本次同步GitHub仅包含实施记录与对账规划。下文页面、接口和测试为此前本地工作区证据，配套未提交业务代码不随本次文档提交发布；仓库与本地预览的能力不能视为完全一致。

## 业务归属（按本轮用户补充修正）

**Slash 是上游服务商。客户归属、内部卡片身份、细分账目、资金所有权、审批及审计由我们系统负责。**

- 内部客户 → 内部卡片 → 内部卡资金分户；渠道连接及外部卡 ID 只作为上游映射。
- 内部卡分户无需以“Slash 每张卡是否有余额”为存在前提。是否需要上游资金划转，取决于内部账本与上游资金池的结算安排。
- 同一资金池内的管理分配应由内部双边账本记录；跨资金池的外部动作需要独立通道指令及确认。两者不能以修改卡限额互相替代。
- Slash 共享账户余额不能分配为某个客户余额；上游卡名不是所属用户；内部风控限制不是 Slash 原生状态。
- 本轮没有将已有来源卡、Portal 原预算或上游账户余额回填为可用资金。实际账户映射及正式会计科目尚未提供。

## 盘点与本轮交付

| 能力 | 现有基础 | 本轮结果 |
|---|---|---|
| 卡详情 | Demo 独立页面；真实卡原为 JSON 弹窗 | 统一独立 `/cards/:id`；真实卡带 `?source=slash`，旧 `?detail=` 链接转到新页 |
| 用户归属 | `internal_card_owners` 联接 `mg_users` | 真实详情复用数据库绑定、名称与邮件；不从 Slash 卡名推断 |
| 页面组织 | 状态、操作、审批、分录纵向堆叠 | 固定摘要，概览/交易流水/资金记录/风控与审批/操作日志；右侧动作及禁用原因 |
| 交易查询 | 真实交易列表与详情抽屉 | 卡内独立授权查询、状态/原币/时间筛选、服务端分页、原有详情抽屉 |
| 客户解冻 | 通用问题工单 | 独立申请绑定冻结版本；补充材料编号、审批、退回补充、拒绝、执行结果与客户进度 |
| 风控原因 | 同一 reason 被后台及 Portal 使用 | 客户可见说明与内部备注分存；客户状态及活动记录不泄露内部冻结原因 |
| 资金操作 | 双边分录、预占、幂等及双人审批 | 复用；资金标签只列划拨/扣款，不混入冻结流水；冻结扣款增加独立权限 |
| 真实 Slash 写入 | 未接入 | 仍关闭。后端返回不可执行原因；没有将本地驱动成功标为上游成功 |

## 页面与契约

后台 `/cards/:id?source=demo` 为本地受管卡；`/cards/:externalId?source=slash` 为当前连接授权范围内的上游投影。真实卡未建立内部受管卡映射时，管理状态为 `unmanaged`，限制字段为 null，余额为 null。

客户端 `/portal/cards/:id` 的“申请解除风控”打开独立申请弹窗，卡详情展示审批与执行进度。仍受现有固定本地演示客户范围约束，不代表已经接入正式客户认证。

浏览器 API 前缀 `/local-slash-demo/management/card-admin`；Node 路由对应 `/admin-api/settlement-management/demo/management/card-admin`。

| 方法 / 路径 | 增量字段或行为 |
|---|---|
| GET `/cards/:id?source=slash` | 渠道范围授权 + card.read/owner_scope；owner、source、actions、空的未接入账本；只读取已保存来源 |
| GET `/cards/:id?tab=funds|risk&page=` | 按类型在服务端筛选操作历史；owner、latestExecution、unfreezeRequests |
| GET `/cards/:id/transactions` | source、detailedStatus、originalCurrency、from、to、page/pageSize；截止时间不含，UTC；真实来源保留近30天范围及完整性说明 |
| POST `/cards/:id/operations` | 冻结增加 customerReason、internalNote；原 reason 为后台原因；保留 requestId/cardRevision 等校验 |
| POST `/operations/:id/review` | 原 approve/reject；客户解冻单支持 return（必须填写意见） |
| POST `/local-slash-demo/portal/action` | type=unfreeze-request，id、freezeRevision、reason、evidence；会话范围固定在服务端，不接受 owner/actor |

Portal action 保留 revision 与 requestId 幂等机制。相同请求重放返回原单；不同请求对同次冻结不能制造多个待处理申请。退回补充复用原单，历史审批意见和补充动作保留在审计。

审批通过前后均可能发生卡状态变化：执行重新检查冻结版本、卡状态及其他未确认任务。旧版本审批或未知冻结结果不能解冻；批准但无法执行的单保留 approved/failed 及原因。其他客户主动冻结仍保留。

## 数据与权限

增量 `014_card_unfreeze_requests.sql` 仅增加：

- `ca_unfreeze_requests`：operation_id、card_id、owner_id、freeze_revision、created_at，按 namespace 和复合外键隔离。
- `ca_freeze_notes`：operation_id、customer_reason、internal_note。

申请与审批/执行仍复用 `ca_operations`；历史复用 `ca_audit`；没有再造账本或修改原资金数据。

`card.frozen_debit` 是风控冻结期间扣款的附加权限，必须同时具有普通扣款权限；复核执行时再检查发起人与执行人。旧角色不会因代码更新自动获得此新增权限。冻结期间管理转入/转出继续禁止，待正式政策明确后配置；没有通用“绕过风控”入口。

真实投影读取另检查渠道连接授权与内部客户授权。BIN 仅按内部渠道目录的 provider、account_ref、cardProductId 匹配唯一前缀；没有可信匹配时显示未匹配，不从尾号猜测。

## 本轮验证

- `node --test tests/card-administration.test.mjs tests/card-workspace.test.mjs tests/live.test.mjs`：36/36 通过。
- 正式仓库 `pnpm test`：37/37 通过；客户端、后台 `pnpm typecheck` 与 `pnpm build` 通过；旧本地预览 `npm run typecheck` 与 `npm run build` 通过（现有大包提示保留）。
- 旧本地预览全量测试首次尝试有 1 个测试文件因缺少 react-test-renderer 无法加载，未报告全量通过；相应正式仓库 admission 测试通过。本轮未重装正在使用的预览依赖。
- 覆盖内部备注隔离、重复申请、退回后补充、幂等拒绝、旧冻结版本、跨客户、只读角色、未知上游结果、冻结扣款附加权限；原有余额不足、双边账本、重复入账、失败预占释放及自审测试一并重跑。
- 浏览器确认真实卡目录进入独立页；交易抽屉“名称 + 尾号”进入正确卡详情；卡内显示同一笔交易与分页、筛选。
- 本地迁移前使用 SQLite 在线备份；原 source_records、source_versions、internal_relations、ca_entries、ca_accounts、ca_operations、internal_card_owners 内容摘要全部一致。
- 没有触发真实同步或上游写入；没有真实资金扣划；没有生产迁移、部署或 GitHub 推送。

## 未接入与下一阶段

以下不能标为已交付能力：

1. 真实卡内部管理 ID/渠道映射的持久化及正式资金分户开户；目前已有的是真实卡“所属用户”绑定，二者不同。
2. Slash 命令适配器与持久化查询确认任务；本轮仍是只读投影，没有向真实卡发送 PATCH。官方 [更新卡片](https://docs.slash.com/api-reference/card-patch) 有 status 字段，[读取卡片](https://docs.slash.com/api-reference/card-get-by-id) 可用于读取来源状态，但需要另行接入本连接写权限、合法实体范围、超时未知结果和确认策略。不能只凭来源 paused 自动解除上游风控。
3. 正式内部资金账户、卡分户与上游资金池的映射和结算规则；强制扣款收款科目，冻结期间允许的后台划拨及复核政策。由业务/财务确认，负责人待分配；无需要求 Slash 提供逐卡账本。
4. 客户申请附件上传与受控下载，目前仅支持业务材料编号；正式客户身份、运营 MFA、生产权限接入尚未完成。
5. Go 服务中的写接口、生产数据库迁移及真实渠道沙盒验收；当前 Node 本地接口不能代替这些交付。

以上按照“内部卡账户/账本 → 内部审批和指令 → 上游适配器 → 确认/对账”的方向接入。Slash 全量来源数据继续手动同步，未来 Webhook 不能直接覆盖内部用户归属或内部账本。

# 卡片、渠道与交易业务逻辑

核查日期：2026-09-07。业务源码基线：`0d5158d`，本次增量核对 `d9a5d40..0d5158d`，并读取 `2918584` 追加的部署记录。本文区分正式源码、DEV 页面、规范目录未提交增量及旧本地服务；不以历史专题中的“已实现”推定功能已上线。渠道投影的 Go/Worker 部署已有独立记录，本人登录业务验收仍未完成；本轮不重复部署或验收。

本次仅核对源码、已有专题和 Slash 官方文档；没有读取私有数据库、快照或凭据，没有运行渠道请求、资金操作、迁移、部署或业务测试。文末测试文件和专题结果是可追溯的既有证据，本次不重新宣称通过。

## 1. 能力所在位置

| 能力 | `0d5158d` 已上传内容 | 运行及交付边界 |
| --- | --- | --- |
| 正式渠道卡交易与卡资料读取 | 正式 `/transactions`、`/cards/:id`、Go 渠道投影 GET、独立连接授权及手动导入 CLI | 读取已导入的来源版本；不抓取 Slash、不改客户账本，部署进度以发布记录为准 |
| 本地 Slash 固定卡目录与绑定 | DEV 列表、详情抽屉、内部用户绑定编辑器、7/14/30 天 UTC 日期筛选 | 仍依赖未上传的本机 Node/Python；不等于正式客户归属能力 |
| 商户 Logo | 共享组件、正式交易页、DEV 列表/抽屉与客户端 DEV 流水已接入 | 仅名称匹配的显示辅助；正式客户端尚未开放商户渠道数据 |
| BIN 产品、渠道人工目录、模拟开卡 | 后台与客户端 DEV 页面、浏览器接口白名单 | 服务端目录、产品快照和模拟开卡事务仍在旧本地 Node |
| 管理卡片操作、双人审批 | DEV 卡详情、操作申请、审批和执行结果页面 | `ca_*` 合成账本、执行驱动和权限实现未纳入仓库；没有真实卡资金写入 |
| 客户卡中心、自助冻结、风控问题反馈 | DEV 卡列表、详情、交易/资金/操作分类、原问题工单入口 | 固定演示主体；正式客户入口没有这套卡片执行能力 |
| 新卡片工作台、专用解冻申请 | 仅有既有实施文档；业务增量未合入基线 | 详见第 7 节差异，不应按本地截图解释已上传页面 |
| 正式账户/交易查询与运营概览 | Go 授权查询、运营概览 | 与上述本地接口分开；不能使用正式登录凭据调用 Demo 充当正式金融服务 |

路由证据：[运营正式入口](../../apps/admin/src/App.tsx)、[运营 DEV 路由](../../apps/admin/src/DemoApp.tsx)、[客户端入口](../../apps/client/src/App.tsx)、[Go 路由](../../services/api/internal/api/server.go)。运营 `DemoApp` 仅在开发且显式 Demo 模式加载；客户端 DEV `Portal` 也有独立加载条件，正式 `/portal/*` 进入 `ClientHome`。渠道投影新增内容与历史验证见[发布记录](../releases/channel-projection-2026-09-07.md)。

## 2. 业务对象与边界

业务链条是“内部用户 → 内部卡身份/卡资金分户 → 渠道连接与上游卡映射”。Slash 卡、内部受管卡、卡产品和客户身份是不同对象，不能因 ID、姓名或显示金额相似而合并。

| 对象 | 身份与用途 | 不能由它推定的事实 |
| --- | --- | --- |
| 内部用户 | 本系统 `mg_users`，供本地归属绑定；正式客户另有 Go 主体授权 | 名称相同不代表同一客户；演示用户不能自动获得真实数据范围 |
| 内部受管卡 | 本地 `ca_cards` 与 `ca_accounts`，保存限制、权限及合成资金分录 | 不等于 Slash 已允许冻结、划拨或扣款 |
| 上游卡 | 连接范围内的 Slash `cardId`，展示名称、尾号、来源状态与采集时点 | 卡名/持卡人名不是内部所属用户；来源限额不是内部资金余额 |
| BIN 产品 | 内部产品 ID、BIN 前缀、渠道关联、配置版本、开卡快照 | BIN 不是唯一产品键，也不是客户资金账户 |
| 渠道目录 | 本地渠道 ID、实体/账户参考、上游产品 ID | 人工登记和导入不证明连接健康或真实发卡权限 |
| 来源交易 | 连接、资源类型和来源 ID 隔离的最新观察 | 来源记录、内部管理操作、费用说明不是同一笔经济影响 |
| 正式渠道投影 | `channel_connections` 指向的当前导入 revision，历史记录按连接、版本、资源类型和外部 ID 保留 | 不属于原客户 `transactions`，不继承本地 Demo 归属，不代表完整账单或资金池 |

内部卡分户可独立存在；是否需要向上游转移资金取决于确认后的资金池和结算安排。当前未把 Portal 原预算、Slash 账户余额或卡限额回填为可扣款金额。正式会计科目、期初、有效期归属和资金执行迁移仍按[资金领域规范](../domain/transactions-and-funds.md)及[V1 对账规划](../domain/reconciliation-v1-plan.md)处理。

## 3. 路由与可见流程

正式构建新增以下只读路由，使用 Firebase 正式身份与 Go 接口；代码存在不代表本次文档任务完成了部署或登录验收。

| 正式路由 | `0d5158d` 行为 |
| --- | --- |
| `/transactions?connection=...` | 选择获授权连接，按商户/尾号/交易 ID、详细状态和 UTC 来源日期筛选；每页 20 条，查看来源交易抽屉 |
| `/cards/:id?connection=...` | 在指定连接中查卡名、尾号、来源状态和创建时间；所属用户统一显示未绑定，资金余额与后台管理操作未接入 |
| `/workbench` | 现有正式资金与运营概览；新增通向卡交易的导航，但未将新渠道导入数据并入概览 |

实现：[ChannelTransactionsPage](../../apps/admin/src/operations/ChannelTransactionsPage.tsx)。卡片链接携带连接，不能仅以裸卡 ID 跨连接查找。它是基础来源资料页，不是本地五标签管理工作台；正式 `/cards` 卡目录入口尚未提供。

下表为独立 DEV 业务路由；同名路径由不同入口承接，不能把其本地执行能力写成正式功能。

| DEV 路由 | `0d5158d` 行为 |
| --- | --- |
| `/cards?source=slash` | 固定导入的真实卡列表，支持状态、两组选卡筛选；详情仍为来源弹窗，内含归属编辑器 |
| `/cards?source=demo`、`/cards/:id` | 本地受管卡列表及旧版管理详情，展示可操作项、审批、分录与审计 |
| `/cards/:id/source` | 保留原来源资料查询 |
| `/transactions?source=slash` | 已导入、具有关联 `cardId` 的卡交易；查询、服务端分页、金额汇总及单笔抽屉 |
| `/transactions?source=demo` | 进入原 FX/Demo 交易视图；数据不与真实投影混算 |
| `/card-operations`、`/card-operations/:id` | 卡操作待办、审批和执行结果；与原开户审批分开 |
| `/approvals` | 原管理审批入口，并可进入卡操作审批 |
| `/card-bins`、`/card-bins/new`、`/card-bins/:id` | 内部产品目录、创建与维护 |
| `/card-bins/channels` | 渠道列表、目录导入及产品关联 |
| `/system/channels` | 查看真实投影手动同步状态；它与 BIN 渠道目录不是同一个配置概念 |
| `/portal/cards`、`/portal/cards/new`、`/portal/cards/:id` | 客户演示卡中心、选产品开卡及卡详情 |
| `/portal/cards/:id/transactions/:recordId` | 卡内交易详情，保留卡片和列表返回上下文 |

实现入口：[真实列表](../../apps/admin/src/slash/LiveSlashPage.tsx)、[交易抽屉](../../apps/admin/src/slash/TransactionDrawer.tsx)、[管理卡片](../../apps/admin/src/card-admin/CardAdminPage.tsx)、[BIN 管理](../../apps/admin/src/bins/BinManagementPage.tsx)、[渠道管理](../../apps/admin/src/bins/ChannelManagement.tsx)、[客户卡中心](../../apps/client/src/portal/CardCenter.tsx)。

## 4. BIN、渠道及模拟开卡

### 4.1 产品维护与渠道关联

先登记渠道及其实体/账户参考范围，再人工导入上游产品目录，从目录选择需要开放的产品创建内部 BIN 产品。同一渠道可以逐步增加产品；导入了多个目录项，不要求全部同时上架。

内部产品状态为 `draft / active / paused / archived`：草稿和归档不向客户端展示；上架且满足渠道、来源产品及数量条件时允许模拟开卡；暂停可以展示但不允许新开卡。归档不能恢复。暂停产品不会自动冻结或关闭已发卡。

本地目录服务的具体规则（本次从旧源码核对）：

- 渠道产品按 `namespace + channel_id + source_id` 隔离；一次人工导入 1–100 条，仅保存 `id/prefix/status`。缺席条目不自动删除，未改变的条目不重复新增。
- 渠道配置和目录导入均校验 `revision`。同范围复用已有渠道；已有内部产品关联时，不能静默改上游产品前缀或渠道身份。
- 渠道产品 `prefix` 接收 1–8 位数字，进入内部 BIN 产品表单时要求 6/8 位；格式符合不等于真实发行能力已确认。
- 渠道暂停、来源产品缺失或非 `active`、非 Demo 产品没有渠道关联，均阻止新开卡。未知来源状态保留原值。
- 一个 BIN 前缀可以对应多个内部产品。“已关联”按上游产品 ID 去重，包含草稿/归档的内部关联，不等于上架数。

上述服务源码位于旧目录 `adsflow-admin-react/demo-server/slash/bins.mjs`、`channels.mjs`，不在本仓库。现有专题：[BIN 产品](../frontend/card-bin-management.md)、[渠道关联](../frontend/card-channels.md)、[首屏状态维护](../frontend/bin-status-management.md)。

### 4.2 客户选卡与开卡结果

[CardOpeningPage](../../apps/client/src/bins/CardOpeningPage.tsx) 读取公开产品白名单，客户选择内部 `productId` 和 `productRevision`，提交卡名称。V1 不再需要团队选择；旧专题里的团队选择是历史记录。

旧本地服务在单事务内再次校验产品存在、版本、上架状态、渠道允许条件和累计名额，保存产品关联及开卡时的名称/BIN/卡组织/版本快照。请求重放返回原结果；同幂等键不同请求拒绝。产品后续改名不会覆盖旧开卡快照；已发卡产品的身份字段和渠道不能直接替换。

当前是 USD 虚拟卡模拟开卡，初始资金与开卡费为演示明确零；不调用 Slash 发卡，不向真实钱包扣费。公开产品响应不返回内部备注、渠道账户参考或上游产品 ID。旧卡缺少可靠产品关联时显示未关联，不从尾号猜 BIN。

## 5. 真实 Slash 投影、归属及同步

### 5.1 固定选卡与关联卡资料

最初授权选择是“最新创建 20 张 + 最近消费 20 张”，初始化验证每组恰好 20。既有交付记录的两组并集为 40；本次未读私有配置，未重新统计当前数量。`latestCreated / recentConsumption` 是该批次固定成员标签，不是每次同步重新计算的实时排名。

旧本地实现将两个用途分开：

| 存储类型 | 用途 | 列表/同步行为 |
| --- | --- | --- |
| `kind=card` | 固定选择集合 | 卡目录只列该集合；常规手动同步逐张更新，保留分组 |
| `kind=card-reference` | 交易引用、但未被选中的卡片资料 | 提供名称、后四位及有限来源字段；单卡详情可读取，不加入固定卡目录、不增加“已选卡”统计 |

常规同步可对新交易缺失的关联卡进行有限补采，默认最多 20 个；已有名称资料的引用可跳过。独立 `enrich-references` 手动命令仅补关联资料，默认 20、允许上限 200；不抓交易、不改余额、不变更固定集合，也不更新全量同步成功时间。它有独立采集记录，不能描述成全体卡片都已持续更新。

核查来源为旧目录 `adsflow-api/scripts/slash_live.py` 的 `initialize`、`collect_card_references`、`synchronize`、`enrich_references`，及 Node `demo-server/slash/live.mjs`；这些执行文件未随本仓库上传。已有公开说明：[手动同步](../frontend/slash-manual-sync.md)、[真实接入历史](../frontend/slash-live-data.md)。

### 5.2 内部用户归属

[CardOwnerEditor](../../apps/admin/src/slash/CardOwnerEditor.tsx) 查询当前归属，搜索内部用户，再提交 `userId/revision/reason`。它已经存在于已上传的真实卡详情弹窗。

旧 Node 按 `namespace + platform + connection_id + card_id` 联接 `internal_card_owners` 与 `mg_users`，默认未绑定。读取真实交易时通过关联卡读取当前绑定；不是用商户、卡名或持卡人自动识别客户。绑定接口先验证当前连接可见卡，再仅允许本地 `demo-operator` 维护，要求同范围用户、版本和原因；同一用户重复保存不新增绑定审计，换用户使用乐观版本并记录前后用户与原因。

该实现保存的是当前绑定及审计，不是已完成的历史有效期资金归属模型。用户改名可反映到当前查询；当前关联变化不得被解释为旧资金或历史交易所有权已经迁移。绑定本身不修改 Slash、不创建可用资金、不授予资金操作权限，也不会把真实交易投影复制入客户 Demo 钱包。

正式渠道导出白名单不包含上述本地绑定。`0d5158d` 的正式卡详情显示“所属用户：未绑定”，也没有正式绑定写接口；不能把本地 `mg_users` 关系或渠道卡名转成正式客户授权。

### 5.3 手动同步执行链

本地投影同步仅在点击“手动同步”或明确执行手动命令时调用上游 GET。服务启动、页面打开、15 秒本地状态轮询、任务成功/失败都不安排下一轮上游采集。当前状态返回 `syncMode=manual`、`webhookConnected=false`、`nextAt=null`、`intervalSeconds=null`、`workerRunning=false`；最后一项在手动模式不代表异常。

常规任务先确认授权账户仍可见，更新固定卡片，读取账户最近 30 天最多 50 页交易，补有限关联卡资料，轮转重读最多 20 条未在本轮列表中的旧交易，再取账户余额。旧交易包括 pending 和 posted；失败尝试也推进轮转。没有声称跨页快照一致、历史全量或完整对账。

更新按连接、资源类型、外部 ID 幂等替换当前投影，并保留内容版本和运行审计。进程内合并并发触发，跨进程使用文件锁；主抓取失败保留原投影和 revision，局部失败保留对应旧值并标记 partial，页面显示采集时间和失败。余额 cash/credit 等来源类型分开；币种未核实的快照不跨类型相加。

### 5.4 本地接口与权限

浏览器统一前缀为 `/local-slash-demo`，由固定本机代理转给旧 Node 的 `/admin-api/settlement-management/demo`。以下是本地契约，不是正式 Go 路由：

| 方法/后缀 | 业务动作 |
| --- | --- |
| `GET management/live/status` | 查询已保存同步状态、覆盖和来源快照时点 |
| `GET management/live/cards`、`cards/:id` | 固定目录及当前连接内单卡/关联资料 |
| `GET management/live/transactions`、`transactions/:id` | 授权范围内来源交易、服务端汇总及详情 |
| `GET management/live/overview` | 本地来源记录的运营聚合，始终标明覆盖不完整 |
| `POST management/live/sync`，空对象 | 启动本地只读采集任务，不是金融写入 |
| `GET/POST management/card-ownership/cards/:id` | 当前内部归属查询/维护 |
| `GET/POST management/bins[/:id]` | 内部 BIN 产品查询/维护 |
| `GET/POST management/channels[/:id]` | 渠道目录配置；`GET :id/products`、`POST :id/import` 为目录读取/人工导入 |
| `GET portal/bin-products`、`POST portal/action` | 固定演示客户的公开产品查询及模拟开卡等动作 |

浏览器方法/路径限制见[共享接口客户端](../../packages/shared/src/api/client.ts)。真实 live 读取在 Node 再检查 HttpOnly operator 会话、私有配置中的 namespace/authorizedActors、loopback、Host/Origin/跨站信息和审计；并非只靠前端隐藏菜单。初始授权配置仅 `demo-operator`，未登录/member 与无连接授权的观察/复核身份不能读取真实连接。该本地边界不等同正式运营 MFA 或客户主体授权。

### 5.5 正式渠道读取与手动导入

`0d5158d` 已上传独立 Go 渠道投影、正式页面和网关白名单。流程是“本地手动采集 → 受控白名单导出 → CLI 手动导入正式投影 → 已授权运营读取”。正式页面的“刷新已导入数据”只重读服务端，不触发本地采集、文件导入或 Slash 请求。

| 正式 GET 路径 | 响应与范围 |
| --- | --- |
| `/admin-api/v1/channel-projections` | 当前运营获授权连接及其 revision、来源观察/导入时点；无连接权限为 403 |
| `/admin-api/v1/channel-projections/:connection/transactions` | `rows/total/page/revision/sourceAt/importedAt`，固定每页 20 条，`complete=false`、`syncMode=manual_import` 及覆盖说明 |
| `/admin-api/v1/channel-projections/:connection/transactions/:id` | 精确连接中的单笔来源记录，仍以 rows 响应；无记录或无该连接权限为 404 |
| `/admin-api/v1/channel-projections/:connection/cards/:id` | 精确连接中的卡资料；不附加本地归属、管理权限或可用余额 |

列表接受 `page/keyword/detailedStatus/from/to/revision`，拒绝未知或重复参数；详情和连接目录不接受查询参数。关键词对商户作模糊匹配，对尾号或交易 ID 作精确匹配；详细状态按来源值精确匹配。列表传入非当前 revision 返回 409，页面提示刷新后重查；刷新按钮重新获取连接水位。Go 通用资源处理也接受同连接的 `cards` 列表，但当前正式 UI 未提供卡目录管理入口。

[Go 渠道读取](../../services/api/internal/api/channel.go)先要求有效 Firebase 身份、启用内部用户及 MFA，再同时检查现有 `staff_grants` 与该连接的 `channel_read_grants`。原客户 `transactions:read` 或仅有 staff 身份均不自动授予渠道读取。连接查询、列表计数/分页和读取审计使用同一 Repeatable Read 事务，审计或提交失败不返回记录。前端[正式 transport](../../packages/shared/src/auth/liveApi.ts)与[站点网关](../../deploy/cloudflare/gateway.mjs)均拒绝客户端站点访问这些运营端点；没有该模块的公开 POST、上游代理或凭据接口。

[导出脚本](../../services/api/scripts/export-channel-projection.py)以只读 SQLite 事务取已采集资料，只导出带 `cardId` 的交易；卡片部分将本地 `card` 与 `card-reference` 统一转换为正式 `kind=card`。因此正式关联卡资料数量可以超过固定两组各 20 张，不能称为扩充了固定选卡集合或全体卡片已同步。导出排除 PAN/CVV/OTP、密钥、本地 Demo 归属和来源大对象，私有输出不提交仓库。

[CLI](../../services/api/cmd/api/main.go)要求先显式迁移，再以受控运行环境的 `DATABASE_URL`、`PROJECTION_OPERATOR_UID` 执行 `api import-channel`。输入限制 64 MiB、最多 50,000 条；[导入校验](../../services/api/internal/projection/import.go)检查来源账户、身份重复、白名单、整数金额字符串、时间格式及交易 cardId 格式。它不自动补齐缺失关联卡，也不生成客户关系。目标操作员必须是既有启用且有 staff 记录的用户，不自动创建用户或改变客户授权。

导入采用内容哈希 revision、事务锁和整批原子提交；相同内容不重复建立数据版本，但保留此次导入审计并确保指定操作员的本连接授权。来源账户不匹配或来源时点早于当前版本拒绝。新增[002 投影表](../../services/api/internal/database/002_channel_projection.sql)独立保存连接、授权、导入历史、记录和读取审计；不向原客户 transactions 写入、不生成资金分录、不改余额或运营概览来源。

[发布记录](../releases/channel-projection-2026-09-07.md)记载首批 5,573 笔卡交易、260 张关联卡、观察时点及 Go/Worker 部署结果；本次未读取私有文件或数据库重新核实，也不将数量解释为完整渠道覆盖。采集作业仍在本地，正式自动同步、Webhook 和客户归属尚未接入；已授权用户登录后的数据、Logo 和详情跳转验收仍待完成。

## 6. 卡交易筛选、金额与时间

已上传的[DEV 真实交易页面](../../apps/admin/src/slash/LiveSlashPage.tsx)强制 `cardOnly=true`，并保留 `cardId`、关键词、来源 `status`、`detailedStatus` 筛选。[正式交易页面](../../apps/admin/src/operations/ChannelTransactionsPage.tsx)读取独立导入库，当前提供连接、关键词、详细状态和日期筛选，不提供 DEV 卡片条件及资金汇总栏。两者复用单笔抽屉，展示原币和 USD 账户金额、来源状态与时间；关联卡只使用已采集名称与真实后四位，未知值不从 ID 截取补造。

### 6.1 时间范围

DEV 页面默认最近 30 个 UTC 自然日，可选 7/14/30 天或自定义，包含选定结束日，自定义最多 30 天。页面说明“按渠道记录时间筛选”，不是分别筛授权时间和入账时间；非法、空缺、反向或未来日期不发交易请求。变更条件回第一页，仍保留搜索、状态和卡片条件；分页共用相同范围，读取中保留总条数以避免自动跳回首页。

前端把 `range/fromDate/toDate` 转换为 ISO `from/to` 半开区间。旧 Node 显式日期查询列表、总数和金额采用同一范围及读取时刻；当前日截到读取时刻，历史查询仅访问已有记录，不自动回填。没有日期的旧调用继续采用近 30 天滚动窗口，可展示日期未知行但不将其计入金额。详见[日期模块](../../apps/admin/src/slash/transactionDateRange.ts)与[接口说明](../frontend/transaction-date-range.md)。

正式页面当前采用独立的开始日期与“截止日期 · UTC（不含）”，把输入转换为该日 UTC 00:00；默认不限定日期，允许单边起止，没有 7/14/30 快捷范围或最多 30 天限制。Go 接受 RFC3339 时间，双边条件要求 `from < to`，列表与总数均按来源 `date >= from && date < to` 过滤。日期变更直接查询并重置分页；正式版本尚未复用 DEV 的前端完整日期校验，不能把 DEV 的包含结束日或非法日期不发请求规则套在正式页。例如查询 UTC 9 月 6 日全天，正式页应填开始 9 月 6 日、截止 9 月 7 日。

| 视图 | 时间口径 | 为什么结果不能直接互对 |
| --- | --- | --- |
| DEV Slash 卡交易流水 | UTC 自然日，来源 `date`；只含有卡关联的记录 | 日期边界和卡片条件独立 |
| 正式渠道卡交易流水 | UTC 起止输入、截止不含，来源 `date`；指定连接当前导入版本 | 不默认近 30 天；来源、导入时点与本地数据库可能不同 |
| 本地 Slash 运营概览 | `Asia/Hong_Kong` 自然日，来源 `date`；连接范围记录 | 与 UTC 日界差 8 小时，并且不限定同一卡筛选 |
| 正式 Go 运营概览 | 香港自然日，正式交易投影及用户获授权范围 | 不是本地 Slash 数据库，状态采用现有 Go 契约 |

例如香港 9 月 7 日从 UTC 9 月 6 日 16:00 开始，不等于 UTC 9 月 7 日。统计生成时刻也不等于渠道最新完整水位。概览代码见[FundsOverview](../../apps/admin/src/operations/FundsOverview.tsx)和[Go overview](../../services/api/internal/api/overview.go)。

### 6.2 资金与状态

Slash 账户金额保留十进制整数最小单位，USD 两位小数；正为流入，负为流出。来源 `status=posted` 的有效金额参与本地汇总，pending/failed 不计入；费用/返现信息不再次记一笔资金。正式渠道页只显示来源记录的金额与条数，不进行本地概览式资金聚合；不能因某条 pending/failed 行显示金额而认为它已经入账。退款保留独立来源记录，不直接把原消费改成净额。两层状态映射和未知组合显示见[字段定义](../../apps/admin/src/components/cardTransactionFields.ts)。

`posted/reversed` 等矛盾组合仍保留来源事实，单列待核实；来源 posted 汇总不等于已确认结算。概览消费商户排行另限定 posted、settled、负数且具有关联卡；不是用全部负数或退款做消费榜。未知余额/汇率、未绑定用户和没有捕获记录不能补成零、1:1 汇率或“已完整覆盖”。

### 6.3 已上传商户 Logo

[MerchantLogo](../../packages/shared/src/components/MerchantLogo.tsx)与[品牌别名](../../packages/shared/src/components/merchantBrand.ts)已在 `0d5158d` 上传，正式渠道页、DEV 列表/抽屉和[客户端 DEV 统一流水](../../apps/client/src/portal/UnifiedTransactions.tsx)共用。名称匹配仅决定图标，不改原始商户描述、金额、状态或归属，也不是渠道确认的商户身份。

图标请求使用规范品牌名称或既定域名及公开客户端 key，不发送原始交易描述、卡 ID、金额或客户资料；不带 Referrer。未知商户用本地图标，已识别品牌图片失败用首字母，组件保留来源署名。正式客户端仍无该渠道商户数据入口；组件已上传不代表已向客户开放未归属交易。详见[Logo 专题](../frontend/merchant-logos.md)，其中此前本地测试与浏览器记录仍为历史证据。

## 7. 管理操作、客户卡中心及未合入增量

### 7.1 已上传管理页面对应的旧本地执行规则

[CardAdminPage](../../apps/admin/src/card-admin/CardAdminPage.tsx)已有申请、试算、二次确认、审批和执行结果页面；本地执行实体与账本仍由未上传的 `demo-server/slash/card-admin.mjs` 实现。

| 动作 | 审批/执行 | 资金意义 |
| --- | --- | --- |
| 风控冻结 | 权限允许可立即建立内部限制；免双人审批但必须审计；渠道结果单独保存 | 不产生收入/支出；失败也不自动解除内部限制 |
| 申请解除风控 | 发起人与复核人分离；批准后仍需执行确认 | 不退钱、不改历史账；不会同时解除客户自助冻结 |
| 转入/转出 | 双人审批、同客户同币种、执行重验和预占 | 客户资金账户与卡分户之间分配，合并客户资金不变；不是外部充值/提现 |
| 强制扣款 | 凭证、原因、二次确认、独立权限和双人审批 | 合成卡分户至平台应收结算账户；不是 Slash 网络消费 |

旧 Node 逐项检查 `card.read/freeze/unfreeze.request/unfreeze.execute/debit/transfer_in/transfer_out/approve/execute` 和 `owner_scope`。操作员身份来自服务端会话；演示中的发起、复核、观察身份不是正式角色切换机制。

审批与执行是两个维度：审批 `pending → approved/rejected`，免审批为 `not_required`；执行 `pending → processing → succeeded/failed`，拒绝为 `not_executed`。同一发起人的 `requestId` 绑定请求内容和卡，冲突返回 409；相同复核决定可重放，不允许覆盖另一决定。提交与执行均校验卡版本、余额和账户范围；未知结果保留预占，不自动当作失败重发。

合成 `CARDOPS-*` 才有独立 USD 测试账本；同事务成对入账、同 operation 唯一 journal、失败回滚、预占与入账分开。原 Portal 预算和真实来源卡没有可信资金映射时不能扣划。相关历史场景见[卡管理说明](../frontend/card-administration.md)，本次没有重跑或操作测试卡。

### 7.2 已上传客户端卡中心

[CardCenter](../../apps/client/src/portal/CardCenter.tsx)包含关键词、产品、状态、平台、金额/日期条件和 URL 分页，卡详情分概览、交易、资金和操作记录。统一来源模式从后端分页读交易；旧内存演示模式仍有独立本地转换，不应混称正式账本。

客户端写入经[unifiedApi](../../apps/client/src/portal/unifiedApi.ts)的 `/local-slash-demo/portal/action`，附 `requestId` 和状态 `revision`。旧 Node 校验动作字段白名单与固定演示客户，原子保存状态和幂等记录；浏览器不能自报 owner/actor。自助冻结与风控冻结独立：自助操作不能移除后台风控，冻结期间充值/转回受限。页面可见时刷新本地状态，不代替服务端校验。

`0d5158d` 中，风控卡仍通过通用问题工单反馈；专用解冻表单尚未合入。正式客户端由 [ClientHome](../../apps/client/src/portal/ClientHome.tsx)承接，不等于已经开放 DEV 卡中心写操作；渠道端点亦由客户端 transport 与网关明确拒绝。

### 7.3 本次发现的本地未合入项

下表对比规范目录 `/Users/edi/Documents/ChatGPT/moventra` 的实际文件与 `0d5158d`；仅描述尚未合入差异，本次文档上传不会携带这些代码。正式渠道 GET、导入 CLI 与共享商户 Logo 已随新版本上传，不再属于此表。

| 本地增量 | 当前差异与后端依赖 |
| --- | --- |
| 真实卡独立工作台 | 本地 `apps/admin/src/card-admin/CardAdminPage.tsx` 已添加 source=slash、概览/交易/资金/风控审批/审计五标签、用户绑定和动作禁用原因；本地 `LiveSlashPage.tsx`/`TransactionDrawer.tsx` 改为跳转该管理卡页。已上传 DEV 仍用真实卡弹窗及旧管理详情；新正式 `/cards/:id?connection=...` 只是基础只读资料，不是这套工作台 |
| 卡内真实交易接口 | 本地新增 `management/card-admin/cards/:id/transactions` 白名单，旧 `card-workspace.mjs` 先校验 `card.read`、连接及 owner_scope，再固定 cardId 读来源；基线白名单未包含该子路径 |
| 客户专用解冻申请 | `apps/client/src/portal/UnfreezeRequestDialog.tsx` 未跟踪；本地 CardCenter/model 接入申请与进度。旧 Node 新增 `unfreeze-request`，绑定当前冻结 revision，同次冻结已有待审/处理中不能重复申请，退回补充复用原单 |
| 审批退回补充 | 本地 CardAdminPage 对客户解冻单新增 `return`；旧服务增加 `returned`，非客户解冻申请不能使用。批准仍需执行确认，旧冻结版本或未知任务结果阻止解除 |
| 客户原因和内部备注分离 | 本地冻结表单增加 `customerReason/internalNote`；旧服务分别保存并裁剪客户可见信息。不能按旧页面假设已具备同样字段控制 |
| 冻结期间扣款附加权限 | 旧 Node 新增 `card.frozen_debit`，与普通扣款权限并用、复核执行再验；不是通用绕过冻结权限，原有角色不能据历史文档自动获得它 |

新工作台对真实卡返回 `unmanaged`、内部限制未知、余额未知和不可执行原因；绑定用户后仍不会自动产生资金映射或 Slash 写能力。专用申请附件当前只是材料编号，没有附件上传/受控下载闭环。实施历史详见[卡工作台专题](../frontend/card-management-workspace.md)，但其“本轮结果”与本节基线差异需一起阅读。

## 8. Slash 官方核验与证据使用

以下公开页于本次文档任务重新打开核验；未访问租户 API，不代表本账户能力或真实资金路径已验证。

| 官方来源 | 本次确认的事实 | 系统处理 |
| --- | --- | --- |
| [Transaction](https://docs.slash.com/api-reference/schema-transaction) | amountCents 为 USD 分；`date` 对 posted 为入账时间，对 pending/failed 为创建时间；status 与 detailedStatus 独立；原币省略时为 USD | UTC 交易筛选读取 source date，来源金额精确保留，原币不混加；缺失授权历史不补造 |
| [Card](https://docs.slash.com/api-reference/schema-card) | 卡状态 active/paused/inactive/closed；名称、尾号、账户、产品和消费限制为不同字段 | 来源状态与内部风控、自助冻结、资金余额分开 |
| [Retrieve card](https://docs.slash.com/api-reference/card-get-by-id) | 单卡读取提供敏感字段查询选项；实体范围与凭据类型影响授权 | 本地采集明确 include_pan=false/include_cvv=false，仅保留安全白名单；不新增 PAN/CVV/OTP 采集 |
| [Card products](https://docs.slash.com/api-reference/card-product-get) | 产品目录 items 中有 id/prefix/status，并有分页元数据 | 本地人工目录只存白名单；不把产品 ID 当 cardGroupId |
| [Webhook overview](https://docs.slash.com/api-reference/webhook-overview) | 通知要求及时 2xx，超时会重试，持续失败可能退避或禁用 | 当前尚未接入；后续须有验签、收件箱、事件去重、乱序处理和漏通知补采 |

普通事件通知与参与支付批准的授权 Webhook 是不同接入范围。当前手动 GET、前端状态刷新或关联卡补采都不代表 Webhook 已接入。既有专题中的真实 GET 批次、卡数量、交易数量、余额时点和测试通过数字均为历史快照，本次没有重新获取或复核私有数据。

## 9. 验证入口与下一阶段

当前仓库可检查的前端回归入口包括[DEV 日期筛选](../../tests/frontend/transaction-date-range.test.mjs)、[交易字段](../../tests/frontend/card-transaction-fields.test.mjs)、[交易抽屉](../../tests/frontend/transaction-drawer.test.mjs)、[商户 Logo](../../tests/frontend/merchant-logo.test.mjs)、[运营概览](../../tests/frontend/operations-overview.test.mjs)。正式渠道另有[读取授权与分页测试](../../services/api/internal/api/channel_test.go)、[导入测试](../../services/api/internal/projection/import_test.go)、[网关范围测试](../../deploy/cloudflare/gateway.test.mjs)。这些是源码验证入口；发布记录中的测试数字和数据库迁移记录由对应任务提供，本次只读核查没有重跑。

未上传的旧 Node 测试文件只在原目录，例如 `tests/card-bins.test.mjs`、`tests/channels.test.mjs`、`tests/card-administration.test.mjs`、`tests/card-workspace.test.mjs`、`tests/live.test.mjs`；其历史结果不能充当当前正式环境验收。

下一阶段的独立交付条件：

1. 选择并评审本地未合入增量，补齐前端路由、白名单、服务接口和测试后按范围上传；不能只上传入口使页面调用缺失接口。
2. 正式只读路径已具有独立连接授权和 MFA；后续卡片客户归属、卡中心与写操作仍需各自建立正式主体范围及权限，不能继承本地演示身份或仅凭已有读取授权开放。
3. 为内部卡分户定义正式账户、期初、资金池关系及历史归属；不从当前绑定或来源限额推导资金。
4. 真实写适配器、未知结果查询、经济事项幂等、完整性与对账分别验收；没有这些证据时继续只读。
5. Webhook、补数和完整来源覆盖独立实施；部署、渠道验证和业务验收分别报告。

本次交付仅整理业务说明与源码链接，不改变任何审批、资金、同步或上线状态。

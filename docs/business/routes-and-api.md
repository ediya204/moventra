# 正式页面、Go API 与浏览器可达范围

更新日期：2026-09-07。业务源码基线 `0d5158d`，发布记录基线 `2918584`；本文是路由/契约核对，不是逐接口线上调用报告。资金概览 `a42e2b9` 已有[部署证据](../../deploy/2026-09-07-operations-overview.md)；[渠道增量记录](../releases/channel-projection-2026-09-07.md)已确认 `0d5158d` 的 Render、后台及客户端 Worker 发布。运营用户本人登录后的完整业务验收仍待完成，本轮仅引用历史发布记录。身份流程见[正式身份与开通](identity-and-production.md)。

## 1. 应用与正式页面

| 应用 | 配置目标 | 正式构建入口 |
| --- | --- | --- |
| 官网与客户端 | `moventra.me`、`www.moventra.me` → `moventra-web`；旧客户端域名保留 | [apps/client/src/App.tsx](../../apps/client/src/App.tsx) |
| 运营后台 | `admin.moventra.me` → `moventra-admin`；旧后台域名保留 | [apps/admin/src/App.tsx](../../apps/admin/src/App.tsx) |
| Go API | Render `moventra-api`，仓库目录 `services/api` | [server.go](../../services/api/internal/api/server.go)；正式浏览器由各自同域网关转发 |

两个 Worker 的 `SITE_KIND` 分别固定 client/admin；两个前端构建身份也分别固定。相同 `/login`、`/session` 路径在不同站点有不同访问规则。静态 HTML 能返回 200 不证明 React 页面已放行，更不证明金融 API 或数据已接通。

### 客户端正式路由

| 路径 | 实际页面与行为 | 数据/操作范围 |
| --- | --- | --- |
| `/` | 官网、方案与咨询表单 | 内容展示；咨询表单只下载本地需求清单 |
| `/login` | 共用登录页的 client 模式 | Firebase 邮箱密码或 Google；已识别用户进入 `/session` |
| `/forgot-password` | 设置或找回密码 | 持有人向 Firebase 请求邮件；不创建 Go 业务用户 |
| `/register` | 注册表单预览 | 格式检查后清空密码，不创建身份、不调用 Go 注册 |
| `/session` | 身份分流 | 未登录回登录；缺本地用户时显示资料补全；有效会话进入 `/portal` |
| `/portal` | 正式 ClientHome 首页 | 本人个人主体账户、交易的已读取记录数及列表；最多各 50 条 |
| `/portal/accounts` | 我的账户 | 同一获授权个人主体账户列表 |
| `/portal/transactions` | 交易记录 | 同一获授权个人主体交易列表 |
| `/portal/security` | ClientHome 内嵌安全与权限页 | 邮箱验证、TOTP 绑定、刷新身份与获授权范围查询 |
| 其他 `/portal/*` | 正式 ClientHome 只认可上述四个路径；其余回 `/portal` | 不因路径存在而启用卡片、资金、工单等 DEV 页面 |
| 旧团队/邀请/成员与 `/portal/funds/transfer` 路径 | 顶层兼容跳转 `/portal` | 不执行历史划拨或重新开放协作 |
| 其余路径 | StatusPage | 状态页面，不是隐含业务模块 |

来源：[ClientHome](../../apps/client/src/portal/ClientHome.tsx)、[个人版本退役规则](../../packages/shared/src/portal/personalV1.ts)。ClientHome 只选择 me 中首个 personal 主体；企业模型仍留在服务端，不等于正式页面开放企业切换。

### 运营后台正式路由

| 路径 | 实际页面与门禁 | 数据/操作范围 |
| --- | --- | --- |
| `/login` | 批准邮箱密码；完成 Go operator 确认 | Google 入口关闭；MFA 未完成不能进入管理业务 |
| `/forgot-password` | Firebase 密码设置邮件 | 不提供授权或 MFA 绕过 |
| `/session` | 已认证 operator 且当次 MFA 完成时转 `/workbench`；否则安全流程 | 身份设置不等于业务授权放行 |
| `/session?security=1` | 保留 SessionPage | 身份、MFA、已有授权客户/资源查询 |
| `/workbench` | [OperationsPage](../../apps/admin/src/operations/OperationsPage.tsx) | 前端要求 authenticated、operator、MFA；后端概览另需 transactions:read；未满足时转登录或安全页 |
| `/transactions` | [ChannelTransactionsPage](../../apps/admin/src/operations/ChannelTransactionsPage.tsx)，`0d5158d` 新增 | operator + MFA，另需渠道 grant；只读已导入卡交易，支持服务端筛选/20 条分页和详情 |
| `/cards/:id?connection=...` | 同一组件的精确卡资料视图，`0d5158d` 新增 | 按连接+来源卡 ID 查资料；用户未绑定，不提供余额、管理或资金操作 |
| 其他路径，包括 `/cards` 列表、`/approvals` | 回 `/login` | 不直接加载本地管理 Demo |

## 2. Go 已注册路径与同域网关

客户资源表中的 `{id}` 是客户 UUID；渠道表中的 `{connection}/{recordID}` 是独立连接/来源资源 ID，网关只允许字母、数字、下划线与连字符。Go 为两个 surface 注册的客户列表相互独立；表内“可转发”仍需有效 Bearer 和对应授权，不表示公开数据。除了两项健康检查，全部 Go API 都验证 Firebase 身份；注册不要求用户已在 `users` 中，其余认证 API 要求本地用户 active。

| 方法与路径 | Go 实际能力 | 客户端 Worker | 运营 Worker | 当前正式网页调用 |
| --- | --- | --- | --- | --- |
| `GET /healthz` | 进程健康 JSON | 不代理 | 不代理 | 无 |
| `GET /readyz` | 数据库可达且 schema version 1 存在 | 不代理 | 不代理 | 无 |
| `POST /api/v1/register` | 已验证 UID + 姓名创建本地登录用户 | 可转发 | 404 | 客户端资料补全；不是 `/register` 预览表单 |
| `GET /api/v1/me` | 本人客户与运营身份/范围发现 | 可转发并隐藏运营范围 | 可转发；拒绝非 operator 并隐藏客户所有权列表 | 两端身份加载/刷新 |
| `GET /client-api/v1/customers/{id}/accounts` | 本人所有权或有效企业成员的账户 | 可转发 | 404 | ClientHome 与安全页范围查询 |
| `GET /client-api/v1/customers/{id}/transactions` | 同上，交易投影 | 可转发 | 404 | ClientHome 与安全页范围查询 |
| `GET /admin-api/v1/customers/{id}/accounts` | MFA + 该客户 accounts:read | 404 | 可转发 | 后台安全页范围查询 |
| `GET /admin-api/v1/customers/{id}/transactions` | MFA + 该客户 transactions:read | 404 | 可转发 | 后台安全页范围查询 |
| `GET /client-api/v1/customers/{id}/business-upgrade` | 当前申请人对该个人主体的最新升级申请 | 可转发 | 404 | 无；正式 transport 未允许此路径 |
| `POST /client-api/v1/customers/{id}/business-upgrade` | 本人 personal 主体 + 企业名称 + UUID 幂等键，创建申请及审计 | 可转发 | 404 | 无；正式 transport 未允许此路径 |
| `GET /admin-api/v1/ops/overview` | MFA + 当前用户 transactions:read 客户集合的 USD 日聚合 | 404 | 可转发，仅 admin SITE_KIND | `/workbench` |

来源：[Go Handler](../../services/api/internal/api/server.go)、[Cloudflare 精确路由](../../deploy/cloudflare/gateway.mjs)、[正式 liveApi](../../packages/shared/src/auth/liveApi.ts)、[OpenAPI](../../services/api/docs/openapi.json)。

### `0d5158d` 新增渠道读端点

下列四项是增量说明列出的页面主要端点；OpenAPI 用连接列表及通用 resource 路径表达。客户端 Worker 全部返回 404；后台 Worker 与正式 liveApi 允许 GET，Go 还要求 active 用户、MFA、至少一项 staff_grants 与本连接 channel_read_grants。没有 HTTP 写入口。

| 方法与路径 | 实际作用 | 当前正式网页调用 |
| --- | --- | --- |
| `GET /admin-api/v1/channel-projections` | 返回获授权连接 id、label、revision、sourceAt、importedAt；不接受查询参数；没有范围时 403 channel_scope_required | 交易页和单卡页加载/刷新连接 |
| `GET /admin-api/v1/channel-projections/{connection}/transactions` | 当前版本交易列表和精确 total，固定 20 条分页 | `/transactions` 的筛选和翻页 |
| `GET /admin-api/v1/channel-projections/{connection}/transactions/{recordID}` | 当前连接版本中的单笔交易，仍以 rows 包装 | 交易详情抽屉 |
| `GET /admin-api/v1/channel-projections/{connection}/cards/{recordID}` | 当前连接版本中的单张卡资料，仍以 rows 包装 | 交易关联卡和 `/cards/:id` |

静态核对还发现：通用 Go resource 路由、网关和 liveApi 实际允许 **第五条 `GET /admin-api/v1/channel-projections/{connection}/cards` 列表**；OpenAPI 的 resource 枚举也包含 cards，机器契约覆盖该能力。它复用通用 20 条查询逻辑，只是增量说明的四条清单未单列，正式页面也无卡列表入口。不能将“页面没有入口”写成后端 404；本轮不修改 API 实现或 JSON。

连接列表读取对每个可读连接写 `projection:connections:read`；资源读取写 `projection:transactions:read` 或 `projection:cards:read`。读取、版本和审计处于同一 Repeatable Read 事务；审计失败返回 503。未授权连接与不存在资源统一 404。来源：[channel.go](../../services/api/internal/api/channel.go)、[迁移 002](../../services/api/internal/database/002_channel_projection.sql)。

### 必须保留的可达差异

1. **健康检查直连 API。** Worker 对 `/healthz`、`/readyz` 不转发 Go，按静态资源处理；SPA fallback 可能返回 HTML 200，不能据此报告数据库 ready。Go `/readyz` 当前仍只检查 schema version 1，不证明新增 migration 002 已存在或渠道表可用。
2. **Go 可用不等于网页已提供。** 企业升级 GET/POST 在 Go 和客户端网关存在，但 `liveApi.ts` 不允许它，当前 V1 页面无企业升级入口。新增渠道卡列表同样有通用后端路径而无页面入口。
3. **客户列表与渠道列表分页不同。** 客户账户/交易的 Go/网关支持 limit/offset，但正式 transport 不接受该类列表查询串，且不暴露 meta；ClientHome/SessionPage 仍只查询默认 50 条。新渠道 API 则把 rows/total/page/revision 放在 data 内，transport 允许查询串，正式交易页已经实现固定 20 条分页。
4. **两端网关额外隔离。** Go 直连不读取 SITE_KIND；同一可信 token 是否能访问某 surface 由 Go 所有权/成员或 staff grant 判定。Worker 的分端拒绝和 me 字段裁剪属于另一层边界。
5. **路径校验层不同。** 网关列表/升级白名单只匹配规范 UUID 形状；不匹配时 404。Go 动态 customerID 路径再解析 UUID，参数不合法时 400。页面路由中的 ID 不能绕过任一检查。
6. **GET 与其他方法不等价。** 网关只允许表中显式 GET/POST；错误方法 405。Go ServeMux 的 GET 模式兼容 HEAD，但该行为不等于网关开放了 HEAD。没有通用跨域 CORS/OPTIONS 授权入口。
7. **业务白名单不能从 import 推断。** 共享包保留旧接口或某个组件有代码，不代表正式构建路由与网关允许它。`/local-slash-demo/*`、旧 `/admin-api/login`、候选 `/financial/*`、上游卡片写入和资金写接口仍不在正式网关白名单；新增的是独立渠道快照读取。

## 3. 查询与状态契约

| 能力 | 允许输入 | 响应与重要限制 |
| --- | --- | --- |
| 账户/交易列表 | 仅单值 `limit=1..100`，默认 50；`offset=0..10000`，默认 0 | `{data,meta:{limit,offset,hasMore}}`，limit+1 判断后续页；账户按 id、交易按 occurredAt/id 倒序；跨请求 offset 不保证固定快照 |
| 注册 | JSON 姓名 1–80 字符；未知字段、多段 JSON 拒绝 | 以已验证 UID 幂等；仅 `{data:{id}}`，不自动开通主体/资金服务 |
| 升级申请提交 | 精确 `application/json`、企业名称 1–200 字符、UUID `Idempotency-Key` | 首次 201、同内容重试 200；同键不同内容 409；已有未结束或批准申请不能再次创建；没有审核/激活接口 |
| 概览 | 单个 `days=7|14|30`，默认 14；其他/重复参数拒绝 | 最多 30 个香港日桶；USD、occurred_at、仅内部 succeeded 金额；不接受客户、角色、币种或范围覆盖输入 |
| 渠道交易/卡列表 | 单值 page、keyword、detailedStatus、from、to、revision；每值最多 200 字符 | page=0..2500、每页 20；未知/重复参数拒绝；返回 data 内的 rows/total/page/revision/sourceAt/importedAt/complete/syncMode/coverageReason |
| 渠道连接列表/精确详情 | 不接受查询参数 | 详情仍为 rows 包装；没有按 revision 指定历史版本的读取接口 |

客户交易 DTO 是正数 `amountMinor` 十进制字符串、`currency`、`scale` 和独立 `direction=debit/credit`；当前 USD 2 位、USDT 6 位；状态仅 `pending/succeeded/failed`。它没有被渠道 DTO 或 signed financial 草案替换。

渠道记录另保留来源 status/detailedStatus、amountCents 精确整数字符串、可选原币金额、商户、卡 ID/名称/尾号与来源日期/授权/入账时间。keyword 对商户做不区分大小写包含匹配，对尾号或来源 ID 精确匹配；detailedStatus 精确匹配来源值。from/to 接受 RFC3339 时点，按来源 `date` 过滤 `[from,to)`，可单侧提供，两者均有时要求 from < to；当前该接口没有 30 天跨度限制，不能套用 DEV 日期工具或概览限制。排序为来源 date 倒序、空日期最后、再 external_id；筛选总数与分页来自同一版本事务。

列表传入非空 revision 与当前连接版本不符时 409 projection_updated；页面刷新连接后重查。公开读取只选当前 revision，不支持旧版本重放。详情拒绝查询参数，因而可能在列表后发生导入时读取新版本；不能声称列表、抽屉和单卡跨请求始终固定同一版本。complete 恒为 false，syncMode 为 manual_import，来源观察时间与数据库导入时间分别显示。

概览 `totals.posted/daily.posted` 兼容字段实际上计内部 succeeded，不能解释为渠道 posted/settled。完整性、不可用指标、未知日期及时间范围详见[Go 总览契约](../../services/api/docs/operations-overview.md)。页面 CSV 是当前已返回每日聚合的本地导出，不是异步大导出或持久化审计报表。

正式 API 返回 no-store；认证失败 401、停用/MFA/缺概览范围 403、不可访问客户 404、参数错误 400、冲突 409、媒体类型错误 415、依赖或审计失败 503。网关另有未知路径 404、错误方法 405、上游非 JSON/重定向/请求失败 502。前端不应以未知值、失败或空范围代替金额零。

## 4. DEV 门禁与本地代理

正式 `usesFirebaseAuth = !(DEV && isDemoMode)`。客户端仅在 DEV 且显式 `demo/slash-demo` 配置时加载旧 Portal；生产构建始终使用 ClientHome。后台 DemoApp 本身只在 DEV 且显式 Demo 配置时加载，而完整管理业务路径进一步要求 `slash-demo`；仅设置 `demo` 不会开放完整后台业务路由。

后台 DEV slash-demo 的实际路由组如下。这些是本地页面，不是正式网关或 Go 已实现接口清单。

| 本地路径组 | 页面职责 |
| --- | --- |
| `/workbench`、`/approvals`、`/pricing`、`/finance/orders`、`/finance/orders/:id`、`/system/{audit,channels,access,settings}` | 本地管理控制台 |
| `/cards`、`/transactions` | 真实只读投影/本地 Demo 切换，依赖旧本地服务 |
| `/cards/:id`、`/card-operations`、`/card-operations/:id`、`/cards/:id/source` | 卡管理、操作、来源视图 |
| `/finance/crypto-flows`、`/finance/otc`、`/finance/otc/:id`、`/finance/withdrawals`、`/finance/withdrawals/:id`、`/finance/records/:id` | 隔离数字货币/OTC/出金实验 |
| `/fx/*`、`/transactions/fx/:id`、`/transactions/report`、`/transactions/balances`、`/transactions/differences`、`/transactions/cards/:id` | 本地交易与跨币种调查 |
| `/card-bins/*`、`/user-groups/*`、`/pricing/plans/*` | 本地产品目录、商业分组和定价 |
| `/operations`、`/customers`、`/customers/:id`、`/transactions/:id`、`/risk`、`/reports`、`/reconciliation`、`/demo/scenarios` | SourceDemoPage 对应来源调查 |
| `/demo-reset-password`、`/403`、`/404`、`/500` | 本地恢复/状态页面 |

以上来源为 [DemoApp](../../apps/admin/src/DemoApp.tsx)。退役团队路由先做兼容跳转；Demo 登录及旧服务内部权限与正式 Firebase/Go 授权不同，不能拿本地 Demo Cookie 进入生产。

[Vite 配置](../../packages/tooling/vite.ts)把 `/api/v1/`、`/client-api/v1/`、`/admin-api/v1/` 精确前缀指向 `VITE_GO_API_PROXY_TARGET`，默认 8870；`/local-slash-demo` 指向旧本地 8862，并改写为 `/admin-api/settlement-management/demo`；其他旧 `/admin-api` 走另一个历史代理。生产使用 Cloudflare 的精确 allowlist，不沿用这些开发代理。

`d9a5d40` 的 UTC 日期工具仍只作用 DEV Slash 页面，不给客户 Go 列表新增日期过滤；`0d5158d` 则独立为正式渠道列表新增 from/to。商户 Logo 已随该增量上传；本地额外卡详情/导航和解冻申请差异仍未一并上传，见[身份与发布边界](identity-and-production.md#6-上传本地与生产证据)。本轮文档不把旧本地后端、私有 SQLite 或待同步业务代码打包上线。

## 5. 渠道投影导入边界

新增 migration 002 创建 channel_connections、channel_read_grants、channel_imports、channel_records、channel_read_audit；客户交易表和账本不变。channel_records 主键包含连接、版本、资源类型、来源 ID；历史版本保留，连接指向当前完整原子提交的版本。导入失败回滚，不用客户 grant 推导渠道 grant。

白名单导出工具以只读 SQLite 事务生成私有 JSON，不访问网络或读取密钥；导入命令从受 64 MiB reader 限制的标准输入解码单个对象，拒绝未知顶层字段及尾随 JSON，记录数量限 1..50000。导入器校验来源账户、连接/记录 ID、同资源重复 ID、字符串金额、时间、尾号及嵌套字段白名单；交易必须有合法 cardId，但不要求该卡资料同时存在于同一批次，关联详情可能不可用。PAN/CVV/OTP、密钥、内部客户归属等不在导入白名单。

`api import-channel` 需要显式 PROJECTION_OPERATOR_UID 对应已存在 active 运营用户；它会为本连接创建独立读取 grant，因此是需授权的导入/权限写操作，不是只读 GET 或普通网页刷新。导入通过事务锁、账户绑定与 sourceAt 拒绝换账户及旧观察覆盖；整个 Bundle 的 JSON 内容哈希生成 revision，相同版本不重复插记录，每次调用仍记导入审计。它不校验上游结算完整性、不生成内部用户绑定、不产生资金分录、不保存 Slash 凭据。来源：[导出脚本](../../services/api/scripts/export-channel-projection.py)、[导入器](../../services/api/internal/projection/import.go)、[CLI](../../services/api/cmd/api/main.go)。

`2918584` 已追加正式部署结果及首批 260 张关联卡、5573 条交易投影的记录，并保留手动采集/导入边界；本人登录后的读取、Logo 与详情验收尚未完成。本轮只引用这些历史证据，不执行或复验部署、迁移、导入或真实身份操作。

## 6. 契约文档中的历史差异

- OpenAPI 路径已列出上述 Go 路由，但 `servers[0].description` 仍写“未部署”。这是陈旧描述；运行发布以部署记录为准。本轮只改 Markdown，不修改 JSON。
- 企业升级的“后端和网关可达”“正式 transport 不允许”“V1 页面无入口”需同时保留，不能简化成完全未实现或完整上线。
- 金融 `/financial/*`、通用 `/channel-connections`、余额快照及异步导出仍属于[接口草案](../api/contract.md)。新 `/channel-projections` 是独立已实现读取契约，不是这些草案路由的隐式实现。
- 已上传源码、构建产物、Worker/Render 版本、通过认证后的真实业务验收分别记录。本文依据源码及此前发布证据，没有重跑测试或产生新的生产验收结论。

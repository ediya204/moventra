# 统一消息中心

更新日期：2026-09-19。**代码已部署，生产021已迁移；消息查询、Worker及切点后的自动OTC通知已启用，运营主动发送仍关闭。** namespace为`live_moventra_funds`，切点为2026-09-19 03:19:29.252017 UTC，无历史回填、无新增消息客户授权。本批配置与验证见[生产迁移及开关记录](../../deploy/2026-09-19-production-migrations-and-switches.md)。下方隔离闭环保留原实施证据，不代表真实客户阅读/投递验收。

## 1. 本批能力与边界

正式客户端 `/portal/messages` 已由占位改为消息中心：分类、已读筛选、标题/订单号搜索、服务端游标分页、稳定详情链接、首次已读持久化、全部已读与铃铛最近5条。支持普通/重要站内信，以及 OTC 受理、完成、失败、结果待确认通知。

后台“运营管理→消息管理”可创建和修改草稿，选择1–100个有权限的个人客户，预览正文/接收人数并发布；发布后正文与接收人固定，支持投递/阅读明细和失败重试。首期只管理本人创建且仍有全部接收人权限的消息；没有全员广播、跨运营接管草稿或客户互发。发错内容应另发更正通知，不能修改已发送正文。

消息服务独立于金融执行。已读不代表客户确认交易，已投递只表示进入收件箱；消息查询、发送与重试均不调用账本或渠道金融接口。OTC 状态以原订单为权威，通知保存当时事实，点击订单重新鉴权读取最新进度。

后续预留充值、提款、卡片、开户及安全事件；系统分类保留，但系统公告编辑、开户前账户级消息、企业多成员投递、即时聊天、附件、邮件、短信和推送尚未实现。

## 2. 流程卡

| 必填项 | FLOW-MESSAGES-001：OTC通知 | FLOW-MESSAGES-002：运营站内信 |
| --- | --- | --- |
| 起终点/环境 | 隔离订单有效状态变化→事件持久化→客户阅读→关联原单 | 本地草稿→发布→Worker投递→客户阅读→后台明细 |
| 基线/启动 | main 14fe215及本轮增量；API/两端启动见各自README，独立验收入口见第7节 | 同左；仅本地隔离验证 |
| 页面关系 | `/portal/messages`→`/:messageId`→`/portal/funds/orders/:orderId`；浏览器返回保留筛选 | `/operations/messages`→`/new`或`/:id`→`/:id/recipients` |
| 业务身份 | namespace＋customer_id＋user_id＋order_id＋订单revision；两端引用同一message_job ID | campaign ID＋revision＋固化接收人；客户收件箱与后台任务共用job ID |
| 数据权威 | 原crypto_orders权威；message_jobs为通知快照，message_inbox为投递/阅读 | 草稿/发布快照、接收人表及投递任务均为PostgreSQL持久化 |
| 接口链 | MessageCenter/Bell→messageApi/messageContract→同域网关messages白名单→Go messageAPI→Owner/Inbox | MessagesPage→同一独立transport→网关→Go→MFA/独立message_grants与客户读取范围→campaign/jobs |
| 状态/操作 | 原金融状态不改变；消息入箱后可读取、标已读；待确认不鼓励重复成交 | draft可改且需revision；published不可改；failed可原任务重试，skipped不自动恢复 |
| 跨端变化 | 列表和铃铛可见窗口每30秒读取；已读后刷新本页，其他会话恢复焦点/下次轮询校准 | 发布先显示待投递，后台刷新查看已投递和已读，明细显示首次阅读时间 |
| 权限 | 个人主体归属与接收user_id同时验证；跨主体消息/已读404，跨主体快照400 | admin＋MFA＋独立read/compose/publish/retry＋effective_staff_grants accounts:read；不自动授予全局管理员消息权限 |
| 异常恢复 | 事务回滚不发事件；Worker重启恢复；已读失败可重试；查询失败不显示伪0/空列表 | 保存超时按create key查询原草稿；发布重试同campaign ID与revision；只重试失败接收人 |
| 验收 | 第7节M01–M09；E01/E03/E05–E09自动化，E02/E04本地浏览器 | 同左；两位合成用户批量投递、阅读回传已验证 |
| 待定政策 | 正式namespace、保存期限、投递SLO负责人待分配；阻塞生产启用 | 批量100为本地技术上限，正式运营政策/保留期限负责人待分配；全员广播保持关闭 |

## 3. 页面与状态语义

客户端查询参数 `category`（otc/letter/system）、`status`（read/unread）、`q`、`cursor` 保存于URL，默认20条；服务端limit为1–100，铃铛使用5条。搜索仅标题与订单号，不搜索客户私密正文；输入回车或失焦提交。分页游标绑定用户、主体、namespace、筛选、页大小，24小时过期可回首页刷新。

详情读取本身无副作用，内容成功呈现后独立POST已读；首次read_at由服务端保存，重试不重写。打开铃铛不标已读。“全部已读”作用于全部分类、服务端签名快照上界前已入箱的记录，不吞掉操作期间新到的消息。计数失败显示不可用，不以0代替失败。

空收件箱、筛选无结果、服务未启用、读取失败、无权访问分别展示；正文纯文本且保留换行。详情与筛选可刷新恢复；关联订单通过固定站内资源路径跳转，无自由URL和嵌入HTML。客户端原订单页保留返回消息入口（路由state），直接打开订单仍使用原订单导航。

发布内容状态为draft/published；投递状态逐接收人保存pending/delivered/failed/skipped；read_at独立。后台显示各状态数量，不用单一“发送成功”冒充所有人已读。后台发布后需点击刷新或重新进入查看投递进度，尚未实现后台自动轮询。客户侧可见时轮询、隐藏暂停、故障退避到最多120秒。

## 4. 数据、原子性与资金隔离

增量迁移 [021_messages.sql](../../services/api/internal/database/021_messages.sql) 不修改已应用迁移。实际结构：

| 数据 | 职责 |
| --- | --- |
| message_namespaces | namespace和OTC订阅开关、启用切点；迁移不会自动创建配置 |
| message_grants | namespace/运营/客户/独立动作权限 |
| message_campaigns / message_campaign_recipients | 草稿版本、幂等key、发布正文和明确接收人快照 |
| message_jobs | 持久化outbox兼投递任务；事件key、客户/user、文案、白名单事实、次数、下次重试、结果码 |
| message_inbox_counters / message_inbox | 每接收范围串行分配序号；已入箱时间、首次已读时间 |
| message_audit | 发布、修改、投递、失败重试及运维变更；不可更新/删除，不保存正文或密钥 |

OTC采用数据库AFTER INSERT/UPDATE触发器：与crypto_orders处于同一事务，无提交后“尽力发送”窗口。仅显式启用的namespace、启用切点之后创建的OTC订单生效；旧订单默认不补发。插入生成受理通知，后续state变化到completed/failed/unknown生成相应通知；其他处理中步骤不推送。相同state的修订不重复通知，事件唯一键含订单ID和revision。关闭订阅后不捕获新事件，既存待投递任务仍保留。

触发器不验证外部账本、不新增记账逻辑；完成语义继承权威订单完成条件，不能据通知证明真实渠道或实际到账。远端已完成但本地事务未确认时，仍按原资金恢复流程确认；通知投递失败不重新执行成交、付款或扣款。

OTC白名单快照为currency/amountMinor/toCurrency/receiveMinor/feeMinor、已保存quote.rate及订单状态；不复制渠道原始载荷、私密备注或凭据。金额为最小单位字符串，显示沿用既有USD/USDT精度和两位截断规则，未知值显示暂不可用。成功正文引导查看成交信息，详情提供精确换算后的历史金额，不用当前价格重算。

Worker以`FOR UPDATE SKIP LOCKED`锁任务直至提交，50条/轮、每2秒调度；无需外部队列/租约服务。收件箱插入、序号及任务结果同事务，进程退出则完整回滚。每次投递重新检查收件人有效归属/身份，运营任务同时复检发布权限；失权进入skipped。数据库异常通过savepoint回滚本次投递，记录审计并指数退避加抖动，8次后failed；恢复使用原任务ID及唯一约束，不生成重复消息。

同接收范围的序号分配和入箱在一个锁定事务提交；GET列表/summary使用repeatable-read一致快照。签名token绑定namespace、用户、主体和用途；read-all只更新上界之前的本人记录。首期只支持个人主体，不允许空customer作为通配。

## 5. 当前接口与兼容选择

完整机器契约见 [messages.openapi.json](../../services/api/docs/messages.openapi.json)。每次请求沿用Firebase Bearer身份认证、两站角色分离和no-store响应；消息模块拥有独立transport、网关白名单及Go handler。没有开放DEV接口、通用代理或金融写入。

| 接口 | 方法/语义 |
| --- | --- |
| `/client-api/v1/customers/:customerId/messages` | GET列表，服务端重新验证主体归属 |
| `…/summary`、`…/:id` | GET未读汇总/详情 |
| `…/:id/read`、`…/read-all` | POST幂等首次已读/签名快照上界已读 |
| `/admin-api/v1/message-campaigns` | GET本人授权列表、POST草稿（Idempotency-Key） |
| `…/scopes`、`…/requests/:key` | GET可选客户/按创建幂等键恢复原草稿 |
| `…/:id`、`…/:id/recipients?page=0` | GET详情/投递明细，20条每页 |
| `…/:id/draft` | POST更新未发布草稿（revision），使用POST兼容现有网关写方法 |
| `…/:id/publish` | POST发布（revision＋Idempotency-Key）；UI使用campaign UUID复用原请求 |
| `…/:id/retry-failed` | POST仅重试失败接收人，重复请求不重复投递 |

与初始设计的具体差异：使用已有客户作用域路径；草稿更新为POST而非PATCH；job表同时承担outbox和投递职责；数据库触发器替代Go资金保存钩子，避免不同Worker漏接；行锁事务替代租约；失败尝试进入不可变audit；客户端为列表/独立详情，不额外增加桌面双栏。分类和渠道保持可扩展，首期仅in-app。

客服即时回复、运营自定义订单关联、设置公告、保存期限自动清理、历史通知回填、独立SLO告警接入暂未实现；核心已读动作在详情、列表单条“标为已读”及“全部已读”。不把这些初始候选点宣称为已实现。

## 6. 配置、授权与回退

代码默认所有运行能力关闭，不自动连接生产或执行DDL。独立迁移命令（从services/api运行）为 `go run ./cmd/api migrate-messages`，校验001–020依赖及checksum；API启动不自动迁移。仅在明确授权的目标库执行。2026-09-19生产已显式执行021并配置查询/自动通知；`MESSAGES_SEND_ENABLED=false`，运营发布与失败重试未开放。

运行配置：

| 配置 | 含义 |
| --- | --- |
| MESSAGES_ENABLED=true | 开放消息查询API，启动检查namespace已配置；未启用返回messages_disabled |
| MESSAGES_NAMESPACE | 与目标业务环境的namespace一致；生产显示模式强制等于DEPOSIT_ADDRESS_NAMESPACE |
| MESSAGES_TOKEN_KEY | 独立随机签名密钥，至少32字符；不可进前端或源码；更换使旧游标/快照失效 |
| MESSAGES_SEND_ENABLED=true | 开放运营发布和失败重试；关闭不撤销既有投递任务 |
| MESSAGES_WORKER_ENABLED=true | API进程运行消息Worker；生产根据实际实例数控制并发 |
| message_namespaces.otc_enabled | 数据库中的独立OTC捕获开关；关闭不改变OTC业务开关 |

显式运维入口 `go run ./cmd/message-admin < request.json` 读取JSON请求；必须提供当前active全局运营的operatorUid及evidence，action支持configure/grant/revoke/status/retry。configure初始化namespace或调整otcEnabled，不重置切点；grant/revoke针对userUid/customerId/permission（read/compose/publish/retry），不会自动给accounts:read。status返回按状态计数和最旧年龄；retry仅允许同namespace的failed自动业务通知（非campaign），运营站内信通过后台重试。

请求示意（均为占位，未执行生产配置）：

```json
{"action":"configure","namespace":"shadow_message_demo","operatorUid":"approved-operator-uid","otcEnabled":false,"evidence":"approved local message fixture"}
```

启用顺序：批准目标环境/迁移→配置namespace和权限→配置密钥及查询服务→限定测试收件人验证→开启Worker/运营发送/OTC订阅。启用前明确保存期限、负载与告警阈值；本轮未选择生产值。

回退：停止Worker，关闭运营发布和OTC捕获；必要时关闭整个API开关。保留消息、outbox及审计，恢复后继续处理；不删除订单或冲正交易。仅关闭页面/发送开关不等于停止已排队分发。

## 7. 本轮验收与证据

自动化入口：`node --test tests/frontend/messages.test.mjs tests/frontend/client-workspace.test.mjs`；`bash services/api/scripts/test-postgres.sh`创建随机本地moventra_test_*库、执行Go race测试并清理。测试没有生产凭据，不调用真实金融接口。

| 用例 | 本轮断言 |
| --- | --- |
| M01 主流程 | 两位接收人草稿/发布→Worker→客户列表；重复创建和发布返回原记录 |
| M02/M03 导航和权限 | 消息稳定详情、MFA、客户换ID/已读拒绝；游标绑定筛选，快照跨用户拒绝 |
| M04 重复与并发 | 4个Worker并行仅投递一次；首次read_at保持；发布后正文不可修改 |
| M05/M06 故障与原子性 | 模拟入箱数据库异常→持久化退避→8次失败转failed→后台重试/重复重试→恢复Worker成功；OTC插入回滚无消息、提交后受理/完成各一条 |
| M07 查询与已读 | 游标分页、分类、重复参数拒绝；旧快照全部已读后新投递仍未读；已读失败保留计数并可重试 |
| M08/M09 金额与审计 | 超安全整数金额原文保存、白名单剔除secret；历史汇率、两位展示；权限撤回跳过投递、审计存在 |
| 网关/契约 | 精确方法/路径一致、跨站拒绝、跨Origin写拒绝；OpenAPI每条路由匹配两层白名单 |

浏览器使用 [messages-preview.mjs](../../tests/frontend/messages-preview.mjs) 的真实两端组件和 [TestMessagesBrowserFixture](../../services/api/internal/api/messages_preview_test.go) 的Go API＋隔离PostgreSQL。身份固定为合成alice/staff；后端只暴露消息路由，所有真实金融路径均不可达。需要随机本地测试库、`MESSAGES_BROWSER_FIXTURE=yes`、`TEST_DATABASE_URL`，后端127.0.0.1:18746，前端8876。测试用认证不会编译进生产API。

本轮实际浏览器检查：草稿 `c23ee077-d1d5-47aa-8f50-efcd4898bfd7` 保存/刷新/预览两名接收人/发布，客户端消息 `a7792e69-4b02-481e-ab81-a31fe49fc12f` 阅读后后台仅Alice有read_at，Bob保持未读。OTC合成订单 `ff8e5102-958b-4519-8b8e-eb44f4af22e5` 的10.00 USDT→9.90 USD通知和详情刷新、手机390px布局、全部已读与未读筛选无结果均已检查。订单链接目标在验收入口为隔离占位，只验证ID/返回上下文，不作为完整资金页或真实订单验收。测试库清理后这些ID不可查询。

| 维度 | 本轮状态 |
| --- | --- |
| 设计/本地实现 | 第一批站内信＋第二批OTC核心链完成；保留第1/5节明确的后续项 |
| 自动化专项 | 消息＋客户端路由16项通过；隔离PostgreSQL全套race通过；Go vet通过；最终新增发布并发锁、签名配置校验及8次失败后恢复均单独race复跑通过 |
| 类型/构建 | 两端构建通过（含类型检查）；保留既有后台图表chunk大小提示 |
| 浏览器 | 真实消息组件/Go/本地PG，合成身份流程及390px检查通过；不代表真实Firebase会话验收 |
| 实施阶段真实渠道/部署 | 下述隔离实施未连接生产；后续生产021、查询与自动订阅部署见本文开头的发布记录。真实客户通知投递/阅读仍未验收，运营发送及客户级消息授权仍关闭 |

全量前端回归本轮未完整通过：`customer-funds.test.mjs` 中“funds navigation includes manual records once”断言失败（并行资金导航已移除该入口），随后进程未结束并由90秒外部超时终止。本轮保留这部分并行改动，不把消息专项通过推定为共享工作区全部业务通过。文档、机器契约和路由清单同步维护；下一步为获授权后的生产准备与真实登录验证。

本轮收尾：`pnpm docs:check`、`git diff --check`和依赖边界检查通过；隔离浏览器后端/前端均已停止，随机测试库已清理。源码留在工作区，未提交或发布。

# 交易与资金 API 契约草案

当前能力见[状态摘要](../current-state.md)。下方 DESIGN 模型及 F/R 场景不是已实现或全部通过的能力；本地隔离业务源码已恢复至 [services/local-workspace](../../services/local-workspace/README.md)，私有数据与凭据未迁入。后续日期的实施补充保留其独立证据，不代表本次重跑测试。

更新日期：2026-09-07。状态：DESIGN；下列 financial 路由未实现。本文件不修改现有 OpenAPI，也不授权自动切换前端。

## 1. 当前契约与兼容边界

现有 [Go OpenAPI](../../services/api/docs/openapi.json) 与 [账户模型](../../services/api/docs/account-model.md) 为当前基础：Firebase Bearer、客户主体隔离、运营 MFA + staff_grants、审计、limit/offset，以及正数 amountMinor + direction。

完整现行可达性见 [正式路由与 API 范围](../business/routes-and-api.md)。需区分以下已实现与候选接口：

| 范围 | 当前事实 |
| --- | --- |
| Go 账户/交易列表 | 服务端支持 limit/offset；正式网页只读取默认前 50 条，不把页面数量当全量 |
| Go `GET /admin-api/v1/ops/overview` | 已有授权 USD 交易投影的聚合；7/14/30 香港自然日、MFA、逐客户 transactions:read 与审计，见 [契约](../../services/api/docs/operations-overview.md) |
| Go `GET /admin-api/v1/channel-projections` 及连接内交易/卡资料 | 已有独立 channel_read_grants + staff 身份 + MFA 的手动导入投影查询；交易每页 20 条、来源日期半开区间与版本冲突检查，不混入客户账户/交易或概览。见 [现行范围](../business/routes-and-api.md) |
| 旧本地 `live/transactions` 与 `live/overview` | 支持已保存 Slash 数据的日期过滤和聚合；只属于本地服务，不是 Go 新增 Slash 契约 |
| 下文 `financial/*` | 候选多维模型、来源余额快照及对账接口，仍为 DESIGN |

运营概览只重用已授权客户交易字段，不扩大到客户、卡片、商户或渠道元数据权限。新增渠道读模型另行授权；两者均没有启用下文新的金融资源，也没有统一 Go `succeeded` 与来源 `posted/settled` 的含义。

旧 `/admin-api`、本地 `/local-slash-demo`、Demo settlement-management 前缀与 Go `/admin-api/v1` 是不同契约。不得通过宽泛代理替换。既有 [分析契约](../frontend/analytics-api-contract.md) 仍为独立候选方案。

新 financial 路由隔离新模型；机器 OpenAPI、权限名称和兼容测试需在实施阶段同步补充。新增权限采用默认拒绝，不能自动沿用 transactions:read 暴露所有资金与渠道信息。

## 2. 候选只读路由

以下 `{base}` 表示 `/admin-api/v1/customers/{customerID}/financial`；客户端若需要对应资源，单独建立 `/client-api/v1/...` 契约及字段裁剪，不自动镜像运营详情。

| 方法与路径 | 作用 |
| --- | --- |
| `GET {base}/orders` | 内部订单与多维聚合状态 |
| `GET {base}/orders/{orderID}` | 订单详情及金额口径 |
| `GET {base}/transactions` | 统一交易筛选与游标分页 |
| `GET {base}/transactions/{transactionID}` | 单笔来源与统一字段 |
| `GET {base}/transactions/{transactionID}/timeline` | 来源事件与本地观察分开 |
| `GET {base}/transactions/{transactionID}/relations` | 退款/费用等关联及证据 |
| `GET {base}/fund-movements` | 实际入账资金影响，不是授权列表 |
| `GET {base}/balance-snapshots` | 账户/币种/类型/时点快照 |
| `GET {base}/summaries` | 后端聚合，显式报告口径与覆盖 |
| `GET {base}/reconciliation-runs` | 对账批次 |
| `GET {base}/reconciliation-differences` | 差异、证据和调查状态 |
| `GET /admin-api/v1/channel-connections` | 运营获授权的连接元数据，不含密钥 |
| `GET /admin-api/v1/channel-connections/{connectionID}/capabilities` | 能力、依据及限制 |

异步导出是本地任务写入，不是资金写操作，仍需另定义 POST 创建、GET 状态/下载、配额与审计；本次不虚构为已实现只读 GET。通知入口、补同步、人工匹配或配置修改不混入查询权限。

## 3. 查询参数（内部约定）

- `from/to`：带时区的 RFC3339，半开区间 `[from,to)`；拒绝无时区或反向区间。
- `timeBasis`：authorized_at / posted_at / source_date / observed_at，端点显式声明支持项；没有相应时间的记录不擅自回退，返回排除数量/原因。
- `timezone`：报表分桶时区，默认 Asia/Hong_Kong；查询精确时点仍按 UTC 比较。
- `accountId/channelConnectionId/cardId`：服务端再次校验授权范围。
- `currency/originalCurrency`、各独立状态、`merchantOrderId`：只在适用端点开放。
- `minAmountMinor/maxAmountMinor`：有符号整数串；金额范围要求指定币种；禁止跨币种直接比较。
- `limit`：候选默认 50、最大 100；`cursor`：不透明、绑定查询、权限范围和投影水位。禁止任意 sort 字段。
- `reportingCurrency`、`fxPolicyVersion`、`metricBasis`：折算汇总显式提供；不指定折算则按币种分组。

未知参数返回 400，不能静默忽略。时间范围上限、导出配额与超时待容量评审后配置；不得实现无上限默认。分页按稳定 `(selectedTime,id)` 排序并绑定 readVersion，防止同步更新导致分页混乱；不能保证快照时必须公开限制。

## 4. 核心类型

```ts
type DataState = 'known' | 'unknown' | 'not_applicable' | 'unsupported' | 'unavailable';
type Value<T> =
  | { state: 'known'; value: T; basis: 'source' | 'derived' | 'internal'; evidenceRefs: string[] }
  | { state: Exclude<DataState, 'known'>; value: null; reason: string };

type SignedMoney = {
  signedAmountMinor: string; // 十进制整数；负支出、正流入；余额允许负数
  currency: string;
  scale: number;
};

type SourceRef = {
  provider: string;
  channelConnectionId: string;
  resourceType: string;
  externalId: string;
};
```

金额字符串规范为 `0` 或非零整数字符串，禁止小数点、指数形式及负零。scale 取已验证币种/资产和来源映射规则，不能由客户端随意控制。零不等于未知。

交易 DTO 至少含 id、customerId、internalAccountId、sourceRef、sourceStatus/sourceDetailedStatus、独立 statusDimensions、accountAmount/originalAmount、providerFx、时间组、关系摘要、mappingVersion、同步与质量信息。可选领域值采用 Value；source 字段仅给获授权的脱敏白名单，不返回完整渠道响应。

BalanceSnapshot 至少含 id、sourceRef、externalAccountId、internalAccountMappings、balanceType、available/posted、sourceComputedAt、collectedAt；余额币种解析依据必须可追溯。

## 5. 示例响应（仅契约演示，非真实交易）

```json
{
  "data": [{
    "id": "DEMO-F001-T1",
    "sourceRef": {
      "provider": "slash",
      "channelConnectionId": "DEMO-CONNECTION",
      "resourceType": "transaction",
      "externalId": "DEMO-SOURCE-T1"
    },
    "sourceStatus": "posted",
    "sourceDetailedStatus": "settled",
    "accountAmount": {
      "state": "known",
      "value": { "signedAmountMinor": "-10100", "currency": "USD", "scale": 2 },
      "basis": "source",
      "evidenceRefs": ["DEMO-OBSERVATION-1"]
    },
    "originalAmount": {
      "state": "unknown",
      "value": null,
      "reason": "example_does_not_supply_original_amount"
    }
  }],
  "page": { "nextCursor": null, "hasMore": false, "readVersion": "demo-projection-1" },
  "meta": {
    "schemaVersion": "financial-draft-1",
    "mappingVersion": "slash-draft-1",
    "dataMode": "demo",
    "timezone": "Asia/Hong_Kong",
    "timeBasis": "posted_at",
    "from": "2026-09-01T00:00:00+08:00",
    "to": "2026-10-01T00:00:00+08:00",
    "generatedAt": "2026-10-01T00:01:00Z",
    "lastSuccessfulSyncAt": null,
    "sourceAsOf": null,
    "complete": false,
    "coverage": { "state": "unknown", "reason": "contract_example_only" },
    "failedSources": [],
    "warnings": ["DEMO_NOT_REAL_CHANNEL_DATA"]
  }
}
```

该示例只展示字段子集，不作为完整 Transaction DTO 的机器校验样本。未来实施必须提供完整 required 字段和对应 JSON Schema。

`complete` 表示请求统计范围的已知覆盖，不表示“当前页已返回”或“已遍历 cursor”；sourceAsOf 仅在可证实来源水位时填写，不能拿 generatedAt 替代。

## 6. 状态码、权限和前端处理

- 401 未认证；403 权限/MFA 不足；资源不存在和不允许知道其存在时统一 404。
- 400 非法参数、币种/口径组合；429 限流；503 无可用依赖或必要审计失败。错误保持 `{error:{code}}` 基础形状，可加安全的 requestId，不返回凭据和上游原文。
- 部分源失败且允许部分查询时，200 + complete=false + failedSources/coverage/warnings；全无可用数据返回错误，不是余额零。
- 返回旧快照需显式 stale、来源时点和失败信息；不能仅成功 HTTP 状态就显示“实时”。
- 详情、关联、时间线、统计、导出与连接能力都独立做服务端授权；缓存不得跨主体复用敏感结果。
- 前端只格式化、筛选和展示；状态映射、净额、费用去重与币种汇总由后端负责。


## 历史：独立本地演示（2026-09-06）

React/Node演示已实现 `/local-slash-demo/management/fx/{transactions,report,balances,differences}`（Vite固定loopback转发），以及单笔timeline/relations、白名单CSV。该路径继承本地操作员会话，仅用于 `fx-cross-currency-v1`；不等同于上文Go financial草案实现。`transactions?unified=yes` 联合原清算只读视图，分页/筛选/排序在服务端执行，不复制旧账务数据。详见 [跨币种交付](../frontend/cross-currency-delivery.md)。

## 历史 2026-09-07：隔离卡片管理执行模块

本次用户明确授权在本地补齐冻结、双人审批、强制扣款与转入/转出，新增 `/local-slash-demo/management/card-admin` 契约。使用独立ca_*账本，不接管Go交易投影或旧Portal预算；逐项权限、预占及双边分录在服务端实现。真实金融写接口仍禁用。详见 [卡片管理盘点、接口与验证](../frontend/card-administration.md)。

## 历史 2026-09-07：本地真实 Slash 投影

新增 management/live 的 status、cards、transactions 只读查询与本地 sync 触发。仍不是上文 Go 草案的生产实现。服务端连接授权、loopback 边界、金额精度、revision 分页和失败保留规则见 [真实数据接口](../frontend/slash-live-data.md)。

## V1 对账契约增量（2026-09-07，DESIGN，未实现）

此节承接 [账本与对账规划](../domain/reconciliation-v1-plan.md)，描述待实施能力，不新增现有可调用端点。客户查询沿用客户主体授权；运营跨客户批次需单独的获授权范围，不能用客户路径查询全平台数据。最终路由、机器 Schema 和权限名称随正式服务实施定稿。

| 能力 | 输入及结果要求 | 权限边界 |
| --- | --- | --- |
| 账户对账单/客户余额拆解 | 内部账户、资产、期间、固定 readVersion；期初、逐笔已入账、占用变化、期末和证据 | 查询且逐账户授权 |
| 创建核对批次 | 范围、资产、期间、日切时区、输入版本、幂等键；返回任务与批次 ID | 运行权限；不触发上游写入或自动记账 |
| 查询批次/核对明细 | 批次 ID 与版本；三层核对、覆盖、排除项、计算过程与原因 | 查询；后端分页与聚合 |
| 差异分派/提交处理/复核 | 差异 ID、版本、原因、证据、责任人、处理动作引用 | 调查和复核分离，处理人不得自复核；关闭不直接改余额 |
| 导出固定版本 | 已授权批次与筛选、精确金额、元数据；任务状态和限时下载 | 独立导出权限，下载复检 |
| 账务纠正 | 关联原经济事项、原凭证、调整方案及批准记录 | 独立调整/审批权限；不属于差异关闭接口 |

必要数据结构：

- `ReconciliationRun`：id/revision、scope、ledgerId、asset（币种/网络及精度）、from/to、dayCutTimezone、ledgerReadVersion、sourceObservationRefs、openingEvidenceRefs、mappingVersion、ruleVersion、requestedBy、时间组及失败原因。
- `coverage`：应覆盖账户与期间、实际覆盖边界、失败/缺失/排除项、完整性依据；未知分母不填100%。源采集完成不自动等于账务期间完整。
- `ReconciliationItem`：layer、internalAccountId、sourceRef、balanceType、opening/increases/decreases/expectedClosing/sourceActual/comparableExpected/unexplainedDifference、bridgeRefs、result、reasonCodes、evidenceRefs。金额使用 SignedMoney/Value，非适用字段不填0。
- `Difference`：id、run/item引用、economicReference、关联主差异、分类、金额、firstSeenAt、assignee、dueAt、workflowStatus、revision、处理/复核意见、凭证与重跑结果引用。
- `AccountMappingVersion`：内部客户/卡/资金账户、上游连接/账户、资金角色、生效区间和确认依据。来源持卡人姓名不能替代内部所属用户。

三组候选状态独立返回：作业 `queued/running/completed/failed`；核对结论 `not_checked/insufficient_data/matched/different`；差异处理 `unassigned/in_progress/pending_review/closed`。作业completed只代表计算完成，closed只代表处理闭环，均不能覆盖原始差异或冒充已匹配；明细保留unmatched/mismatch等具体原因。

创建命令幂等键绑定操作者、授权范围及规范化请求摘要；同键不同内容拒绝。处置命令检查revision及当前状态，重复提交不得追加重复动作，版本冲突返回409。批次、明细、分页、汇总、导出必须引用同一固定版本；重跑生成新版本和替代关系，不覆盖旧报告。

金额比较限定同资产/单位；平台资金池与客户分户仅经明确控制账户映射核对。多币种汇总按资产分别返回，不能暴露混合数值total。来源超时、期初缺失或观察时点不一致以结构化原因返回；不以成功HTTP状态、空列表或显示0.00判定对平。现有默认报表时区不等于已批准财务日切。

## 2026-09-13 开户默认功能权限（本地）

用户确认：后台审批并开通后，全部客户端功能默认获得权限。审批与服务状态继续分开保存，由明确的组合操作原子更新；不自动执行资金、生成余额或开卡。暂停收回办理资格，恢复默认开放。新增接口、003迁移、权限及本次隔离验收见[开户功能权限](../frontend/onboarding-feature-access.md)；尚未部署，不将已有只读授权升级为审批权限。

## 2026-09-13 联合候选：身份入口

新增 GET `/client-api/v1/me` 与 `/admin-api/v1/me`，返回必需 role=customer/admin；兼容 `/api/v1/me` 保留真实角色。跨端角色 403（customer_required/operator_required），身份认证与客户/渠道授权、运营 MFA 分开验证。既有开户、渠道和金融金额契约保留。需增量迁移 004，当前生产未执行；见[联合发布记录](../releases/2026-09-13-admin-login-joint.md)。

## 2026-09-13 正式目录查询增量（LOCAL）

已有 `GET /admin-api/v1/channel-projections/:connection/cards` 开放正式目录：每页 20 条；page/keyword/cardStatus/revision。keyword 查卡名、尾号或 ID；cardStatus 精确来源状态，未知值不转换。卡片查询不接受交易日期或 detailedStatus。交易列表增加 cardId，严格限制在当前获授权连接/导入版本，不改变金额或状态。身份、MFA、channel_read_grants 和审计与原详情保持一致。

正式账户目录使用既有 `GET /admin-api/v1/customers/:id/accounts?limit=20&offset=N`；前端保留 meta.hasMore，客户端/后台身份隔离不变。旧 Node 管理契约已恢复至 services/local-workspace，但未作为正式 API 开放。

## 2026-09-13 正式注册用户目录

新增候选 `GET /admin-api/v1/users?email=&limit=20&offset=0`，空邮箱参数应省略。完整邮箱精确查询由 Firebase Admin SDK 获取可信 UID，再关联正式注册资料；默认分页列出 PostgreSQL 中的 customer 用户，用户停用状态不隐藏。全部 active admin 经 MFA 后可查看基础注册资料，此范围由用户明确确认。客户名称、ID、业务链接继续受原 staff_grants 限制；未授权关联只返回存在状态。005 只新增独立查询审计表，不改角色、客户、资金或权限。接口详细参数、状态及范围以 OpenAPI 为准；部署以本批发布记录为准。

## 2026-09-13 用户详情查询

既有 `GET /admin-api/v1/users` 增加可选 `userId`（完整 UUID）精确过滤，与 email 互斥、offset 必须为 0；仍返回分页信封，未找到或非 customer 用户返回已审计空列表。复用 `users:list` 审计，无新增迁移。全部 active admin + MFA 可读基础资料；关联客户和账户仍按原资源授权。详情页通过既有账户 GET 展示真实字段，未提供余额的接口不生成余额。

## 2026-09-17：独立 Blnk shadow 契约（LOCAL）

新增 `GET /{client|admin}-api/v1/customers/{customerID}/ledger`，仅本地影子模式启用。客户个人所有权、运营 MFA 与独立 ledger_read_grants、强制审计；不沿用原查询权限扩权。所有金额为最小单位字符串，按币种汇总。返回 `mode=shadow`、`executionEligible=false` 和明确核对范围，不替换原 accounts/transactions。写入只在受信本地 CLI，未新增公共金融写接口。详见 [Blnk 契约](../integrations/blnk.md) 与 [机器契约](../../services/api/docs/ledger.openapi.json)。

## 2026-09-18 运行就绪检查

`GET /readyz` 保持原成功 200、失败 503 格式；2 秒内核验本地数据库的迁移 001–005 及 checksum，启用 ledger 时额外核验 006。`/healthz` 仅确认进程。两者不证明 Firebase/Blnk/渠道或真实业务验收。没有新增公网监控接口；本地 CLI status 不扩大客户或运营权限。

## 2026-09-18 客户卡片测试快照增量

新增 `GET /client-api/v1/customers/{customerID}/card-projections` 和连接内 `cards|transactions` 列表/详情，见 [流程及契约](../business/customer-card-binding.md) 与 OpenAPI。本地业务交易契约保持不变；快照按来源有符号金额和双层状态展示，不写入客户 transactions 或账本。仅既有个人主体所有人和逐卡显式绑定可读，不沿用运营连接权限。部署状态见流程记录。

## 2026-09-18 线上测试余额

新增 `GET /client-api/v1/customers/{customerID}/test-wallet`：个人所有权、active/customer 身份、读取审计、no-store，无查询参数和HTTP写入口。返回 mode=online_test、executionEligible=false、withdrawalEligible=false、enabled、按USD(2)/USDT(6)的余额字符串、最近50条测试额度记录及hasMore。未配置不是读取失败；真实交易与账本不参与。见[独立测试流程](../business/online-test-wallet.md)。

## 正式线上测试资金契约（2026-09-18，LOCAL）

`GET /{client|admin}-api/v1/customers/{customerID}/test-funds` 返回 `mode=online_test`、`executionEligible=false`、`withdrawalEligible=false`、`enabled`、`canOperate`、全量聚合余额及最多20条分页订单。筛选 `kind/status/page` 不影响余额，`page` 从0开始（最大500），`total` 对应筛选后的全量订单。`GET .../orders/{orderID}` 返回独立订单与按revision排序的处理事件。

`POST .../commands` 严格 JSON，必带 UUID `Idempotency-Key`。请求字段 action/currency/amountMinor/quoteId/orderId/revision/recipientLabel/note；动作字段含义与金额规则见 [流程卡](../business/online-test-funds.md)。客户端允许deposit/quote/exchange/withdraw/cancel；运营允许detect/approve/reject/unknown/complete/fail，并必须填写note。幂等键绑定客户+操作者+完整请求；重复返回原结果，异载荷409。未知结果复用原键，不重新建单；409报价失效、余额不足、版本冲突均不变动余额。后台MFA与逐客户测试审核授权不继承为真实资金权限。

旧 `test-wallet` 的 `amountMinor` 现在为当前可用测试余额（包含009变动及预占），`grants` 仍是原始不可变额度记录。真实账户与卡片投影未合并入测试余额。

### Slash 普通 Webhook（2026-09-18 试接入）

`POST /webhooks/slash` 不使用客户端会话，使用 Slash 官方 RSA/SHA256 公钥验证原始请求体；数据库提交后返回 204。401/405/413/503 的条件见 [上线记录](../../deploy/slash-webhook-online-2026-09-18.md)。该端点只进入独立来源收件箱，不提供支付授权或客户查询接口。

## 2026-09-18 项目钱包归属候选

本地增量 011 为 APEXIS Op 项目共用钱包及逐卡归属增加配置；不属于客户余额。现有 `/client-api/v1/customers/{customerID}/card-projections` 路由兼容：未切换客户保留 test_snapshot，已切换客户返回 assigned_wallet_projection，按当前导入版本、明确 cardId 归属及父账户/virtualAccountId 同时隔离。未知钱包来源字段不授予读取权限，新卡不继承初始邮箱归属；共享钱包标识和余额不进入客户 DTO。列表、总数、详情遵循同一条件，版本冲突仍为 409。

后台卡片 DTO 新增内部 assignmentKind（project_wallet / test_snapshot / unassigned），不暴露客户邮箱。项目分配范围和当时准备证据见 [项目钱包流程卡](../business/project-wallet.md)；后续代码及归属显示已纳入[统一发布](../../deploy/2026-09-18-session-consolidation.md)，不能把原候选批次的未部署状态用于当前代码。具体绑定执行结果须另看对应业务证据。

## 2026-09-18 BIN catalog

新增正式 `/card-bins` 管理页与 `/admin-api/v1/card-issuing` 契约；来源目录导入使用 `issuing-admin import-catalog`。未配置价格以空字符串传输、数据库 NULL 保存，与免费 `0` 区分。生产保持真实发卡执行关闭。详见 `docs/business/bin-catalog-sync-2026-09-18.md` 与 `services/api/docs/issuing.openapi.json`。

## 2026-09-18：开卡名称与默认持卡人（LOCAL）

`card-issuing/orders` 增加 `cardName`：服务端首次提交时从100个姓名选取并持久化，重试/补充首充保持；历史无名称返回空字符串。Slash name 使用该值；新请求省略 cardholderId。Enrollment 新调用只需 customerId/groupId/enabled/revision，旧 supplierId/cardholderRef/evidenceRef 输入弃用，GET 不再返回 cardholders。见[流程与兼容边界](../business/card-issuing-2026-09-18.md)。
## 2026-09-18：后台用户归属读取修复（代码已发布）

API/后台发布见[统一发布记录](../../deploy/2026-09-18-session-consolidation.md)，本次没有重新执行线上验收。

正式 channel-projections 卡列表、卡详情及交易查询从既有 project_wallet_cards / 有效 customer_card_bindings 读取归属，返回 assignmentKind 与 internal.ownershipStatus/customerId/userId/customerName。后台列表、详情和交易抽屉显示同一用户；新导入保留绑定，客户端原有范围与字段裁剪不变。无新迁移、改绑或资金操作。实现与验收见 [流程卡](../business/card-owner-display.md)。

归属联合验收补充：连接读取权限不自动授予客户身份读取；需要该客户 accounts:read，缺失或撤销时只返回 restricted，不泄露 customerId/userId/name。

## 2026-09-18：客户端开卡声明与新卡查询（应用已部署，真实发卡关闭）

card-issuing 新增 GET products/{id}、terms、cards、cards/{id}；报价增加 termsVersion；POST orders 必须同时提交 lawfulUse=true、acceptedTerms=true 和有效条款版本。订单详情增加不可变同意证据和处理事件；历史无证据为 null。卡分户余额不是来源可用余额。机器定义见 [issuing.openapi.json](../../services/api/docs/issuing.openapi.json)，流程与兼容见 [开卡闭环](../business/client-card-issuing.md)。

## Cregis 隔离资金契约（2026-09-18）

新增独立 `/client-api/v1/customers/{customerID}/crypto` 和运营路径；quotes/orders、cancel、settings、approve/reject/recover 及来源连接/events/detail/sync 由 [机器契约](../../services/api/docs/crypto.openapi.json) 定义。金额整数字符串，USDT 6 位、USD 2 位；报价 60 秒，政策版本 CAS。幂等 UUID、主体授权及运营 MFA 在 Go 强制；前端/网关同步白名单。详情含订单、审计及 Blnk reference。原隔离闭环历史见[隔离记录](../business/cregis-funds.md)，现行四流程见下节。

## 四流程增量（2026-09-18，本地接入准备）

现行 crypto 契约扩展 `POST addresses`（currency/network，开户完成后进入充值页触发）、`withdrawals/quotes`（network/address/amountMinor）、`cards/quotes` 和 `cards/orders`（cardId/direction）。提款订单必须匹配报价网络及完整地址。GET 支持 kind/status/cardId、limit=5 或 20，时间倒序；返回 networks/cards/addressJobs/canOperate，mode 为 shadow 或 live。正式模式仍受独立启用条件约束，不能仅凭 mode 或 executionEligible 判定全部能力已验收。详细字段见[机器契约](../../services/api/docs/crypto.openapi.json)与[流程卡](../business/funds-center.md)。

## 余额查询与人工出入金（2026-09-18，代码已发布）

新增 [manual-funds OpenAPI](../../services/api/docs/manual-funds.openapi.json)。后台 GET `/admin-api/v1/balances` 及 `/{customerId}` 查询授权范围内全用户、筛选汇总及分页详情；金额来自已登记 journal，缺失为 null，不冒充上游余额。

订单 GET `/{admin|client}-api/v1/customers/{customerId}/manual-funds` 及 `/orders/{orderId}`；后台 POST `/orders` 和单号后的 approve/reject/cancel/confirm_payment/payment_failed/reconcile。USD金额使用最小单位字符串，创建带凭证引用，动作带 revision 与幂等键。冲正新建关联原单，不提供直接余额覆盖。后台要求MFA、独立read及对应create/review/execute授权；客户仅查询本人且裁剪内部字段。网关按站点、精确路径与方法放行，跨域POST拒绝。

缺少016迁移/服务配置时此能力不可用；代码已发布，生产016迁移及资金授权未启用。状态、作用范围和未验证边界见[FLOW](../business/platform-advance.md)。

地址GET限定验收增量：mode可为deposit_pilot；postingEnabled反映指定客户额度、处理任务健康及账本一致性，不能用它推断提款/兑换已启用。pilot返回capMinor、remainingMinor、walletMinor（仅核对一致时）、reconciliation；全部金额为USDT六位精度的最小单位整数字符串。events新增state、posting、error、orderId，只有posting=posted表示入账。跨客户调用无变化，非验收客户无余额/额度信息。详见[地址流程](../business/deposit-address-integration.md)。

## 地址独立接入增量

新增GET/POST `/client-api/v1/customers/{customerID}/deposit-addresses`；GET支持page或event，POST仅TRC20与UUID幂等头。回调`/webhooks/cregis/address-deposit`仅持久记录，不增加余额。见[契约及流程](../business/deposit-address-integration.md)。

## 卡片状态同步（2026-09-18，已发布）

GET 卡片列表/详情在正式项目钱包及运营授权下使用共同当前状态；DTO含 `syncState`（synced/pending/unverified/error）及可空 `checkedAt`；无通知不代表过期。先应用状态再筛选、计数和分页，历史测试快照仍固定版本。POST `/client-api/v1/customers/{customerID}/card-projections/{connection}/cards/{id}/sync` 与 `/admin-api/v1/channel-projections/{connection}/cards/{id}/sync` 仅安排只读渠道回查，202不代表已同步。沿用个人所有权或运营MFA+渠道授权；不存在/越权404，未启用409 `card_sync_disabled`。不提供任意渠道代理。详见[流程与验收](../business/card-state-sync.md)。

卡片状态命令：POST 同一详情路径 `/actions`，仅接收 `{action:activate|pause|close,expectedStatus:active|paused|inactive,confirmClose:boolean}` 与UUID `Idempotency-Key`。close要求confirmClose=true，closed不允许恢复；禁止透传其他Slash字段。首次202、相同请求200只表示命令已接收，confirmed才是读取渠道已达目标。DTO增加controlsEnabled和cardAction（id/state/targetStatus/error）。客户限本人正式归属卡；后台限admin+MFA+渠道授权+该客户accounts:read，连接必须显式开启controls_enabled。409表示功能未启用、同卡未决命令或幂等冲突；越权404/403。仅Slash适配器PATCH status，其他渠道不继承Slash机制。

生产展示增量：GET crypto及orders允许复用已配置的限定充值正式账本，继承所有权/MFA/独立查询授权；不依赖全量金融执行认证来读取既有余额。该只读能力返回mode=live，executionEligible/realWrites/canOperate=false，POST仍503 crypto_disabled。FUNDS_DISPLAY_MODE=production时test-wallet/test-funds及scopes在网关和源站404，shadow资金服务不可读取。接口路径和金额精度不变。

## 正式资金分能力接入（2026-09-18）

crypto快照capabilities新增otcEnabled/cardTransfersEnabled；前端同时检查客户资格与业务/网络能力。地址mode=production没有试点限额，postingEnabled取worker健康状态。正式余额查询不等于manual enabled=true。

## 全局管理身份

身份GET新增兼容布尔字段globalAdmin，只有active admin且完成MFA时可为true；字段仅用于界面标记，所有资源仍由服务端动态授权。既有customer/admin枚举不变，见[权限流程](../business/global-administrator.md)。

## 2026-09-19 卡片详情扩展（本地，未部署）

客户单卡详情新增`fundingCardId`（精确映射或null）与`cvvAvailable`，均由服务端授权判定。资金卡读取新增`heldMinor`（未近期核验为null）与`inTransitMinor`（核对未知为null），在途关联完整账本escrow及原卡片订单，不取最近页求和。crypto列表新增`from`、`to`（UTC订单创建时间，左闭右开）和`direction`（wallet_to_card/card_to_wallet）筛选，计数与分页使用相同条件。新开卡详情可返回唯一已验证`projection`链接，不按尾号猜测。

CVV为客户专用POST，沿用Firebase Bearer登录，无额外验证；响应独立、禁止缓存和持久化，不加入普通卡片DTO。详见[CVV合同](../frontend/client-cvv.md)及[卡片流程](../business/customer-card-binding.md#flow-card-detail-001卡片详情与充提2026-09-19)。


### 2026-09-19 客户卡交易筛选与导出（本地前端）

复用现有 card-projections 查询参数：keyword、detailedStatus（单值）、from（含）与 to（不含）、page、revision。界面日期为 UTC 日历日期，结束日期转换为次日零点；列表与导出共用参数生成器。导出从第 0 页顺序查询、固定 revision，每页 20 条，上限 5,000 条，不新增导出 API 或权限，不跨连接聚合；错误不下载部分数据。见[流程](../frontend/client-workspace-layout.md)。

2026-09-19 USDT展示约定（本地）：页面金额显示固定两位并向零截断；API的USDT最小单位仍为10^-6，整数金额和报价有效性、费用、状态及余额校验不变，不在服务端截断。金额输入和配置编辑仍提交完整值。


2026-09-19：新增本人卡片 POST `.../card-projections/:connection/cards/:id/details/reveal`；临时返回pan/cvv/name/expiryMonth/expiryYear及原source/cardId/expiresAt。普通详情仅增加detailsAvailable，不包含敏感值；原CVV-only兼容，认证、限流、归属复核与no-store见[协议](../frontend/client-cvv.md)。本地未部署。

## 消息API本地实现（2026-09-19，未部署）

独立消息契约见[机器OpenAPI](../../services/api/docs/messages.openapi.json)及[FLOW](../business/message-center.md)。客户作用域收件箱、签名游标/已读快照与后台草稿/发布/恢复不修改本页资金接口。OTC通知从原订单已保存事实生成，不作为成交或入账的新权威。


## 统一 USD 开卡增量（2026-09-19，本地）

开卡 wallet 增加 fundingSource/executionEnabled，order 增加 fundingSource/fundingAccountId；统一钱包条款版本 issuing-funds-2026-09-19-v1。普通卡详情可附 issuingOrderId 链接原单。021新增新卡来源归属；历史无 namespace 订单保留原账本与退款路径。统一模式拒绝旧开卡入金新申请/复核。完整闭环与验收边界见 [开卡流程](../business/client-card-issuing.md)。
## 2026-09-19 卡片历史与指标

已上线：渠道卡行增加metrics（金额字符串/null、时间窗口、覆盖及同步状态），交易列表支持metric=spending，逐卡metrics-sync仅排队只读补查。详见[卡指标合同](../business/card-metrics.md)和[发布记录](../../deploy/2026-09-19-card-metrics-release.md)。

2026-09-19 额度数据接入（本地实现，未部署）：浅灰额度卡使用同一渠道快照的 availableMinor（剩余可消费额度）、cycleSpendMinor（本周期已用）和 totalLimitMinor（明确的单卡 utilizationLimit 总额度）。总额度仅提取已识别的单卡规则，卡组共享或其他规则显示未提供；只有总额度等于已用加剩余且大于零才显示进度，不用近30天消费或钱包余额推算。卡分户及统一 USD 钱包余额独立读取，保留核对状态与充提权限门槛。刷新沿用 metrics-sync，只排队只读查询；近30天消费明细区间保持。

## 统一资金记录（2026-09-19，本地未部署）

新增两端 `GET /{client|admin}-api/v1/fund-records` 与 `/{recordId}`。按来源授权、服务端联合筛选/分页，金额分项与入账状态独立；精确契约见 OpenAPI FundRecord/FundRecordsResponse，数据覆盖与兼容见[统一资金记录](../business/fund-records.md)。不依赖生产未应用的021/022。


2026-09-19 人工资金接通增量（本地未部署）：现有manual-funds DTO、状态和路由不变。enabled仅在显式人工开关、enabled生产资金模式及ProductionReady健康时返回true；pilot和prepare保持只读。后台订单由API内持久恢复任务处理，权限、MFA与独立审核不变，见[人工资金流程](../business/platform-advance.md)。

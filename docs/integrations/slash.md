# Slash 只读接入规范

核验日期：2026-09-07。状态：公开文档及本租户 GET 只读调用已核验；真实 Webhook、生产接入与资金验收未执行。

分类及当前实现边界见 [开发总纲](../DEVELOPMENT.md)。现有 Demo 字段明细见 [Slash 字段差异](../frontend/slash-field-gap.md)。

## 1. 官方证据（SOURCE）

| 范围 | 官方依据 | 本次可确认的事实 |
| --- | --- | --- |
| 交易模型 | [Transaction](https://docs.slash.com/api-reference/schema-transaction) | 两层来源状态；USD 分记账，负借记正贷记；`date` 含义随状态变化 |
| 机器契约 | [OpenAPI](https://api.slash.com/openapi) | 本次 info.version 为 0.0.1；不是长期稳定性保证，实施时需记录提取版本或内容摘要 |
| 余额 | [Balance](https://docs.slash.com/api-reference/schema-balance) | type 为 cash/credit/debit；available、posted、timestamp 分开；类型不能无条件相加 |
| 通知 | [Webhook](https://docs.slash.com/api-reference/webhook-overview) | 可能重复和乱序；eventId 用于去重；原始请求体与 RSA/SHA256 签名校验 |
| 加密 | [MLE](https://docs.slash.com/docs/message-level-encryption) | 按请求 opt-in 的 JSON 消息体加密；不替代认证、TLS 或本地存储保护 |
| 只读凭据限制 | [Agent Requests](https://docs.slash.com/docs/agent-requests) | 只读密钥的写请求可能形成待人工批准的 deferred action；不能只靠密钥阻止写意图 |
| 分析 | [Analytics](https://docs.slash.com/api-reference/analytics-post) | 只读 Snowflake 安全视图，可能滞后最多约一小时；容量及配额仍需验证 |
| 费用详情 | [Fee details](https://docs.slash.com/api-reference/transaction-get-fee-details) | 查询费用交易的明细，不是任意消费 ID 的全部费用查询保证 |

原始文档发生变化时，更新核验日期、差异及测试。不得把渠道网页示例当作完整真实生命周期。

## 2. 字段差异与目标映射（DESIGN，来源约束为 SOURCE）

以下为跨项目重点差异，不替代完整 Schema。来源可选对象的必填子字段只在对象存在时适用。

| 来源 | 本地现状 | 目标字段/类型 | 显示与转换要求 |
| --- | --- | --- | --- |
| `id`、`accountId`、`virtualAccountId`、`cardId` | Go 内部 UUID 与 Demo source ID 分离 | `sourceRef`、`externalAccountId` 等 string | 保留内外 ID；accountId 的宽松来源 Schema 需验证，不能强制冒充内部 UUID |
| `status`、`detailedStatus` | Go 三状态；Demo 保留原值 | `sourceStatus`、`sourceDetailedStatus` string + 内部多维状态 | 原值与中文解释并存；未知值不转为成功 |
| `amountCents` | Go 正数最小单位+direction；Demo 有符号整数 | `accountAmount`，见统一 SignedMoney | USD/scale=2 来自渠道文档；负支出正流入；不得直接写入 Go 当前正数约束 |
| `originalCurrency.code/amountCents/conversionRate` | Demo 已保留；Go 基础表缺失 | `originalAmount`、`providerFx`，可空 | 消费金额与记账金额并列；汇率十进制字符串，不重算历史扣款 |
| `authorizedAt`、`date` | Go 单一 occurred_at；Demo 分别保存 | `authorizedAt`、`sourceDate`、`postedAt`，UTC 字符串/可空 | 仅依据 posted 状态从 date 派生 postedAt，不能统一当创建时间 |
| `accountSubtype` | Demo 已保留 | `sourceAccountSubtype` string | 不等于 Balance.type；借记账户交易 subtype 仍可能为 cash |
| `orderId`、`referenceNumber`、`providerAuthorizationId` | Demo 已保留 | `merchantOrderId`、`referenceNumber`、`providerAuthorizationId`，可空 | 详情关联区；商户订单号不唯一，不自动证明退款关系 |
| `merchantData`、`memo`、原因字段 | Demo 已保留白名单 | 有类型的商户/原因结构，可空 | 商户描述优先 merchantData；未知商户不填造假默认值 |
| `fxFeeInfo`、`cashbackInfo`、`feeInfo` | Demo 来源与调整分开 | 费用注释、返现信息、来源关联 | 信息不等于独立入账；不得重复累计 |
| Balance available/posted/type/timestamp | Go 无余额接口；Demo 有快照 | `BalanceSnapshot` | 按账户/币种/余额类型展示，并显示来源时点和采集时点 |
| Webhook 元数据 | Demo 模拟事件/版本 | `SourceEvent` 与 `EventDelivery` | 事件与交易快照分表；事件时间不是 GET 对象版本 |
| 无通用对应字段 | Go/Demo 部分内部字段 | `mappingVersion`、`coverage`、`syncState`、`relations` | 明确标为内部字段，不放进 Slash source 对象 |

补充限制：

- `originalCurrency` 缺省为 USD 是 Slash 专属文档规则，其他渠道缺失币种不能也默认 USD。原币金额/汇率缺失不能凭币种默认补齐。
- 原币字段文档使用 cents；非两位小数币种的编码、符号与舍入需实证确认，不能机械按 ISO 精度重解释原始数字。AED/CNY Demo 必须声明使用 scale=2。
- `conversionRate` 描述为原币到记账币种；未承诺单独提供完整授权和最终入账汇率历史。
- `feeInfo.relatedTransaction.amount` 单位未明确，不作为金额计算输入。
- Balance.Money 仅带 amountCents，不能声称来源每笔余额都带 currency；应从已验证账户/产品上下文解析并记录依据，否则币种未知。

## 3. 状态映射注意事项

来源 status：`pending`、`posted`、`failed`。来源 detailedStatus：`pending`、`pending_approval`、`in_review`、`canceled`、`failed`、`settled`、`declined`、`refund`、`reversed`、`returned`、`dispute`。枚举依据 [Transaction](https://docs.slash.com/api-reference/schema-transaction)。

内部映射必须读取组合状态，而不是按枚举序号推进：

- pending_approval 不应按普通 pending 推断余额占用。
- settled 映射为入账事实，不代表不可退款或争议已结束。
- refund 不能仅凭标签推算原订单全额退完；先校验入账和关联证据。
- reversed 与入账后的退款/冲正分开。
- dispute 不自动推算获赔或新的资金流。
- in_review 的完整业务含义、矛盾组合和新枚举进入未映射/待核实路径。

本次 OpenAPI 的交易返回 detailedStatus 与列表 filter:detailed_status 枚举并不完全一致。前端不能把所有显示状态无条件透传为渠道筛选；本地投影可筛选，远端查询按实际能力处理。

## 4. 适配器与同步（DESIGN）

候选只读调用：`GET /transaction`、`GET /transaction/{transactionId}`、`GET /transaction/{transactionId}/fee-details`、`GET /account/{accountId}/balance`。其他账户/卡片端点在实施时逐项加入精确方法/路径白名单，不开放通配代理。

1. 接收通知 → 校验来源连接及原始字节签名 → 持久化收件箱与投递记录 → 及时应答 → 异步获取实体。
2. 按连接与实体串行化/合并拉取，保存脱敏来源版本，再映射和发布查询投影。
3. 同一事件多次投递只有一个业务处理结果；不同通知读取到同一实体也不重复产生资金影响。
4. 当前公开 Transaction 未列通用 updatedAt/version，列表未列 updated_since。使用通知、未完成对象刷新、重叠窗口和周期对账组合；不能只扫当天。
5. 没有来源对象版本时，本地 observation 序号仅代表观察顺序，不证明来源业务先后；不使用通知时间给 GET 响应定版本。失败恢复后重拉并标记历史缺口。
6. 分页仅在数据事务提交后推进断点；重启可安全重复。date 可能随入账变化，重叠扫描、去重和覆盖核对必须测试。
7. 删除卡片不删除历史交易。来源 schema 不兼容时隔离原记录、告警并标记覆盖不足，不悄悄丢弃或记零。

Slash 通知要求在 10 秒内得到 2xx，否则重试；存在退避和自动禁用机制，因此需监测入口状态和积压。具体重试规则见 [通知文档](https://docs.slash.com/api-reference/webhook-overview)。恢复配置属于渠道写操作，需要独立授权。

不要因为事件名含 `payments.refund` 就直接订阅为发卡消费退款；其产品范围和实体路由需核实。普通通知与参与支付批准的授权 Webhook 严格分离，后者不在首期范围。

## 5. 安全及 MLE（DESIGN）

- 凭据放服务端秘密管理，前端只访问本系统；按连接限制授权主体，不接受前端自报主体作为授权依据。
- MLE 使用 `MLE-KEY-ID` opt-in；服务端选择强制 MLE 的端点必须验证加密响应，失败关闭，不能静默降级。
- 密钥 ID 不是加密秘密；秘密需要轮换与最小访问权限。采用官方 AES-256-GCM envelope；加密不覆盖 URL、请求头、查询参数或本地存储。
- 不把 MLE 当成通知验签，也不推断 Webhook 已加密。凭据、PAN、CVV、OTP 不进入日志、来源白名单或导出。
- 分析 SQL 仅允许后端审核模板及受控参数，不开放浏览器任意 SQL。

## 6. 能力声明和上线前 OPEN 清单

能力状态使用 `supported / unsupported / unverified`，另带证据、限制和核验日期；执行时失败是独立运行状态，不能改写成不支持。

| 项目 | 目前结论 | 上线条件/阻塞范围 |
| --- | --- | --- |
| 列表、详情、余额、通知 | SOURCE 有接口，真实连接未验证 | 租户权限、产品、账户范围和配额验证后才标记连接可用 |
| 历史增量与补数 | 无通用更新时间保证 | 验证历史保留、分页和旧交易更新覆盖；影响完整性声明 |
| 授权调整、部分/多次入账、晚到入账 | OPEN | 获取脱敏实例及产品规则；否则只展示已知事实 |
| 退款父关联、跨期/多次退款、争议结果 | OPEN | 取得可信关联与生命周期证据；否则不宣称订单结清 |
| FX、费用、非两位小数币种 | 部分 SOURCE，产品政策 OPEN | 确认金额单位、舍入、适用费用和独立入账方式 |
| 余额类型与内部客户归属 | 内部映射 OPEN | 确认资金权属、归属有效期和重复汇总边界 |
| 清算批次/文件和最终账单 | OPEN | 未确认前不承诺完成清算级对账 |
| Analytics 吞吐、行数、导出 | OPEN | 测量后选用；不可用于实时余额授权 |

上述事项负责人均待分配；渠道语义由渠道对接人确认，账务口径由业务/财务确认，接口与实现由前后端负责人评审。核实结果需追加证据，不能仅修改状态。

## 2026-09-07：独立本地只读预览

新增 [Slash 本地预览工具](../../services/api/docs/slash-local-preview.md)，实现单账户有限日期窗口的只读来源快照与本地分页查看。用户提供的只读 Key 经 IP 白名单配置后，真实 `GET /account` 已返回唯一 charge_card 账户。该证据不代表上文统一适配器、Go financial API、Webhook、客户映射或生产对账已实现。余额币种和跨页完整性仍保持未核实；具体运行记录在本地快照数据库保存。

## 当前本地真实投影（2026-09-07）

用户已授权导入本地后台并持续更新。两组各 20 张卡固定跟踪，账户最近 30 天交易有限窗口轮询；5 分钟为每轮完成后的间隔。数据、权限、更新审计及完整性边界见 [已实施说明](../frontend/slash-live-data.md)。此更新不将其余 DESIGN 草案自动视为已实现。

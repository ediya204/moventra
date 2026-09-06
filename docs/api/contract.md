# 交易与资金 API 契约草案

当前 Go 基础及生产范围见 [文档索引](../README.md)。下方金融设计、F 场景不是已实现或全部已通过的能力；引用的旧 Node/SQLite 实验仅有历史文档，服务、迁移和私有数据未纳入当前仓库。历史测试结果未在本次重跑。

更新日期：2026-09-07。状态：DESIGN；下列 financial 路由未实现。本文件不修改现有 OpenAPI，也不授权自动切换前端。

## 1. 当前契约与兼容边界

现有 [Go OpenAPI](../../services/api/docs/openapi.json) 与 [账户模型](../../services/api/docs/account-model.md) 为当前基础：Firebase Bearer、客户主体隔离、运营 MFA + staff_grants、审计、limit/offset，以及正数 amountMinor + direction。

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

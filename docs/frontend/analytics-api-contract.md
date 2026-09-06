# 分析聚合 API 契约（产品验证后选用）

当前前端没有调用下列接口，也不要求修改生产后端。现阶段使用现有只读 API 和本地 Demo API 完成验证；只有确认产品方向后，才考虑在独立分析服务实现这些只读聚合。

## 公共查询参数

- `from`、`to`：ISO 8601 时间；
- `timezone`：默认 `Asia/Hong_Kong`；
- `currency`：默认 `USD`；
- `compareFrom`、`compareTo`：可选对比区间；
- `granularity`：`hour`、`day`、`week`、`month`；
- `channel`、`accountType`、`riskLevel`：可选过滤条件。

每个响应都应包含：

```json
{
  "meta": {
    "from": "2026-01-01T00:00:00+08:00",
    "to": "2026-01-31T23:59:59+08:00",
    "timezone": "Asia/Hong_Kong",
    "currency": "USD",
    "generatedAt": "2026-02-01T00:02:00+08:00",
    "complete": true,
    "source": "analytics-read-model"
  },
  "data": {}
}
```

`complete=false` 时必须附带缺失范围或失败数据源，前端不能把部分结果展示为全量。

## 建议端点

| 端点 | 用途 | 关键结果 |
| --- | --- | --- |
| `GET /admin-api/analytics/overview` | 业务全景 | 交易金额、成功率、活跃卡率、风险与资金护栏、对比值 |
| `GET /admin-api/analytics/cards` | 卡片分析 | 状态/BIN/通道、卡龄 cohort、余额分层、活跃趋势 |
| `GET /admin-api/analytics/transactions` | 交易分析 | 通道/状态/类型交叉维度、小时热力图、P50/P95 处理耗时 |
| `GET /admin-api/analytics/accounts` | 账户组分析 | 主子账户聚合、交易/余额集中度、风险分层、重点账户排行 |
| `GET /admin-api/analytics/risk` | 风险分析 | 等级、规则、时段、账户类型、风险迁移与处理队列 |
| `GET /admin-api/analytics/funds` | 资金与渠道 | 资金流、授信敞口、渠道余额、快照新鲜度和对账批次 |

## 指标定义

- 交易成功率 = 成功交易笔数 / 已进入统计范围的交易总笔数；需明确待处理是否进入分母。
- 活跃卡率 = 活跃卡片数 / 可运营卡片总数；注销卡是否进入分母必须由服务端元数据声明。
- 平均交易金额 = 交易金额 / 交易笔数；退款、撤销是否计入必须单独配置。
- P95 处理耗时 = 从创建到最终状态的第 95 百分位时长；仍待处理交易不可伪造完成时间。
- 账户组聚合必须覆盖主账户及全部子账户，并返回 `memberCount` 和缺失成员列表。

所有端点只允许 `GET`，不得复用刷新快照、冻结、转账、审核或配置等写操作权限。

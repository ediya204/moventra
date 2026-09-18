# Slash 普通通知试接入（2026-09-18）

## 流程与边界

Slash 普通通知 → `POST /webhooks/slash` → 原始字节 RSA/SHA256 验签 → PostgreSQL 事件和投递记录同事务提交 → 204 → 异步 GET 当前对象 → 白名单来源观察。

本次只保存来源观察，不修改余额、账本、卡片、支付授权或已有前端投影；不声明历史全量同步、资金对账或客户页面闭环已完成。现有 Apexis 两个 Webhook 不变。Expense Report 和其他有效但不支持的事件保存为 ignored。

## 迁移与运行

发布基线 `cd6dd14` 已使用 001–009（009 为 online test funds）。新表位于 `010_slash_webhook.sql`；不引入另一工作区本地 `005_slash_sources.sql`，不重写既有校验和。

- `api slash-webhook-migrate`：先逐项校验 001–005、007–009；006 shadow ledger 缺省允许、存在则必须匹配，再仅应用 010，同事务及 advisory lock；重复执行验证 checksum。
- `api slash-webhook-init`：使用服务端 `SLASH_API_KEY` 执行 GET /account，必须恰好一个账户且无后续分页；绑定不可变的 `trial_20260918` 及 `/webhooks/slash`。换账户重跑拒绝。
- `api slash-webhook-status`：只输出 queued/done/ignored/review 数量，不输出密钥或金融对象。
- API 存在密钥时每 5 秒处理一件；数据库队列跨重启保留，网络请求不占数据库事务。单个连接 advisory lock 防多实例重复处理。

状态：queued 等待重试；done 已保存一次来源观察；ignored 为不支持事件；review 为冲突、账户不符、404 或 12 次尝试用尽。429/5xx 持久化退避。done 只代表采集完成，不代表资金结算。

## 入口契约

| 条件 | HTTP |
|---|---|
| 无签名、无效签名或无效事件信封 | 401 |
| 非 POST | 405（Allow: POST） |
| 请求体超过 64 KiB | 413 |
| 已验证并提交（包括重复/不支持事件） | 204 |
| 数据库失败、连接缺失/停用 | 503 |

去重键为连接 + eventId。重复投递保留次数及安全摘要，同 ID 不同信封进入 review，不覆盖原始事件。保存事件元数据与白名单标量，丢弃任意附加字段，不保存原始请求体、PAN/CVV/OTP；卡片 GET 显式 include_pan=false/include_cvv=false。GET 资源身份及账户必须匹配；缺少账户字段时依靠已验证的单账户凭据范围，不将其用于客户数据授权。

## 验收与回退

本地 `services/api/scripts/test-postgres.sh` 使用一次性本地 PostgreSQL、race detector，覆盖验签篡改、精度/脱敏、10 路重复投递、429/重启恢复、同事件冲突、未知事件、停用连接和数据库失败。测试私钥只在测试中生成，生产不能配置替代验签公钥。

线上仅发送无签名/错误签名请求验证拒绝；有效签名链路必须使用 Slash 真实投递或官方重试。不得伪造渠道签名或通过真实消费制造样本。数据库故障及重复压力测试在本地完成，不中断线上数据库。

发布前生成 Render PostgreSQL 导出并验证恢复；精确提交部署完成后执行定向迁移与初始化，入口验证后再恢复 mo test。若异常，先暂停 mo test、将 trial 连接 enabled=false，保留事件与观察，再回滚应用；不删除 010 或改迁移历史。

正式切换须先停旧通知并冻结试用连接；新账户使用新的连接和端点，不能只替换 API key。清理试用业务数据是后续独立授权操作，本次不清理。

## 官方依据（本次核验）

- https://docs.slash.com/api-reference/webhook-overview
- https://docs.slash.com/api-reference/public-rsa-key
- https://docs.slash.com/api-reference/schema-webhook-event
- https://docs.slash.com/api-reference/transaction-get-by-id
- https://docs.slash.com/api-reference/card-get-by-id
- https://docs.slash.com/api-reference/account-get

## 线上执行结果

备份：Render 2026-09-18T02:59Z 导出，461177 bytes，SHA256 `8fbe6ccf4080fe4b0c97ff3cfe962f0fe969db98b0edcb3b9034ee32c38fd324`，已在本地隔离 PostgreSQL 完整恢复（无错误）。备份确认线上版本为 1–5、7–9，006 未启用；定向迁移不得激活 shadow ledger。

部署及真实通知待执行。

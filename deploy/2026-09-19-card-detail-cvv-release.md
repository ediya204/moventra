# 卡片详情与CVV发布（2026-09-19）

用户明确授权同步GitHub main、部署和启用。独立发布工作树基于本地实现与最新origin/main合并，保留已发布卡片列表；未纳入另一任务进行中的OTC自动报价，不覆盖原共享工作区。

- 运行源码：`b300b9792733a3cedf40283f44637fc25921c4ec`，已推送GitHub main。
- Render API：`srv-daepgj8u01pc73fgdhsg`，部署`dep-dammu6kri2ms73bp483g`，2026-09-18 17:06:20 UTC已live。
- 客户端Worker：`e91072e3-af15-4217-affd-8872ae8d7036`；后台Worker：`5e4f75b4-cdbf-49a0-a5bd-ec13014ec43d`。保留远端变量。
- 仅合并设置`CARD_CVV_ENABLED=true`，沿用已配置渠道密钥。未配置卡资金认证、未修改期初、真实额度或执行转账；无数据库迁移。

本批149项前端/网关回归、两端类型和构建、隔离PostgreSQL全量race、Go vet/build、文档/diff、两端Wrangler dry-run通过。线上四份入口JS/CSS与本地发布构建逐字节一致；新部署healthz/readyz 200；源站和客户端未认证CVV均401，后台客户CVV路由404。

发布前复核[Slash当前Retrieve card文档](https://docs.slash.com/api-reference/card-get-by-id)，修正为Vault域名、include_cvv=true与include_pan=false，使用合成数据验证请求参数和响应裁剪。未读取真实CVV；开关启用不代表已完成真实登录客户的查询验收。代码未接入响应正文日志/第三方采集，环境未发现APM配置键；未以此声称已审计全部云端监控。

卡充提仍不可用：当前生产构造器是TRC20/OTC专用profile，未接入CardProvider，且CheckProduction明确拒绝Cards非空；并非只缺环境变量。已有开卡分户与crypto卡分户尚未统一，存量卡没有经过期初接管。用户已选择新开卡与存量卡一起开发，详见[代码缺口](../docs/business/funds-center.md#2026-09-19-卡片充提开发缺口核验)。

回退：先关闭CARD_CVV_ENABLED并部署已核验API旧提交e534e72；Worker按各自上一版本回退。源码和文档保留，无本批数据迁移可回滚。CVV不缓存、不落库，回退无需清理历史安全码。

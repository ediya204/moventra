# FLOW-TEST-WALLET-01 线上测试余额

日期：2026-09-18。用户明确要求为指定邮箱增加线上测试余额：20,009 USDT、100,000 USD。本批先交付测试额度配置与持久化查询；充值、兑换、提现执行界面另属后续流程，不因有测试余额而自动开放。

| 项目 | 本次范围 |
| --- | --- |
| 基线 | origin/main 5cdc929；独立工作树 codex/online-test-balances-20260918；保留原共享目录改动 |
| 入口 | `/portal`、`/portal/funds` 的线上测试钱包；最近50条额度记录和全量测试余额 |
| 身份 | Firebase 已验证且未禁用邮箱解析 UID → active/customer → 既有个人客户主体；不创建身份或重新审批 |
| 数据 | PostgreSQL 独立 `online_test_wallet_grants`，一条记录原子保存两币种、原因、目标身份、request UUID、执行方式、时间；不可更新/删除 |
| 接口链 | TestWallet → liveGet → Cloudflare 精确 GET 白名单 → Go 身份及个人所有权 → 独立测试额度表 → 读取审计 |
| 写入口 | 受控 `api grant-test-wallet`，无公共资金写 API；相同 request UUID/内容幂等，不同客户/内容拒绝；目标行事务锁避免并发重复 |
| 查询 | `GET /client-api/v1/customers/{customerID}/test-wallet`；无查询参数，no-store，mode=online_test、executionEligible=false、withdrawalEligible=false |
| 金额 | USD scale=2、USDT scale=6，全部最小单位十进制字符串；余额仅求和独立测试额度，不读真实交易或 Blnk |
| 状态 | 未配置显示未配置，读取失败显示失败和重试；成功显示测试资金，不冒充真实到账、可提现余额或卡预算 |
| 跨端 | 本批只在客户端显示，运维 CLI 查询同一测试记录；后台尚无测试钱包页面，不声称已联通 |
| 权限 | 客户仅个人所有权可读；管理员角色、企业成员关系和跨客户均不获此接口权限；每次读取审计失败则拒绝返回 |
| 迁移 | 独立增量008，`api migrate-test-wallet`检查已部署基线并仅应用008，不补跑006、不启用 shadow/live 账本 |
| 恢复 | 请求结果未知时使用原 request UUID 重试并查询；不可用新 UUID 重复加款；代码回退可保留独立表与已记记录 |

## 运维输入

`api test-wallet-plan` 要求 `TEST_WALLET_EMAIL`，仅核验身份并查询现有测试余额。

`api grant-test-wallet` 额外要求 `CONFIRM_ONLINE_TEST_ONLY=yes`、`TEST_WALLET_REQUEST_ID`、`TEST_WALLET_USD_MINOR`、`TEST_WALLET_USDT_MINOR`、`TEST_WALLET_REASON`。两笔金额均须正整数字符串；币种及精度固定，不支持真实充值回调、出款、转卡或与正式资金混合。

测试额度本身就是合成数据与执行记录，不伪造银行凭证、链上交易哈希或真实双边资金来源。该表无任何支付适配器消费者。Blnk 配置、真实 accounts/transactions、开户状态及渠道卡片投影保持原职责。

## 验收及发布

自动化覆盖：六次并发同键仅一条、同键不同内容/不同客户拒绝、禁用/管理员/不存在身份拒绝、非法金额、精确超安全整数、不可修改记录、跨客户/企业拒绝、所有HTTP写方法拒绝、审计故障拒绝、真实账户和交易计数及服务状态不变；React实际组件覆盖加载、精确显示、错误重试、客户切换丢弃旧响应。

生产执行前保存备份及校验并隔离恢复验证；先发布兼容查询/CLI，再执行008和指定测试额度操作，最后发布客户端查询区。未安装008时仅测试钱包端点返回503，不影响现有查询与就绪检查；生产旧版本回退不需要删除008。

本次最终测试、备份、部署及在线回读证据在完成后追加。真实渠道验证不适用，本批没有真实资金操作。

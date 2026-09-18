# Cregis 隔离充值、提现与 OTC

日期：2026-09-18。基线：Moventra `main`、`1ed842a` 及本任务未提交增量。本文描述隔离版，不是生产资金上线记录。用户批准真实 Cregis 只读观察，不授权真实地址创建、付款、生产迁移或部署。本文保留当时隔离批次证据；用户随后已恢复完整方案，现行增量与验收范围见[资金中心](funds-center.md)。

## 差异、方案与边界

原有 WaaS 包只有签名、回调解析和流水查询，后台金融入口未接通；Blnk 有本地 shadow 分户，没有兑换与预占订单。采用增量迁移 `013_crypto_funds.sql`、独立资金接口、共享 React/MUI 页面和持久化 Worker，保持 online_test 与 USD 报表独立。开卡任务的 014 迁移及其他未提交工作不属于本批。

隔离客户地址显示 `SIMULATED-DO-NOT-SEND-…`，不生成二维码。内部 TRON fixture 地址仅用于合成签名回调与回执验证，不作为真实收款地址。真实来源收件箱不会自动认领地址或产生客户入账。真实读取配置与金融写适配分开，WaaS 写适配器仅允许本地测试目标。

## FLOW-CREGIS-DEPOSIT / FLOW-CREGIS-WITHDRAW / FLOW-CREGIS-OTC

| 必填项 | 三条流程的实现与验收口径 |
| --- | --- |
| 目标及范围 | 充值：独立地址→合成签名回调→固化回执匹配→Blnk 入账；提现：申请→本金及费用预占→单名运营审核→模拟结果→结算/释放；OTC：报价→确认→两币种清算→可用余额 |
| 页面关系 | 客户 `/portal/crypto?tab=deposit\|withdraw\|exchange\|history`，详情 `/portal/crypto/orders/:id`；后台 `/finance/crypto-flows`、`/finance/withdrawals`、`/finance/otc` 及 `/orders/:id?customer=:customer`；费率入口在后台 OTC；来源观察 `/system/cregis?connection=:id&page=0&event=:uuid`。详情可独立查询，返回保留筛选与页码 |
| 业务身份 | UUID 内部订单、客户主体、namespace；报价归属客户；渠道连接/项目/资源种类/外部 ID 隔离。经济充值键为网络＋合约＋交易哈希＋日志序号 |
| 数据依据 | PostgreSQL 保存配置版本、报价、订单、地址生效时间、回调版本、同步断点和审计；Blnk 为本地账务余额引擎；真实 Cregis 是只读观察；未知金额不补零 |
| 接口链 | CryptoFunds → cryptoApi/cryptoContract → Cloudflare crypto 白名单 → Go crypto handlers → cryptofunds/PostgreSQL → crypto-worker → ledger/Blnk。机器契约见 [OpenAPI](../../services/api/docs/crypto.openapi.json) |
| 状态及动作 | 分离业务/审批/渠道/链上/记账。reserving→pending_review（提现）或 processing（OTC）；提现批准后 processing，拒绝/取消/确认失败 releasing→终态；未知出金保留预占并待核查；部分记账保留 processing，恢复原 reference |
| 跨端变化 | 成功操作立即重读；可见页面每 5 秒读取，隐藏暂停；两端查同一订单。请求超时保留幂等键，刷新后可重试原请求 |
| 权限 | Firebase 角色及客户归属；运营额外 MFA、customer/action grant；read/review/configure/recover 独立；来源 read/sync 独立授权。禁止提现自审；不把前端隐藏当授权 |
| 异常恢复 | 重复报价下单复用请求返回原订单，报价二次消费拒绝；配置 CAS 冲突重载；Blnk 固定子步骤 reference 恢复；来源回调落库失败返回非成功；未知金融结果不盲目重发 |
| 验收 | Go TestCryptoFundsLifecycle、cregis/tron 单测、前端 crypto-funds 与网关测试；隔离 PostgreSQL＋真实本地 Blnk；浏览器合成身份双会话检查 OTC/提现订单、金额、深链及刷新。下方记录具体边界 |
| 待定决策 | 本批无库存/人工 OTC 审批；价格两个方向独立配置；当时 5 分钟报价，现行增量为 60 秒；真实渠道读取需现有凭据可执行环境，不能用本地合成结果代替 |

## 资金规则

USDT 使用 6 位、USD 使用 2 位最小单位整数字符串；计算使用大整数和有理数，买入金额向下取整，零结果拒绝。提现费为网络固定 USDT 值：null 未配置禁止申请，显式零才免费。报价包含方向、卖出/买入金额、费用、价格、配置版本及到期；修改任何政策版本后旧报价不得受理，已受理订单不重算。

OTC 不查询平台库存，不设置清算余额门槛，不审批，也无独立手续费。卖出钱包→卖出 escrow；买入清算→买入 escrow；卖出 escrow→同币种清算；买入 escrow→买入钱包。两币种均为同币种双边分录；买入 escrow 不可花费。没有真实成本则不计算利润；清算头寸不代表法币兑付能力。

充值只接受唯一匹配日志，验证固化节点、执行 SUCCESS、网络配置、合约、收款地址、金额及日志索引；未固化、歧义、错误合约/金额或归属冲突不会入账。真实观察证据只保存核验结论，不自动成为隔离客户资产。

## 来源观察与恢复

`/webhooks/cregis/deposit` 与 `/payout` 分别验签及检查项目。去除签名/nonce/timestamp 后按来源内容去重并计投递次数；同外部 ID 内容变化保留独立版本。先事务提交再返回纯文本 `success`。历史签名重放允许落为重复投递，不产生第二次经济影响。

同步按项目数据库锁串行，游标和页内来源共同提交；每页最多 100，间隔至少 3 秒，失败保留游标并延后 30 秒，一轮结束 60 秒后从第一页重扫。来源分页可变，因此页面明确“不保证全历史完整”，不能将 partial 当作全量。TRON 可选只读核验每批 10 条；手续费/归集/未知分类不自动当作客户充值。来源详情使用独立授权查询，不能依赖列表缓存。

## 本地运行

使用独立本机 PostgreSQL 数据库 `moventra_test_*` 或 `moventra_shadow_*`、本机 Blnk、`LEDGER_MODE=shadow`、独立 `shadow_*` namespace。沿用 [Blnk 运行指南](../integrations/blnk.md) 的 BLNK_URL/API_KEY/LEDGER_ID；API 和 Worker 使用同一配置。先在该隔离数据库迁移。

```bash
go -C services/api run ./cmd/crypto-worker drain
go -C services/api run ./cmd/crypto-worker run
```

`grant` 从标准输入接受 customerId/userId/permission 或 connection/userId/permission 并写审计；只用于本地准备。`deposit-fixture` 接受 callback 与 receipt，fixture 项目 1、公开合成密钥 `moventra-synthetic-cregis`；不能传真实凭据。`resolve-fixture` 仅用于可信本地未知/失败模拟，不提供公开 HTTP 写入口。

`sync` / `run-with-readonly-source` 读取已有 `CREGIS_BASE_URL/PROJECT_ID/API_KEY`。可选 `TRON_NODE_URL/KEY`，同时要求显式 `TRON_NETWORK/USDT_CONTRACT`；没有节点不宣称链上核验通过。API 回调观察须显式 `CREGIS_SOURCE_ENABLED=true`，默认不开启。

## 本次证据与未验收范围

- 本地 Blnk：官方 v0.15.4，提交 `f3067eb` 前缀，独立数据库及 Redis，HTTP 仅监听回环。合成充值 100 USDT、双向兑换、提现、并发不足额、未知出金释放、远端成功本地审计失败后重放均已通过。未调用真实 Cregis 写接口。
- 浏览器：2026-09-18，真实 CryptoFunds/MUI/transport＋Go 测试鉴权＋真实本地 Blnk，两个独立客户/运营身份标签页。1.234567 USDT 按 0.98 得 1.20 USD，订单 `9399d75a-…` 完成；2 USDT 提现锁定 0.5 USDT 费，运营批准订单 `bef1707d-…` 后两端刷新均完成、预占归零。详情直接链接可恢复。该证据不是生产 Firebase 登录验收，也未覆盖全部生产布局。
- 自动化最终汇总另见本节后续验收结果；没有运行的场景不追认为通过。
- 真实渠道：本地进程没有 Cregis/节点凭据上下文；用户此前确认 Render 已配置不等于本批已调用。未进行真实项目查询或真实 TRON 核验，不要求重复配置白名单。
- 部署：本批未部署、未切生产账本、未推送 GitHub。迁移及 local Writer 不构成真实金融执行授权。

## 最终自动化验收

2026-09-18 本批运行：两端 typecheck/build 通过；`NODE_OPTIONS=--experimental-strip-types pnpm test` 119 项通过（当前 Node 22.16 需显式启用 TS stripping）；`go vet ./...` 通过；隔离 PostgreSQL `go test -count=1 -race ./...` 全包通过；独立真实本地 Blnk `TestCryptoFundsLifecycle` 通过。后者另外覆盖两币种部分失败恢复、取消/拒绝释放、来源深链与连接/MFA 边界、回调落库失败，以及同步限流/失败游标/重启续扫。每个测试 schema 与 namespace 隔离，未使用生产数据。

一次将所有其他模块也切到同一外部本地 Blnk 的联合重跑中，并行开卡场景出现余额断言失败（16100 对 8700）；本批未改开卡逻辑。随后全包 PostgreSQL＋各包 fixture 通过，资金专项单独使用真实 Blnk 通过。不能把该其他模块的失败记作真实 Blnk 全包通过。

本地 `cregis-readonly` 返回 `cregis_configuration_required`，没有发出真实查询；现有工具未提供 Render Shell 执行能力。真实项目能力、有限流水及 TRON 只读证据仍待有权限的服务端执行环境。无需重新提交密钥或重新设置白名单。

可复现隔离资金测试：`DEVELOPER_DIR=/Library/Developer/CommandLineTools services/api/scripts/test-crypto.sh`；提供本机 `BLNK_TEST_URL` 与 `BLNK_TEST_KEY` 后运行真实 Blnk 专项。脚本只新建/删除自身 `moventra_test_crypto_*` 数据库。浏览器辅助为 `tests/frontend/crypto-browser-preview.mjs`，仅配合 `CRYPTO_BROWSER_PREVIEW=1` 的 Go 测试鉴权使用，不进入正式构建。

历史暂停时，另一任务 live 候选曾移出构建目录，保存在工作区外 `moventra-candidates/2026-09-18-live-paused`。本批没有删除其成果，也没有启用其 015 迁移、live 构造器或新金融路径。开卡并行任务的 014 与页面改动仍保留。

后续状态：用户已明确恢复完整实现，015 与 live 路径重新作为本地候选加入；上述历史暂停记录不表示当前仍暂停。正式金融能力尚未激活，详见[当前流程卡](funds-center.md)。

# TRC20 限额充值自动入账发布与验收

2026-09-18 23:05 香港时间。FLOW-FUNDS-DEPOSIT-PILOT；正式仓库ediya204/moventra main，隔离候选工作区`/tmp/moventra-trc20-deposit-pilot`，原工作区其他修改保留。用户授权部署/激活及累计最多1 USDT真实充值验收；本次没有代用户转账。

## 发布

- API最终源码`256df2526bd63cfa0a57bc3a2aa4cb8cfe28351b`，Render `dep-daml4uu7bikc73c2n400` live。保留同期人工资金代码，未应用016或修改其权限/执行配置。
- 初始prepare发布`182fca987dc432fabefeb82bfc8ea4ef1c7ac859`，`dep-daml25u1egvs73clp77g`；启用版本`a8a484ccfe7d0bc4b62b2c6b28c6412dab8c8fc6`，`dep-daml3mgu01pc73am2nsg`。最终增量为乱序通知不回退已入账展示，处理资金逻辑相同。
- 客户端源码与182fca9相同，Cloudflare Worker `7ece8cc5-222b-42f7-a9a1-773c8ecdd1b1`，`ClientHome-Cg5W9rnC.js`、`index-9OQQwn0s.js`、`index-CiF_OZmg.css`线上字节匹配。本批不重发无改动后台。
- 地址观察服务继续运行，`DEPOSIT_PILOT_MODE=enabled`；限定客户`9970544c-6651-4b36-9231-07513b40d070`（本次用户核验账户）、TRC20地址`TDdj4A2MYA5Q3tsL54TUuUBHqToN6cxru3`、累计`1000000`最小单位，显式充值费0。Blnk私网TLS及CA复用既有连接；无密钥进入前端/文档。
- 不设置全量`LEDGER_MODE`、`FUNDS_LIVE_ACTIVATION`或`CREGIS_SOURCE_ENABLED`；ERC20、OTC、提款、卡片充提不由本批启用。无需新迁移，复用已装006/013/015。

## 零期初与真实到账

准备任务`job-daml3bu1egvs73cltfcg`成功：检查客户/绑定地址、TRON最终确认节点、Blnk认证，正式钱包/对手账户均零创建，无原资金订单和账本操作，写入不可变zero-opening授权指纹。最初任务使用不存在的可执行路径未执行，改正为`api prepare-deposit-pilot`后成功；未重置或补造余额。

自动任务首次健康记录2026-09-18 15:01:27 UTC，最终版本重启后15:04:08 UTC再次健康；仅处理持久化真实Cregis通知，未注入合成生产事件。

| 证据 | 结果 |
| --- | --- |
| TRON交易 | `92e8a45f898cf5e4af1bb14f6650987a7c2c4a5f43339e0ee0b4dd690b475465` |
| 链上 | solidified区块86356920，SUCCESS，USDT合约、目标地址、唯一Transfer index 0及金额100000最小单位匹配 |
| 金额 | 0.100000 USDT，充值费0，钱包入账0.100000 USDT；本次剩余额度0.900000 USDT |
| 渠道记录 | 1条真实通知，状态verified，deliveries=1 |
| 内部订单 | `7427bb54-2b67-4d47-a528-347e87c00763`，completed / finalized / posted，15:01:27 UTC完成 |
| Blnk | `txn_c3697c79-2838-48af-8577-32a5b4652c0b`，APPLIED，precise_amount=100000，precision=1000000 |
| 会计引用 | `mv_313602bb9e758ee74de86ba95b57ff5886dfe6d8c1a70191726f2edf3a0da546` |
| 余额回读 | 钱包+100000、对手账-100000、双方在途0；本地journal与Blnk一致 |
| 重启后 | 1单、1笔入账，无重复记账 |

只读核验任务`job-daml5l8u01pc73am9kjg`读取来源/订单/journal；`job-daml63gu01pc73amb3eg`重新读取Blnk双方余额、原交易和TRONsolidified收据，且订单仍为1。前一统计查询使用不存在的journal.namespace失败，修正为关联ledger_operations后执行，均为只读任务。

## 验证边界

- 本地：Go全包隔离PostgreSQL race通过；最终乱序展示变更后api/depositaddress包race再次通过；go vet通过。129项前端/网关测试、两端typecheck和build通过。
- 本地资金用例：0.6+0.6并发超限、再0.4达到1、同经济交易不同渠道ID去重、未知响应恢复、错误链/代币/地址、未最终确认、跨客户状态隔离；迟到初始状态不能遮蔽posted，旧详情仍恢复posted。
- 线上：healthz/readyz及客户端页面200；未登录客户地址接口401；无签名回调400。3份客户静态产物与本地一致。
- 真实渠道：本次0.1 USDT的Cregis通知→TRON最终确认→Blnk→内部账本闭环通过。真实重复回调/通道断网场景未人为触发，以隔离自动化覆盖；不是两条链或全量资金认证。
- 浏览器：本轮未登录真实客户会话，未重新完成真实剪贴板、二维码扫码和移动端人工验收；不能以HTTP200或组件测试替代。

关闭：清空DEPOSIT_PILOT_MODE并重新部署，地址回调仍持久化，真实订单和余额保留；不得清零或删除已入账记录。恢复相同配置复用授权审计、同一订单和Blnk引用。不得仅凭此次小额成功放开其他客户、超额金额或其他金融能力。

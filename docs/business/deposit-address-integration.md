# 客户充值地址标准接入

2026-09-18，FLOW-FUNDS-ADDRESS。范围为地址持久绑定、首次进入申请、已有地址导入、回调接收和客户通知查询；本批不激活资金账本或自动入账。

## 流程与接口

开户approved且服务active的个人客户进入USDT充值页 → GET本人`/client-api/v1/customers/{customerID}/deposit-addresses` → 无地址时POST同路径（network=TRC20、UUID Idempotency-Key）→ 服务端持久记录客户/网络唯一任务后调用Cregis → 验证项目归属 → 绑定crypto_addresses → 页面展示二维码及复制。刷新复用，切换ERC20立即清空旧二维码。项目实际查询未返回chain1，ERC20暂不申请。

自然幂等键为namespace/customer/network，渠道调用前提交submitting；并发或重复请求只查询原任务。断连、渠道响应丢失、服务崩溃后不得盲目再次创建；返回地址先保存verifying，再核验与绑定。未知任务需按Cregis归属证据恢复，当前没有按alias自动找回接口。

GET默认返回最近5条本人地址充值通知；page按5条分页，event为可刷新详情ID。授权从登录身份与personal_owner_id关联，不接受前端声明的客户归属。未开户、停用与跨客户访问拒绝。这里记录渠道通知，不能显示为已完成入账或可用余额。

独立回调`POST /webhooks/cregis/address-deposit`校验项目和签名、限定TRC20 USDT，删除签名/nonce/timestamp后按事件ID与语义摘要去重并持久化，成功提交后才返回success。乱序通知保留原始事实；无账本调用，无提款接口。来源表与正式资金流程共用，未来须完成链上最终性及记账验收后再处理这些证据。

## 配置与迁移

`DEPOSIT_ADDRESS_MODE=observation`、独立`DEPOSIT_ADDRESS_NAMESPACE=live_moventra_funds`和`DEPOSIT_CALLBACK_URL=https://moventra-api-ejeq.onrender.com/webhooks/cregis/address-deposit`；复用服务端Cregis项目凭据。地址专用客户端不暴露出金方法，不借用资金执行验收开关。

显式命令`CONFIRM_DEPOSIT_SCHEMA=yes api migrate-deposit-addresses`仅核对基础迁移并补006/013/015，单事务与迁移锁，校验既有字节，零期初、不创建Blnk余额、不迁入测试资金。API readiness在此功能启用时要求这些迁移完整。

可信运维命令`api import-deposit-address`从stdin读取customerId/address/evidence。导入前必须核实真实创建回执中的客户alias及项目，不可仅凭地址属于项目就指派给客户；命令再次查询项目归属、校验已开户状态、拒绝已有地址冲突，更新同一地址的回调，再绑定。命令没有公开HTTP入口。已为本次用户创建的TRC20地址应按原回执复用，不重新创建。

## 验证与发布边界

本地隔离PostgreSQL测试覆盖并发仅一次创建、未知结果不重试、重复导入及改绑拒绝、跨客户通知隔离、重复回调去重、错误签名拒绝和账本流水不变。组件测试覆盖首次进入、已绑定/未知状态不重建、错链二维码清除；此前OTC等测试继续运行。124项前端/网关、Go全包race/vet及两端类型检查/构建通过。API与客户端已发布45a0d67，原地址已导入、回调已配置，见[本次发布证据](../../deploy/2026-09-18-funds-center-release.md)。

未完成：真实充值、链上最终性、自动入账、真实浏览器剪贴板及链上转账验收。页面明确显示此状态；不得用合成回调制造真实交易记录。

依据：[Cregis创建地址](https://developers.cregis.com/en/reference/waas-api/createAddress/)、[更新回调](https://developers.cregis.com/en/reference/waas-api/updateAddress/)。

## TRC20 限额入账验收（2026-09-18，候选）

FLOW-FUNDS-DEPOSIT-PILOT 衔接前述地址观察流程。用户已明确本次真实充值上限 **1 USDT**，实际转入由用户完成；完整资金启用认证仍未完成，不设置全量 FUNDS_LIVE_ACTIVATION。

| 项目 | 本批范围 |
| --- | --- |
| 目标及范围 | 已开户指定客户、已绑定TRC20地址，渠道通知到链上最终确认、Blnk记账和客户详情恢复；累计不超过1000000最小单位 |
| 基线 | 标准地址45a0d67，合并余额查询60d3295；独立候选分支，不覆盖原工作区 |
| 页面关系 | `/portal/funds/deposit` → `?event=<id>` → 返回充值；沿用5秒轮询，切换网络清空地址及状态 |
| 业务身份 | namespace/customer/connection/project/address；经济幂等键为network/token/txHash/transferIndex，沿用crypto_postings和ledger引用 |
| 数据依据 | Cregis验签通知持久化；TRON solidity节点核验成功收据、USDT合约、收款地址、金额及唯一Transfer；Blnk与本地journal核对后显示钱包余额 |
| 接口链 | 既有cryptoRequest → 同域白名单 → deposit-addresses handler →本人授权→地址、通知关联订单、限定账本状态；不新增浏览器执行接口 |
| 状态及操作 | received→verified→processing→posted；无最终性不入账，累计超限保留错误及通知；账本响应未知按同一引用恢复，额度包括待记账订单，不重复扣额度 |
| 跨端变化 | 客户最近记录及详情显示链确认/记账结果，当前钱包余额只在本地journal与Blnk一致时显示；后台余额查询使用既有权限，不开放人工批准此自动充值 |
| 权限 | 固定客户与固定地址，开启开户资格检查；无Cregis出金writer，无卡接口，ERC20/OTC/提款不因验收开启；换客户ID继续拒绝 |
| 验收 | 隔离PostgreSQL并发、多CID同交易、0.6+0.6超限、0.6+0.4达上限、错误网络/代币/地址/未最终确认、Blnk响应丢失恢复；真实到账待用户转入 |
| 待定决策 | 无需提高限额；全量正式资金和其他能力保持各自验收门槛 |

配置：`DEPOSIT_PILOT_MODE=prepare|enabled`，`DEPOSIT_PILOT_CUSTOMER/ADDRESS/CAP_MINOR/EVIDENCE`固定授权范围；上限代码强制≤1000000。`DEPOSIT_PILOT_DEPOSIT_FEE_MINOR=0`必须显式配置，本批免费；其他费用不推定为零。`DEPOSIT_PILOT_TRON_URL=https://api.trongrid.io`限定TRON主网，`TRON_NODE_KEY`可选。`DEPOSIT_PILOT_BLNK_URL/KEY/CA_PEM`使用服务端私网TLS连接，保留证书校验，不迁移测试额度。

先在prepare模式执行`api prepare-deposit-pilot`：核验已绑定地址、客户资格、主网最终确认节点和Blnk身份；创建钱包/对手账户，未绑定的正式账户必须零余额；核对无历史订单和账本操作后记录不可变授权指纹。enabled只接受匹配的零期初审计记录。API进程内限定任务每15秒处理，仅处理授权地址的TRC20通知和指定客户deposit订单；正常HTTP关闭时停止任务。关闭方式为清空DEPOSIT_PILOT_MODE并重新部署，通知继续持久化。未完成订单及占用额度保留，重启复用，不清余额。

GET新增mode=deposit_pilot、postingEnabled和pilot（capMinor、remainingMinor、walletMinor、reconciliation）。超过额度、账本不一致或任务健康检查过期时postingEnabled=false，页面提示勿继续转入；额度是允许自动入账的上限，无法阻止第三方向链地址转入。其他客户仍为observation。事件新增state、posting、error、orderId；只有posting=posted显示已入账。

节点依据：[TRON最终确认接口](https://developers.tron.network/reference/gettransactioninfobyid-1)、[交易所/钱包接入](https://developers.tron.network/docs/exchangewallet-integrate-with-the-tron-network)。部署及真实到账证据单独记录，不能用隔离测试替代。

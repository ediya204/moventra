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

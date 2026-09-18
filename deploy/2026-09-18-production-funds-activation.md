# 正式充值与 OTC 分能力接入（2026-09-18）

## 业务决定与实现

用户要求正式资金服务可用，确认两个OTC方向均0.99、提款及卡片充提费用0且可在后台调整，取消原1 USDT验收上限。原live命名空间、Cregis地址及正式入账历史复用，不删除测试数据、不复制测试余额、不重置正式账户。

源码859dda31e6e47dcc3eedf8319cb862f1ab710036包含正式运行模式和旧查询入口修复，并保留同期main卡片控制改动。API启动独立正式worker，处理TRC20最终性入账和OTC双资产记账；无出金和卡片writer。原受限未入账通知可重新核验，始终复用经济事件幂等。客户端按业务能力提示，正式地址页不再展示试点剩余额度。

正式余额查询、旧ledger快照、crypto来源查询复用live读服务。人工资金仍ReadOnly；查询不会启用人工资金执行。

## 本次自动化

合并后136项前端/网关测试、两端类型检查和构建、Go隔离PostgreSQL race与vet通过。覆盖2 USDT超过原限额、受限积压恢复、重复通知、0.99双向兑换、同键同订单、后台变价不被初始化覆盖、余额不足与权限边界。未用自动化fixture冒充真实渠道验收。

## 生产准备证据

任务job-damlk8dbedkc73c7s51g成功：显式仅安装016，并通过configure-production-funds一次写入政策与审计。无余额/授权种子，无新增资金订单。后台调整运营账号等待用户提供，未自动向全部管理员授予权限。

任务job-damlkvajnfac73b53m0g真实只读回查：Blnk钱包100000（6位精度，即0.100000 USDT），clearing -100000，在途0；原Blnk交易APPLIED、订单仍仅1笔posted；配置revision1，两向0.99，网络与卡片费用0，OTC enabled、withdraw disabled；funds_cards为0。016已安装；同期卡片任务安装018，本批未执行018。Cregis只读项目历史调用成功，本次未新增真实转账或兑换。

## 部署与启用

客户端Cloudflare版本ebb0dc46-bb60-4d03-9156-89f2b583e875；后台c996a686-57a4-4e2a-8ce5-0645e78e1325。API最终激活部署dep-damlle1q582s738pu8v0，源码859dda31e6e47dcc3eedf8319cb862f1ab710036，于15:38:41 UTC live；同实例15:38:35明确记录production funds healthy（TRC20、OTC true；payout/cards false）。两端入口JS/CSS与本地发布产物SHA256一致；healthz/readyz 200，未认证正式客户/后台接口401，旧测试钱包404。

服务配置FUNDS_DISPLAY_MODE=production、FUNDS_PRODUCTION_MODE=enabled、显式充值费0及原已入账订单证据；删除DEPOSIT_PILOT_MODE。原Blnk TLS和Cregis密钥保持服务端，不改变其他渠道配置。

## 验证边界及回退

未执行登录后真实用户浏览器验收、真实OTC订单或出金、卡片充提；此前真实0.1 USDT充值仅作为已接通正式链路证据。ERC20供应商支持、出金最终性/失败恢复验收，以及存量卡资金归属/余额/占用/消费退款仍需完成，费用配置不能替代这些要求。

回退仅暂停FUNDS_PRODUCTION_MODE或回退兼容应用版本；保留正式数据、订单和幂等标识，不自动恢复旧1 USDT处理器（额度放开后旧处理器不再适合处理新增订单）。暂停期间通知继续保存，恢复后按原事件核验。

激活后复验任务job-damlnsp42hec739jt9bg再次确认：正式钱包0.100000 USDT、原订单仍1笔posted、Blnk仍APPLIED，政策revision1与零费用保持一致；无重复入账。

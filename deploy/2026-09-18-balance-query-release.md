# 余额查询与人工资金代码发布

2026-09-18，用户明确要求同步本地代码到GitHub main并部署。发布候选基于最新远端main `1be3cf2`，合入余额查询、人工订单、审核/预占/恢复、客户端记录与同域网关；保留已上线开卡、充值地址观察及已应用迁移字节。原工作区的其他文档草稿不覆盖最新发布说明。

## 发布前验证

本次候选128项前端/网关回归、两端typecheck/build、随机本机PostgreSQL全包race、Go vet/build及文档检查通过。首次前端测试缺少Node22兼容参数，按项目说明加入`NODE_OPTIONS=--experimental-strip-types`后通过。真实Firebase、真实Blnk及开卡专用浏览器测试未配置而跳过。Wrangler两端dry-run检查，不改变云端变量。

## 环境边界

本次发布API与两端应用代码；不执行016生产迁移，不新增资金权限，不开启人工或其他金融执行Worker，不执行指定客户10,000 USD入账。API启动不自动迁移，未安装016或未授权时该功能不会开放。真实启用需要另行完成迁移、权限、账本及资金验收，不能以页面上线代替真实余额配置。

回退基线：API源码45a0d67，Render `dep-damkpqf40ujc73baq260`。后台Worker上一版本b45ecf7b-e6a6-42cd-ba73-ffa78bd05dd2，客户端016f4fcf-b51d-41d7-9c5c-287a248651ec。回退应用不删除订单、审计、地址或资金数据。

## 上线结果

源码60d32956bfe6c0f369e0f1d3cc34cbb79fc4aecf已推送GitHub main，原工作目录main同步到该版本，其他未提交文档草稿保留。

- Render API：dep-damkv6qd0e5s73frik0g，于14:52:04 UTC（22:52香港时间）live，运行提交匹配。
- 后台moventra-admin：bd125fd3-c5e0-4f48-a117-119751829b75。
- 客户端moventra-web：b77e20ce-9e68-4a1f-9053-6527aa12f9a2。
- 20项上线后HTTP检查通过，包括healthz/readyz 200、两端深链200、未登录401及跨端404。6份入口/余额页/客户端静态JS与CSS逐字节匹配本地构建。
- 浏览器打开余额查询与客户人工记录分别回到本端登录页，无控制台错误；未获取本人登录会话，未验证认证后的业务操作。
- 上线后错误日志查询为空；构建前存在旧crypto-scopes未启用503，不归为本次余额模块运行错误。
- 只读核实LEDGER_MODE、MANUAL_FUNDS_ENABLED、FUNDS_LIVE_ACTIVATION、CREGIS_SOURCE_ENABLED均未配置；ISSUING_MODE=prepare和DEPOSIT_ADDRESS_MODE=observation保持现状。没有修改执行开关、权限或数据库。

结构化[发布证据](../docs/testing/balance-query-release-2026-09-18.json)，完整业务范围见[人工资金流程](../docs/business/platform-advance.md)。

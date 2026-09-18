# 资金中心四流程发布

2026-09-18，用户明确授权“部署”。独立候选 `/tmp/moventra-funds-release-20260918` 从已发布开卡代码及后续 main 构建，保留开卡页面、014 原始字节及后续连接准备。

本批发布客户四流程、运营订单/费用/来源页、同域网关、Go 接口、双链与正式资金接入准备。镜像增加 crypto-worker 二进制，不启动正式资金 Worker。本批不执行生产 013/015 迁移，不激活正式账本，不发真实渠道金融请求。

正式环境只读检查：LEDGER_MODE、CREGIS_SOURCE_ENABLED、FUNDS_LIVE_ACTIVATION 未配置。未修改这些开关。未启用时客户端展示四入口及明确提示，金额标为尚未启用，不伪造零余额或空业务成功。

## 发布前验证

- 前端及网关 123 项通过（包含未启用部署回归）；两端 typecheck/build 通过。
- 随机本机 PostgreSQL 的 Go 全包 race、vet、命令构建通过；真实 Firebase/Blnk 与交互式开卡浏览器测试按显式开关跳过。
- 两端 Wrangler dry-run、文档和差异检查通过。现有大 chunk 提示保留。
- 不覆写工作区无关改动；候选明确保留生产已应用迁移的原始字节。

## 上线与核验

代码 `9079821554ae6927bad61891e4c220a397c20c7e` 已推送 main。Render `dep-damh0s142hec7392usug` 于 10:22:19 UTC（18:22 香港时间）变为 live，运行提交匹配。

- 客户端 `moventra-web`：`3fa13ebf-6869-4032-b5df-0693a02a704c`。
- 后台 `moventra-admin`：`b45ecf7b-e6a6-42cd-ba73-ffa78bd05dd2`。
- 29 项 HTTP 检查通过：API healthz/readyz 200；新资金路由未登录 401；跨端路由 404；四页与详情深链 200。`/login` 正确 302 到两端各自登录路径，目标页面 200。
- 8 份线上 JS/CSS 与本地构建逐字节一致；Python 默认 HTTP 客户端首次被返回 403，使用 curl 正常核验，不代表服务未发布。
- 浏览器进入资金中心和运营资金页均跳转本端登录，没有控制台错误；没有本人业务会话，登录后的正式业务验收未执行。
- 发布后资金激活相关环境变量仍未配置，未更新任何金融执行开关；本轮日志查询未发现 error。
- 结构化证据见[发布检查](../docs/testing/funds-center-release-2026-09-18.json)。正式金融能力仍需[四流程验收](../docs/business/funds-center.md)中的真实渠道、恢复及对账证据，不以代码发布代替。

回退基线：Render 已发布 92cad848384799c7c666e3e4879227b0c049566f；客户端 b35d97a0-d1f4-4d19-84c1-979dda71fd38、后台 1c3e82a5-bed0-49ed-b44e-f2afecf782b0。若并行批次先完成新发布，以触发本批前核对的版本为准。无本批数据库变更需要回滚。

## 充值地址标准化接入发布（2026-09-18 22:39 香港时间）

用户要求“标准化接入”。代码45a0d67已推送main；地址功能与正式账本执行分开，API先发布，再显式迁移并导入原地址，最后启用地址观察模式。未创建第二个地址。

- API首阶段dep-damko7qd0e5s73fqorr0；最终配置发布dep-damkpqf40ujc73baq260，14:39:18 UTC live，源码45a0d67。
- 客户端Worker版本016f4fcf-b51d-41d7-9c5c-287a248651ec；保留现有变量和绑定。本批后台页面没有变更，不重复发布后台。
- 迁移前Render恢复状态AVAILABLE。作业job-damkpbek1f9s739e6pqg成功执行选择性006/013/015迁移，校验已有字节、单事务；未更改其他迁移、未激活账本。
- job-damkph5bedkc73c4qf10按原创建回执核实客户归属，验证地址属于Cregis项目，更新同一个地址的回调并持久绑定；14:38:03 UTC报告address_import_and_callback_configured。此前只有本机回执的状态已结束，应用地址表与任务表均已绑定completed。
- 只读核验job-damkq0lbedkc73c4s9q0确认该客户TRC20地址与原回执一致；ledger_accounts、ledger_journal、crypto_orders、crypto_events均为0。没有渠道转账或账务交易。
- API启用DEPOSIT_ADDRESS_MODE=observation、namespace live_moventra_funds及独立HTTPS回调；LEDGER_MODE、FUNDS_LIVE_ACTIVATION、CREGIS_SOURCE_ENABLED仍未配置。Cregis凭据未复制到前端。

本次自动化：124项前端/网关测试通过，两端typecheck/build通过，隔离PostgreSQL全包Go race与vet通过。新测试验证12并发请求只创建一次、未知结果不重试、导入冲突/跨客户隔离、重复通知去重和不记账。组件验证首次申请、刷新复用及切链清除二维码。没有将fixture回调写入生产。

线上核验：healthz/readyz均200；充值页面200；地址GET/POST未登录均401；后台访问客户端接口404；无签名回调返回400；客户端JS/CSS与构建逐字节一致。真实浏览器进入充值页跳转登录，未获得本人登录会话，因此没有声称已完成登录后二维码/剪贴板或真实充值验收。

正式自动入账仍未启用，页面明确提示暂勿转入资金；ERC20项目能力未核实，不展示错链地址。完整接口、导入恢复与边界见[地址标准接入](../docs/business/deposit-address-integration.md)。

回退：停用DEPOSIT_ADDRESS_MODE并部署；必要时客户端回退3fa13ebf-6869-4032-b5df-0693a02a704c。保留新增表、已绑定地址及回调证据，不删除表、不重建地址。恢复时使用同一namespace与原地址。

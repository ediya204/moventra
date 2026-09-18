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

## 激活请求核对（2026-09-18 18:32 香港时间，尚未激活）

用户随后要求“激活”。本轮完成实际环境只读核对，没有应用迁移、修改执行开关、创建充值地址或发起资金交易。

- API环境中Cregis三项凭据存在；正式资金的LEDGER_MODE、FUNDS_LIVE_ACTIVATION、BLNK连接、FUNDS链节点与验收文件配置不存在。ISSUING_MODE=prepare与其专用CA/连接存在，这是开卡只读配置，不是资金中心配置。
- Cregis真实只读任务`job-damh4r67bikc73bkom0g`成功，10:29:09 UTC返回地址资产16、出金资产142、项目交易总数2037、本页20。只打印计数，不输出地址、交易内容或密钥；此结果不证明双链入账、出金或恢复验收通过。
- 生产数据库只读任务`job-damh63142hec7393ie3g`于10:31:47 UTC核实迁移版本为1–5、7–12、14；正式资金依赖的006、013、015尚未应用。会话强制default_transaction_read_only，查询仅返回版本和校验值。
- 数据库外部连接首次失败；转为同服务一次性只读作业后，依次修正命令解析、Alpine客户端路径和连接串传递，再成功读取。失败尝试没有执行迁移或金融写操作。
- 开卡任务已完成Blnk私有CA连接准备。资金中心仍使用普通Blnk构造器，需补齐其专用CA接入、独立namespace/账户配置；不能直接把开卡prepare配置视为资金正式启用。

后续具体范围：核对备份及已部署迁移校验后只补006/013/015，正式账户零期初；接入资金账本专用CA、配置两个链节点及经Cregis资产查询确认的网络映射；部署资金处理服务；在明确的小额验收范围内完成实际入账、出金、恢复、对账以及卡占用/消费退款验证，再按证据开放对应能力。未获得证据时不填写验收标志为真。

已向用户询问首次真实验收金额上限、双链提款费用、卡充提费用及OTC双向成交价。缺少这些值不能假定免费或沿用测试值。当前尚无本轮真实资金金额授权；完整激活未完成。费用与价格也无法从未安装的正式资金配置表中读取。

## 单客户TRC20地址测试（2026-09-18 18:40 香港时间）

用户要求为指定测试客户创建USDT地址。线上只读作业`job-damh91lbedkc73bojs20`通过Firebase邮箱核验客户身份，并核实开户approved、服务active。本机Cregis请求实际返回IP未入白名单；改用既有线上环境成功，不修改白名单。

线上资产查询`job-damh9i3m8hqs73d59c7g`确认TRC20 USDT（chain195，token TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t，6位精度）支持地址创建。当前项目返回的chain1筛选结果为空；不能假定ERC20已开通。

单次创建作业`job-damh9ue7bikc73blb5tg`于10:40:04 UTC成功生成一个TRC20地址，使用客户UUID衍生的稳定alias；随后/api/v1/address/inner验证属于该Cregis项目，本地Base58Check通过。发起前保存排他创建记录，结果未知不自动重试；成功回执保存于本机受限目录`.config/moventra/funds-address-tests`，没有密钥进入文档。

这是渠道地址测试，不是资金中心已激活：未配置该地址回调，未写入尚未安装的应用地址表，页面不会展示此地址；没有转入资金、出金或入账。启用应用时必须受控导入并复用该地址、配置回调，不能为该客户再次盲目生成。正式双链、迁移、费用和真实资金验收仍未完成。

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

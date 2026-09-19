# 2026-09-19 单张开卡试运行交付与发布

## 授权和范围

用户明确授权实现、测试和部署指定客户、BIN 43612080、一张卡、首充20 USD、费用最多10 USD、总扣款最多30 USD。用户自行在正式客户端提交；订单无需后台审批，系统自动处理，后台保留订单、声明及审计。本记录不保存邮箱、密钥或PAN/CVV。

完整流程见[开卡专题](../docs/business/client-card-issuing.md#flow-issuing-pilot-001单张真实试运行2026-09-19)。独立pilot不能替代完整live认证，不伪造渠道验收文件。无新增数据库迁移。

## 实施和验证

基线main `aa1b894`；只包含本批试运行范围、CLI、前后端类型/展示、隔离测试及文档。资金上限同时在报价、提交、Worker复核，固定订单、客户范围和不可变授权消除重复名额；失败仍占名额，到期后保留原单恢复。客户资格及供应商开启是一次性配置，不增加逐单审批状态。

本轮210项前端回归、两端typecheck/build、隔离PostgreSQL Go race、Go vet/build通过。浏览器使用真实Go HTTP、隔离库、进程内Tick和有状态Blnk/Slash模拟：20+10=30、两声明、成功、刷新同单、第二单拒绝、后台同单及1000→970余额通过。手动浏览器核验完成后，夹具未及时关闭触发Go默认10分钟超时，因此该长驻harness进程退出码非零，不计为自动化全绿；页面行为记录与独立全套Go race结果分开。隔离库及本批预览服务已清理。独立真实Blnk、真实Firebase和真实Slash生命周期未在本轮验收；源码重启恢复用Go专项覆盖，不能称该浏览器轮使用独立Worker进程。

实体绑定补充后再次执行全套隔离PostgreSQL Go race、Go vet/build，全部通过；日志保留本机`/tmp/moventra-pilot-go-release.log`。源码提交及部署结果见后续记录。

## 生产前置证据

只读任务`job-dan14kugekts73faan70`：身份精确匹配且approved/active、项目存在；产品active、费用1000/首充2000美分；无客户或分组特殊价，订单0；统一USD余额100009、在途扣款0。此前API/Worker均prepare/funds_wallet，供应商paused、客户资格未开，供应商entity为空。使用现有Render连接继续核验真实主体/账户/产品及项目，不复用历史MCP失败作为阻塞。

主体核验任务`job-dan17a942hec73cqu9tg`成功：唯一法律主体与账户GET匹配，来源产品prefix=43612080且active，项目虚拟账户属于同一账户；仅GET。Python默认请求头曾遇到非JSON 403，使用应用实际Go请求头后成功，未调整白名单或密钥权限。参考[主体接口](https://docs.slash.com/api-reference/legal-entity-get)和[创建卡契约](https://docs.slash.com/api-reference/card-post)。

## 部署结果

源码`04d874fbcce0c73f52f1c9e4106a8f0992aeea64`已推送GitHub main。两端Render已部署同一版本：

| 组件 | 本轮版本 / 验证 |
| --- | --- |
| API | `dep-dan185mk1f9s73f2edlg`，live；healthz/readyz均200 |
| issuing-worker | `dep-dan186rm8hqs739lu70g`，live；新实例队列pending0/requiresVerification0 |
| Cloudflare客户端 | `046ffbec-99b5-4b2b-a223-c03f9bf58536` |
| Cloudflare后台 | `5ae8becf-b31c-4daf-89b9-74d205da5152` |

客户端`index-CSsaCNwD.js`和后台`index-D3isDuyS.js`线上内容与本地构建逐字节一致；普通curl访问正式客户端200、后台旧login重定向admin/login。Python探测收到HTTP错误后改用curl核验；没有将未认证HTML/静态文件可达等同客户业务验收。

两服务逐项新增`ISSUING_PILOT_CONFIG`、`ISSUING_SLASH_KEY_PILOT`并将模式改为pilot，读取比对其余环境变量完全不变。命名密钥复用既有服务端凭据，未修改渠道密钥权限；完整live验收文件仍未配置。原环境只保存在本机私有备份，不入仓库。授权配置固定申请截止`2026-09-20T04:48:05Z`（香港时间9月20日12:48:05）；接受后的同单恢复不受该期限中断。

资格配置任务`job-dan1983m8hqs739m22u0`已成功：受信CLI事务补齐已核对entity、激活供应商、开启指定客户资格并写入不可变授权。前后`pilot-status`显示目标BIN的blockedReason由supplier_paused变为空，其他7个BIN均pilot_scope_required；客户订单仍0、余额仍100009美分。新前端先上线而资格未配置期间，用户截图仍显示“暂未开放”，该原因已消除；需刷新已有页面重新查询。

本批已开放指定单卡申请，完整live仍未认证。本人认证浏览器和真实渠道写流程仍待用户自行提交验收；代理没有提交真实订单、扣款或发卡。以上零订单/余额是配置任务完成时点的证据，不覆盖用户随后自行操作。申请入口为`https://www.moventra.me/portal/cards/new`，BIN 43612080。

## 回退与交接

暂停新申请可禁用该客户开卡资格或暂停指定供应商，保留授权/订单/账本。若切回prepare需API与Worker一致，会停止金融恢复，应先核对在途订单并安排原单恢复；不能删除授权审计、换订单ID重置额度、改namespace或删除预占。回退前端不代替服务端关闭；保留查询与核查记录。若已提交，先核对原订单/来源卡/账本状态，禁止重复开卡重试。

待办：本人在正式客户端提交唯一订单，核对真实零限额创建、首充启用、费用及余额；未知/失败按原单核查。完整live的渠道恢复/退款/对账验收另行完成，本批不开放其他客户/BIN或通用卡资金操作。

## 本人真实提交后的失败核查（2026-09-19 12:52 HKT）

用户自行提交固定订单`53bd5237-ccec-4662-82c8-4a18339c86f7`。04:52:05Z创建、06Z预占、09Z发卡、10Z退预占、12Z结束为failed/creation_failed；原始过程审计为creation_rejected，供应商保护记录为provider_access_denied。按本版适配器，只在401或403产生该拒绝；没有保存原HTTP状态、上游name/identifier或响应正文，无法追溯区分密钥权限、具体接口授权、IP或其他渠道策略。不能把只读成功当作写权限验证，也不能直接归因为历史白名单问题。

只读任务`job-dan1ahugekts73faujkg`确认：该单reserve3000和release3000均applied，journal分别wallet-USD→issuing-hold及反向各3000美分；没有开卡费/首充分录，订单external_card_id为空。该单净扣款0、预占全退。当前钱包GET为90009美分、inflight debit0，这是新的账户时点余额，不能用此前100009直接差额认定本单扣款；本单影响已逐笔核对。

系统自动阻止该供应商后续调用，唯一名额保持已使用。未删除订单/审计、重置额度、恢复渠道或再次POST发卡。接下来需以12:52:09 HKT对应渠道请求核验原始拒绝原因，并补充安全的错误类别/请求标识可观测性；不能以重新真实发卡获取错误日志。此前“待本人提交”仅为配置完成时点，本节覆盖当前真实验收状态。

补充只读任务`job-dan1b03m8hqs739m7qvg`按原订单account/virtualAccount范围完整分页查询渠道卡，未找到userData.moventraOrderId匹配记录。先前不带范围的10页读取未完成，不据其下结论；范围过滤依据[官方卡列表](https://docs.slash.com/api-reference/card-get)，未调用金融写接口。

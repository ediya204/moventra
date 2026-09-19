# 生产消息与统一钱包迁移、开关调整 — 2026-09-19

## 目标、授权与基线

用户明确要求“执行生产迁移 调整开关”，承接已授权的 main 同步与部署。工作目录 `/Users/edi/Documents/ChatGPT/moventra`，源码基线 `5a61a52315c300ff704ae632ac27d1cd8cc8e48a`（业务代码与 `b1b27fb` 相同），开始时工作区干净。本批仅生产结构、运行配置、服务部署和对应文档；没有修改业务代码或发起真实金融订单。

沿用 [FLOW-MESSAGES-001/002](../docs/business/message-center.md) 与 [统一开卡 FLOW](../docs/business/client-card-issuing.md)。目标为消息查询/自动 OTC 通知运行准备，以及统一钱包开卡 prepare 模式。运营主动发送、消息客户授权和真实发卡没有自动放开；真实发卡验收文件未配置，不能用虚构的验收声明激活 live。

作用环境：Render My Workspace / moventra-card-bin / Production；API `srv-daepgj8u01pc73fgdhsg`、开卡 Worker `srv-damh1ugu01pc73a8eck0`、PostgreSQL `dpg-daepg09t0dsc73b7q55g-a` 的 `moventra`。没有更改数据库外部 IP 访问规则。

## 备份、恢复与定向迁移

- 平台导出请求返回 202，但本轮检查时尚未出现新的下载文件，不能将请求受理计为备份完成。
- 改用既有加密备份机制：生产私网内 `pg_dump -Fc --no-owner --no-acl`，仅将 CMS AES-256 加密后的内容取回；私钥仅保留本机。任务 `job-damvpaugekts73f5t7c0`，加密分片完整并校验成功。
- 明文 dump SHA-256：`22365383d3ddf123027aa7daac6889717dff3153735227bbca9abd2af373c1df`；密文 SHA-256：`ccdff53c13b6825c40467fe3cf169d9993a9ad601afcc25692903e1110b3b298`。私有备份保存在本机 `/Users/edi/.codex/backups/moventra/2026-09-19-activation`，不入 Git。
- 下载备份成功恢复到本地独立 PostgreSQL 库，两项迁移分别执行两次均成功。另以生产新快照在同实例独立恢复库演练，89 项原表/查询视图的行数与排序 JSON 摘要完全一致；演练任务 `job-damvotmk1f9s73etevbg`。恢复库随后删除。
- 正式任务 `job-damvpsijnfac73er7spg` 仅执行镜像内 `api migrate-messages`、`api migrate-issuing-unified`；各自检查001–020原始校验和，无全量迁移或自动补历史数据。
- 021 于 **2026-09-19 03:09:50.883 UTC** 成功，022 于 **03:09:50.934 UTC** 成功。021 SHA-256 `f9afff20703b11d85bf3955d1e99ec173c21109787f7b7a875cb752092912606`；022 SHA-256 `567d836de17e8bc349655b3055534b31b98bd9a5d6e77287ed1c7b3bdf937bc2`。
- 生产迁移前后89项原表/视图摘要一致，汇总 SHA-256 `7443dd6410a6afe0a3040348bfad5b52dbbee215b92b251d01a981b3fed96c17`。开卡订单0、消息任务0、消息授权0。

早期只读检查任务曾因命令解析/客户端路径失败，未执行迁移。namespace 配置成功后的状态查询曾使用错误列名而失败；后续只读复验已确认配置及1条审计，没有重复配置或伪造成功结果。

## 配置与执行边界

| 范围 | 本次配置 | 实际含义 |
| --- | --- | --- |
| API 消息查询 | `MESSAGES_ENABLED=true` | 使用已安装021和正式 namespace |
| 消息 namespace | `live_moventra_funds` | 与现有资金 namespace 相同；独立随机签名密钥保存在服务端 |
| 消息 Worker | `MESSAGES_WORKER_ENABLED=true` | API 进程按已有规则处理自动通知 |
| OTC 捕获 | `otc_enabled=true` | 切点为 `2026-09-19 03:19:29.252017 UTC`；仅捕获此后创建订单的事件，无历史回填 |
| 运营主动发送 | `MESSAGES_SEND_ENABLED=false` | 发布/重试未开放，没有新增客户级消息权限 |
| API 与开卡 Worker | `ISSUING_FUNDING_SOURCE=funds_wallet`，`ISSUING_MODE=prepare` | 复用资金中心连接，真实执行关闭；保留旧开卡账本连接供历史恢复 |

通过唯一有效全局运营身份调用 `message-admin configure`，操作审计携带本次用户授权证据。复验任务 `job-damvv4btqb8s73a2r86g` 确认 namespace、审计及演练库清理。只逐项更新目标环境变量，并比对其他变量完全保留。Worker 复用既有资金生产模式/证据、namespace 和 Blnk TLS 配置，未扩大既有资金渠道能力。

## 部署与验证

API 部署 `dep-damvva3m8hqs739hnkj0` 于03:21:44 UTC live；开卡 Worker 部署 `dep-damvva3m8hqs739hnlhg` 于03:22:15 UTC live，均固定源码 `5a61a52315c300ff704ae632ac27d1cd8cc8e48a`。两端 Cloudflare 本批没有代码差异，不重新发布。

部署后任务 `job-dan0012jnfac73ersb60` 成功：核对服务运行环境的六项非秘密开关、签名密钥最短长度、021/022校验和；通过私有CA校验及认证GET分别验证原开卡Blnk和统一钱包Blnk的`general_ledger_id`。消息队列、收件箱、客户级消息授权、开卡订单及新卡投影均0，供应商1个且仍paused。开卡Worker上线后日志确认`ledgerReachable=true`、`executionEnabled=false`、pending0、requiresVerification0。API `/healthz` 与 `/readyz` 均200。

客户端消息页面的本机 urllib 探测返回403，未把该响应算作页面或已登录业务验收；没有因此放宽边缘保护。本批未修改前端版本，真实登录后的消息收件箱/阅读仍待验收。

本轮验证包含真实生产快照恢复、定向迁移、重复执行及生产数据不变校验；此前前端/Go 全套测试仍为[上一批发布证据](2026-09-19-fund-records-release.md)，不追认为本轮重跑。未登录真实客户进行消息阅读或开卡业务验收，未伪造通知、扣款、发卡或退款。

文档同步更新消息/开卡专题、API运行说明、current-state及人工索引；`pnpm docs:index`、`pnpm docs:check`通过，157份Markdown、1173个本地链接、7个JSON示例完成检查。生产与本地演练库均已删除；加密备份、校验值及迁移前环境配置保存在上述私有备份目录，临时明文dump已清理。

## 回退与后续

消息异常先关闭 API 消息/Worker 开关，并通过同一有审计的运维入口关闭 OTC 捕获；关闭主动发送不会撤销已经入队的任务。统一开卡保持 prepare，必要时恢复原资金来源配置并部署；保留021/022、订单、审计和账本，不反向删除结构或覆盖余额。备份恢复只能在明确恢复时间点与新增数据影响后另行执行，不能覆盖运行中的主库。

下一阶段需要指定真实客户/产品及渠道验收，核对扣款、零限额发卡、卡分户、启用、未知结果恢复、退款与对账证据，才可启用 issuing live。运营站内信还需确定具体运营与客户授权范围，再开放发送。

## 后续真实开卡启用检查（2026-09-19 11:34 香港时间）

用户随后明确要求开启真实开卡扣款/发卡。本次读取生产环境确认API与Worker仍为`prepare`、`funds_wallet`；两者未配置`ISSUING_CERTIFICATION_FILE`，Worker尚无发卡专用密钥变量。代码在live启动时要求真实验收清单，直接修改模式会失败；本次没有填造验收声明或删除检查。

只读任务`job-dan05iek1f9s73eun9j0`确认：供应商1个、paused；8个产品active，开卡费均1000美分、最低首充2000美分；开卡客户资格0条、订单0。生产环境以现有凭据和与Go客户端相同的请求头调用Slash：账户身份匹配，8个来源产品均active、BIN一致，产品分页完整。最初Python默认请求收到Cloudflare纯文本403；相同环境/凭据改为实际应用请求头后读取成功，不能据此要求重新配置白名单，也不能宣称已验证写权限。

官方[创建卡](https://docs.slash.com/api-reference/card-post)、[产品列表](https://docs.slash.com/api-reference/card-product-get)与[限额替换](https://docs.slash.com/api-reference/card-spending-constraint-put)本轮复核：接口仍提供产品/虚拟账户关联及以美分表示的collective限制；公开Schema不替代零限额、限额启用、未知结果恢复与对账实测。待用户指定验收客户、BIN/产品及最高总扣款金额后，才进入受控真实验收。当前没有真实扣款、发卡、供应商激活、客户资格新增或live部署。

项目虚拟账户任务`job-dan05uugekts73f77efg`确认来源ID及accountId均与本地项目钱包匹配。诊断脚本按[官方响应结构](https://docs.slash.com/api-reference/virtual-account-get-by-id)读取`virtualAccount`封装后通过；初始直接读取顶层字段所得false不是生产归属不匹配，没有修改项目钱包映射。

共享工作区此时另有界面与人工出入金任务修改，已协调人工资金任务只更新各自目标开关；本批不提交或部署这些并行代码。

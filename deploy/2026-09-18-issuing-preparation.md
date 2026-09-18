# 开卡生产连接准备（已部署，只读）

日期：2026-09-18。用户确认继续钱包连接和开卡处理服务，本批完成技术连接与只读检查；未扣款、未发卡、未入账、未开放真实执行。基础开卡费10 USD、最低首充20 USD沿用已发布配置。独立工作目录 `/tmp/moventra-issuing-release-20260918`，保留其他任务的资金中心改动。

## 实现与部署

连接代码51e00d3、独立Worker镜像2b4a905已推送main。API与Worker发布2b4a905，包含并行资金中心9079821；本批未重新发布前端。Render工作区My Workspace，项目moventra-card-bin（prj-daep4m8n74is73es7g1g），Production，Singapore。

| 资源 | 本批结果 | 配置与边界 |
| --- | --- | --- |
| moventra-blnk-issuing | srv-damh115bedkc73bnp2lg；dep-damh11lbedkc73bnp4pg，9079821，10:22 UTC后live | Starter私有Docker服务，Dockerfile.blnk-tls，TLS5443；同容器固定转发127.0.0.1:5001，无公网 |
| moventra-api | srv-daepgj8u01pc73fgdhsg；dep-damh25uk1f9s7391ja9g，2b4a905，live | ISSUING_MODE=prepare；ISSUING_BLNK_URL=https://moventra-blnk-issuing:5443；专用CA与原独立Blnk密钥；其他配置保留 |
| moventra-issuing-worker | srv-damh1ugu01pc73a8eck0；dep-damh1v0u01pc73a8eeag，2b4a905，10:24 UTC live | Starter后台服务、单实例、Dockerfile.issuing-worker独立入口；prepare、DB_MAX_CONNS=2；无Slash/Firebase/Cregis密钥、无公网 |
| 原moventra-blnk | srv-dam1an2jnfac73cuooj0，10:28 UTC前后暂停 | 验证替代实例成功后暂停，保留原配置作为回退；没有删除数据库或Redis |

Render不支持原image服务直接切换为docker构建，因此新建替代私有实例。固定Blnk0.15.4镜像digest `741665b0d7d5a1c6dc0a989aacf249c05637c52dcf96163c67f9d7a7010ec22d`，复用原独立逻辑库moventra_blnk、受限角色和Redis；不复制账务数据、不执行本批数据库迁移。Blnk仍保留原私网5001密钥保护入口；开卡API/Worker只使用5443加密入口，代理明文转发固定loopback。新增服务自动部署关闭、preDeploy为空。TLS代理与Blnk互相监督退出，敏感请求/响应不写日志。

## 执行边界

prepare不加载Slash执行器、不接受验收声明、不启用执行；Blnk客户端拒绝全部非GET调用。Worker数据库会话default_transaction_read_only=on，仅认证读取general_ledger_id与查询订单计数，每分钟检查一次，不调用Tick。Tick本身也拒绝禁用服务。专用CA仍校验证书链、主机名、有效期，禁止继承代理或跟随重定向。

供应商暂停和客户资格未改；未设置真实验收清单，未伪造通过证据。价格上架与连接成功不等于允许客户付款。正式渠道的零限额受限卡、累计限制、未知结果恢复及对账仍待真实验收；本批不要求用户提供其不理解的技术报告。

## 本次验证与证据

- 隔离PostgreSQL全量Go race、Go vet和命令构建通过。新增测试覆盖专用CA、未信任证书、错误密钥、只读客户端阻止建余额/转账、TLS代理保留认证且固定loopback、prepare无provider且拒绝执行、live缺验收拒绝。首次测试暴露Tick禁用时仍访问数据库，修复后重跑通过。
- 云端实际Docker构建、启动成功。Worker10:24、10:25、10:26 UTC连续报告ledgerReachable=true、executionEnabled=false、pending=0、requiresVerification=0。
- 10:27:28 UTC主动重启后新实例7sp62再次连接成功，仍为只读、待处理0；这只验证prepare恢复，不冒充真实金融任务恢复验收。
- 只读核验任务job-damh40740ujc73au0j3g成功：携带密钥与CA的HTTPS读取成功；无密钥返回401；不信任专用CA时连接被拒绝；数据库/角色均为moventra_blnk，blnk.transactions总数0。查询显式采用只读事务模式。
- API `/healthz`、`/readyz`均200。没有新增生产浏览器支付验收、渠道金融写入、客户入账或实际扣款。
- 前两次一次性核验任务分别因命令引号解析与尚未挂载的临时文件失败，未运行资金SQL或金融API；改为无外部文件依赖的只读命令后通过。临时secret-file及多余CA环境项已删除，未保留测试入口。

设计、实现、自动化和只读生产连接验证已完成；真实渠道验证未完成；部署完成但金融执行未开放。先前前端及隔离浏览器证据保留在[开卡流程卡](../docs/business/client-card-issuing.md)，本批没有重跑前端测试。

## 证书维护与回退

叶证书DNS SAN为moventra-blnk-issuing，2026-12-17 10:20:50 UTC到期（香港18:20:50）。CA与叶私钥保存在本机仓库外受限目录 `/Users/ediya/.config/moventra/issuing-tls`，文件0600、目录0700；CA私钥未上传。API/Worker只取得公开CA证书，叶私钥仅进入Blnk运行环境。正式长期运维续期责任人待分配，尚无自动续期任务。

续期应在到期前以原CA签发相同SAN叶证书，只更新Blnk的BLNK_TLS_CERT_PEM/BLNK_TLS_KEY_PEM并部署；验证认证HTTPS和Worker连接后记录新到期日。若轮换CA，先使API/Worker信任新旧CA，再换服务证书，验证后删除旧CA。禁止跳过证书校验。

回退先保持API prepare或disabled并暂停issuing-worker；必要时恢复旧Blnk实例，暂停替代实例，保留原数据库/Redis。旧入口只有HTTP，不可绕过应用HTTPS要求接入；API保持disabled，待修复TLS后恢复只读连接。不能删除订单、账本或伪造资金冲正。

官方CLI登录已成功，令牌保存在用户受限配置，页面显示7天有效；同一工作区有其他部署任务使用该授权，本批不撤销共享登录以免中断其他任务。没有将凭据写入仓库或报告。

官方依据：[Render后台Worker](https://render.com/docs/background-workers)、[Render CLI](https://render.com/docs/cli)、[Blnk安全模式](https://docs.blnkfinance.com/advanced/secure-blnk)。固定0.15.4自动HTTPS需要公网ACME验证，因此这里使用私有CA同容器TLS。

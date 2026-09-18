# 开卡生产连接准备（尚未部署）

日期：2026-09-18。用户授权继续钱包连接和开卡处理服务；本批只准备连接与只读检查，不执行真实金融事项。基线 c88466a，独立目录 `/tmp/moventra-issuing-release-20260918`；保留主工作区并行改动。

## 已核实与本批实现

- Render 项目仍为 moventra-card-bin，Production；现有私有 Blnk `srv-dam1an2jnfac73cuooj0` 的 `/health` 从API容器返回UP。当前API没有四项ISSUING配置，worker二进制已在镜像内，尚无开卡worker服务。
- 现有 Blnk 私有入口是HTTP，应用远端连接要求HTTPS。保持TLS要求，增加同容器TLS入口5443，转发只到127.0.0.1:5001；原版本0.15.4与镜像digest不变，不迁移数据库、不增加公网入口。
- Blnk客户端支持专用CA，仍校验证书链、主机名、有效期，禁用代理环境继承和重定向。未提供CA时保留原系统信任规则。
- 新增 `ISSUING_MODE=prepare`：不加载Slash执行器、不接受验收声明、不启用执行。Blnk客户端拒绝所有非GET调用；Worker将数据库会话设为default_transaction_read_only，只做账本认证读取与订单数量SELECT，跳过Tick。
- 每分钟输出ledgerReachable及executionEnabled=false；连接失败不伪装成功，不输出密钥或渠道原文。正常live流程仍须真实验收清单，prepare不能当作已验收。

## 待应用的具体配置

| 资源 | 改动 | 不变项 |
| --- | --- | --- |
| 现有 moventra-blnk 私有服务 | 同仓库构建 `services/api/Dockerfile.blnk-tls`，启动 `/usr/local/bin/blnk-tls`，设置BLNK_TLS_CERT_PEM/BLNK_TLS_KEY_PEM | 原数据库/Redis/密钥、secure=true、5001后端、无公网、关闭自动部署；不执行迁移 |
| moventra-api | 发布新镜像；ISSUING_MODE=prepare、URL=https://moventra-blnk:5443、复用专属Blnk密钥、ISSUING_BLNK_CA_PEM | 无Slash执行配置、不改供应商暂停和客户资格、不运行迁移 |
| 新 moventra-issuing-worker | 同项目Singapore后台服务；同一已审核提交；显式Docker入口为issuing-worker；prepare、DB_MAX_CONNS=2及相同Blnk连接 | 无公网、无预部署迁移、不复制Firebase/Cregis/Slash密钥，不启用真实作业 |

API与Worker只接收CA证书，TLS私钥仅放Blnk运行环境。叶证书必须包含moventra-blnk的DNS SAN，CA私钥保存在仓库之外的受限文件；上线时记录到期日和续期责任人。不得使用跳过校验或伪造certification.json来连通。

部署顺序：先记录既有Blnk配置及健康基线，配置证书并发布私有TLS入口；从API容器验证无认证拒绝、错误CA/主机名拒绝、正确认证GET可读取general_ledger_id；再发布prepare API和Worker，检查日志两次及重启恢复，确认订单/账务未改变。若失败，恢复原固定Blnk镜像与`blnk start`、API保持disabled；不删持久数据。

## 验证

本批隔离PostgreSQL全量Go race、Go vet及两项命令构建通过。新增测试覆盖专用CA成功/未信任证书失败/错误密钥失败、只读客户端禁止余额创建及转账、TLS代理保留认证且固定loopback、prepare无provider且拒绝执行、live仍拒绝缺失验收。首次测试发现Tick在禁用时仍会先查询数据库，已增加入口检查后重跑通过。

没有本批生产部署、真实账本写入、扣款或发卡。Render连接器不支持创建后台Worker和完整Docker私有服务更新；官方CLI登录流程已返回成功；页面显示令牌7天到期。使用该登录继续已授权部署；部署结束应撤销本次令牌。

官方依据：[Render后台Worker](https://render.com/docs/background-workers)、[Render CLI授权](https://render.com/docs/cli)、[Blnk安全模式](https://docs.blnkfinance.com/advanced/secure-blnk)。本批使用固定0.15.4源码核对其自动HTTPS需公网ACME验证，故采用私有CA同容器TLS，不公开账本服务。

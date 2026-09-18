# Cregis 接入：隔离资金与来源观察

隔离实现阶段新增013迁移、回调收件箱、只读同步、TRON核验及隔离充值/提现/OTC，流程见[资金专题](../business/cregis-funds.md)。后续生产TRC20充值与OTC已分能力启用，提款与卡充提仍关闭，依据[2026-09-18激活记录](../../deploy/2026-09-18-production-funds-activation.md)。下方协议及平台访问记录保留原批次证据。

## 已实现与协议依据

`services/api/internal/cregis` 包实现 WaaS 扁平参数签名及同项目验签、Team API 精确请求字节签名。拒绝浮点数、重复 JSON 字段及嵌套对象，保留零值和 int64 ID。Team API 尚未实现请求客户端及 JCS 序列化。

官方依据：[产品入口](https://developers.cregis.com/en/introduction/)、[WaaS 鉴权](https://developers.cregis.com/en/waas-authentication/)、[Team API 鉴权](https://developers.cregis.com/en/team-api-authentication/)、[充值通知](https://developers.cregis.com/en/reference/waas-api/depositCallback/)、[出金通知](https://developers.cregis.com/en/reference/waas-api/payoutCallback/)。

验签只证明报文完整性。协议包自身不存储，当前资金层收件箱已提供去重；时间戳只校验正整数，允许历史通知重试。充值成功与出金成功的状态类型和取值分别校验。金额保持十进制字符串，不自行假设资产精度。未提供链上 transfer index，不填造索引或设置 finalityVerified；正式入账仍受 [Blnk 规则](blnk.md) 与客户地址映射约束。

## 凭据与历史部署证据

用户已确认使用 **WaaS**，截图提供 Base URL `https://t-wsmbuuhb.cregis.io`、项目 ID `1455735316373504`。已写入 `services/api/.env.example`；API Key 留空。不能仅凭域名前缀推断测试/正式环境。用户随后确认三个变量已配置在 Render 的 moventra-api；尚未独立验证变量值或有效性，不需要在聊天提供密钥。

只读客户端仅暴露官方 [流水查询接口](https://developers.cregis.com/en/reference/waas-api/tradePage/)，默认单页 20 条，上限 100；支持状态、链、代币、tx_id 筛选。请求间隔至少 2.1 秒（单客户端实例），多进程需额外协调限流。不自动重试；错误不返回上游原文；HTTPS、20 秒超时、禁止重定向、2 MiB 响应上限。该客户端返回渠道字段，当前来源 handler 已提供授权及字段白名单 DTO。

在服务端进程配置 `CREGIS_BASE_URL`、`CREGIS_PROJECT_ID`、`CREGIS_API_KEY` 后，从仓库根目录执行：

```bash
go -C services/api run ./cmd/cregis-readonly
```

Dockerfile 已补充打包 `/usr/local/bin/cregis-readonly`；新镜像部署后可在 Render Shell 运行 `cregis-readonly`。主服务入口仍为 `api`，启动不会自动查询 Cregis。

打包增量验证：Linux amd64、CGO 关闭的命令编译通过；Cregis 测试通过（缓存），文档检查通过。系统 git 因 Xcode 许可无法运行，构建时使用 CommandLineTools 的 git。当前没有 Docker CLI，完整镜像构建未在本机执行。

2026-09-18 配置后的平台检查：最新 live 部署 `dep-damet4u7bikc73bd0mvg` 仍运行旧提交 `a2fa1f6`，不是新增查询客户端版本。当前浏览器未登录 Render，本机 SSH 被 `Permission denied (publickey)` 拒绝，故没有读取环境变量或执行真实查询。需要部署包含核验命令的新镜像，并取得已登录 Render Shell 或既有 SSH 访问后再验证；此处不表示部署已获授权。

后续正式部署（用户明确授权）：2026-09-18 16:05:22 香港时间，Render 部署 `dep-damf0mdbedkc73bguksg` 已 live，源码 `c5ff2c629ee6298093b74dcb19aa450818d9d603`。云端 Docker 构建通过，`/healthz` 返回 200/status=ok，`/readyz` 返回 200/status=ready；上线后至 08:06:05 UTC 的 error 日志查询为空。本次没有迁移、付款或部署前端。真实 Cregis 查询尚未执行；环境变量和白名单仍是用户配置确认，不能由健康检查推断渠道可用。可在该服务 Render Shell 执行 `cregis-readonly`，核验输出仅包含项目流水分页数量。

命令不自动读取 dotenv，只输出首个查询页的数量信息，不输出地址、订单明细或密钥；不连接数据库。通过此命令不代表全量历史、后台页面或资金功能已接通。当前本地已补来源存储、授权、隔离地址与后台流水；真实金融执行和生产账本不属于本批。

协议基础阶段 `CGO_ENABLED=0 go -C services/api test ./...` 通过，包含新增 TLS 模拟查询测试（无真实渠道请求），部分未变更包使用 Go 测试缓存。此前协议测试含官方 WaaS 向量、独立 HMAC 向量及 15 组回调类型/异常场景。真实渠道调用、数据库联调、浏览器流程及部署均未执行。旧 Cregis 候选代码仍未找到，本包是依据官方文档新增的实现。

## 四流程 live 接入准备增量

用户已恢复完整方案，本地新增由服务端 Cregis 创建地址、双链最终性、批准后出金及原单查询路径。开户后首次进入充值页才创建地址，不在开户时创建。此前隔离观察仍保留；正式能力默认关闭，未知地址创建不自动重发。启用条件、恢复缺口和本次证据见[资金中心](../business/funds-center.md)。本批未调用真实金融接口。

# Moventra Blnk 本地影子账本

仅用于本地隔离验证；Blnk Core 固定 `0.15.4` 和镜像 digest。PostgreSQL/Redis 不对宿主开放端口，Blnk 仅绑定 `127.0.0.1:5501`。配置中的密码/密钥是公开测试值，不能用于部署。Blnk 数据与 Moventra 数据库分开。

## 一键验收

本机需 Docker daemon、Go、curl 和监听 `/tmp` 的 PostgreSQL：

```bash
cd /Users/edi/Documents/ChatGPT/moventra/services/api
bash scripts/test-blnk.sh
```

脚本默认使用 5502 端口，为每次运行创建独立 Compose 项目/卷和随机 `moventra_test_*` 库，结束后只清理本次资源。它运行完整 Go race 测试，包括真实 Blnk 的多卡流程；不能用不含 `BLNK_TEST_URL` 的普通 `go test` 替代这项验收。

## 持续本地开发

```bash
cd /Users/edi/Documents/ChatGPT/moventra
docker compose -f deploy/blnk/compose.yaml up -d
createdb -h /tmp moventra_shadow_development
cd services/api
export DATABASE_URL='postgresql:///moventra_shadow_development?host=/tmp'
export LEDGER_MODE=shadow
export BLNK_URL=http://127.0.0.1:5501
export BLNK_API_KEY=moventra-local-shadow-only
export BLNK_NAMESPACE=shadow_development
export BLNK_LEDGER_ID=general_ledger_id
go run ./cmd/ledger migrate
```

账本命令通过 stdin 接收 JSON，类型见 [接入契约](../../docs/integrations/blnk.md)。需先在隔离库建立合成用户/客户；此命令不创建或激活真实用户。`provision` 建立钱包/清算/卡/在途映射；`submit` 记录内部记账任务；`card-posting` 和 `crypto-credit` 接收已核验的标准事实；`asset` 配置数字资产白名单；`drain` 消费待处理任务；`resolve` 输入已核验的调额结果；`snapshot` 查询精确余额和本地账本核对。

```bash
go run ./cmd/ledger drain
```

Blnk 客户端强制同步 `skip_queue=true`；`QUEUED` 永远不算成功。本地配置未启动 Blnk worker，不提供异步队列、定时预占或索引搜索能力。本版本使用独立在途分户预占转卡资金，不使用 Blnk Inflight 自动过期，避免结果未知时释放资金。

相同 namespace 必须仅属于同一 Moventra 数据库/环境。Blnk 的 General Ledger 下，确定性的 `@mv_<hash>` indicator 对应本地账户，可恢复创建过程中丢失的响应；实际转账使用明确的 `bln_*` ID，不能把 `@` 自动创建余额当作业务账户授权。业务金额及尺度以本地 USD=2、USDT=6 的固定契约为准，每笔交易使用精确最小单位和显式 precision。

普通 API 默认不启用 Blnk。`LEDGER_MODE=shadow` 仅允许本地且命名为 `moventra_shadow_*`/`moventra_test_*` 的应用库及回环地址 Blnk；不支持 `live` 模式。关闭影子读接口仅需去掉该变量；不要删除已记账证据或在未排查未知结果前重新提交新的 effectKey。

## Render 私有服务

`render.yaml` 描述Blnk Core 和 Redis 资源；PostgreSQL 复用现有 `moventra-postgres` 实例中的专属 `moventra_blnk` 逻辑库及受限账号，位于 Moventra 相同的 Singapore 内网。Blnk 无公网 URL；现有 PostgreSQL 和新 Redis 均关闭公网 IP allow-list。镜像与本地验收固定到同一 digest。

将 `blnk.render.example.json` 中占位符替换为专属内部连接串，以及分别独立生成的 API/metrics 密钥，然后作为 Render Secret File `blnk.json` 上传。真实文件仅保存在密钥设施，不能提交仓库或放进 CLI 参数/日志。API 必须保持 secure=true。

初次新空 Blnk 数据库执行 `blnk --config /etc/secrets/blnk.json migrate up`，成功后移除一次性 pre-deploy command。正常启动只执行 `blnk --config /etc/secrets/blnk.json start`。引擎升级前备份并核验 SQL 迁移；现有 Moventra 应用逻辑库不用于 Blnk 自身表；两者共享 PostgreSQL 实例，连接池限制为 10。

当前使用同步 `skip_queue=true` 记账适配，未开放异步队列执行；后续启用异步事务需补独立 workers。Typesense、官方托管 Dashboard 不是当前部署依赖。此基础设施上线不自动执行 Moventra 的迁移 006、绑定客户或开放真实记账。

Blnk 私有 HTTP 入口仅供同区域服务调用，仍要求密钥；现有 Moventra 适配对非本地连接要求 HTTPS。正式接入须提供受信 TLS 或显式受限的私网传输方案，不能为了连通而删除全局 TLS 校验。

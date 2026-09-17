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

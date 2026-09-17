# 后端运行优化 FLOW-RUNTIME-001

2026-09-18；基线 ce0a88a 加已有未提交角色与 Blnk 实现。本次范围：本地任务自动消费、连接池参数、迁移就绪检查；不修改资金状态规则、不接通生产账本、不部署。

| 项目 | 范围 |
| --- | --- |
| 目标 | 已持久化 shadow 任务 → 独立 worker → 原 Process 幂等处理 → 原授权快照查询 |
| 页面关系 | 无新增页面；现有双端 ledger 查询保持原授权和手动刷新方式 |
| 业务身份 | 沿用 namespace/customer_id/operation ID/effectKey 与固定 Blnk reference |
| 数据依据 | 隔离 PostgreSQL 持久化任务；本地 Blnk；不新增渠道事实 |
| 接口链 | 受信本地 CLI submit → ledger_operations → worker Drain → Process → Blnk → journal/audit → 原 GET ledger |
| 状态及恢复 | 原有状态机；定时消费到期任务，错误后继续下一轮，停止信号取消在途调用；结果未知仍用原 reference 恢复 |
| 权限 | worker 必须通过原本地 shadow 检查；客户归属、运营 MFA、独立 ledger 授权不变 |
| 验收 | worker 取消/重试/超时测试；连接池非法值；缺迁移/校验和异常拒绝 ready；隔离 PostgreSQL 回归 |
| 待定 | 云端账本接入、数据库隔离、恢复演练和线上告警仍待独立运行环境核对；负责人待分配 |

worker 首版单实例、串行有界批次，无独立队列依赖。每轮日志是消费尝试数，不是成功记账数；资金结果以持久化状态为准。API 健康检查只核验本地数据库迁移完整性，不把它描述为上游健康或业务验收。

## 本次交付证据

2026-09-18，在上述共享工作区完成；未提交、未部署。

- 设计/本地实现：已完成独立 `cmd/worker`、可配置 API/Worker 连接池、迁移 checksum 就绪检查及取消后停止批次处理。
- `go test ./...`、`go vet ./...`、`go build ./cmd/...` 通过。
- `bash services/api/scripts/test-postgres.sh` 通过：新建随机隔离测试库，race 回归包含配置及迁移缺失/损坏检查。
- `bash services/api/scripts/test-blnk.sh` 最终重跑通过：独立 Docker Compose Blnk/PostgreSQL/Redis 及随机应用测试库；新增 Worker 自动消费到账、再次 Drain 无重复任务、Process 重放不重复入账断言；原多卡、失败/未知结果、回滚恢复、精确金额和越权测试通过。脚本退出清理本次 Compose 资源和测试库。
- Worker 单测覆盖失败继续轮询、单轮超时、已取消不再消费、非法参数拒绝。
- `git diff --check` 通过。保留工作区原有前后端、角色和账本修改。
- 浏览器验收不适用：未改页面或 transport。真实 Firebase 验证因无显式测试环境而跳过；真实渠道验证、线上配置核验、生产恢复演练、生产迁移和部署均未执行。

完整运行日志暂存 `/tmp/moventra-runtime-postgres-tests.log` 与 `/tmp/moventra-runtime-blnk-tests.log`（本机临时证据，不作为持久部署记录）。容量、云端 Worker、报警接收端和生产备份策略尚未实施。

## 第二批流程 FLOW-RUNTIME-002（本地已验证，未部署）

范围：本地 Worker 队列观测与停止恢复。入口为独立 Worker 和受信本地 `ledger status`；按 namespace 聚合数据库任务状态，输出待消费/到期/等待渠道/未知/人工复核数量、任务年龄及连接池状态。没有新增公网监控接口，不输出客户 ID、金额、凭据或来源原文。失败必须表示不可观测，不能返回零积压。日志观测不自动改变资金状态或释放在途。

验收：隔离 PostgreSQL 的 namespace 隔离、状态计数、年龄与失败分支；停止信号取消在途任务；本地 Blnk 消费及幂等回归。线上配置元数据核验受 Render 工作区确认约束，未连接生产数据库。

### 第二批本次验证

- `bash services/api/scripts/test-postgres.sh` 通过，包括 namespace 隔离、各状态数量、到期与等待年龄、取消及数据库不可用拒绝伪零。
- `bash services/api/scripts/test-blnk.sh` 通过，真实本地 Blnk 与隔离 PostgreSQL race 回归；真实 Firebase 联调仍跳过。
- `bash services/api/scripts/test-runtime-restore.sh` 通过，合成应用库备份 SHA-256、全部表恢复行比较、迁移重放校验、审计不可删除。没有恢复 Blnk/Valkey 或生产数据。
- `bash services/api/scripts/test-worker-runtime.sh` 通过，实际编译并启动独立进程，验证 status CLI、JSON 队列样本、连接池配置及 SIGTERM 正常退出。使用随机本地库和不可达 Blnk 地址，证明空队列观测不依赖远端请求。
- `go vet ./...`、`go build ./cmd/...` 在 services/api 通过；根目录误执行曾因非 Go 模块失败，切换至正确目录后通过。`git diff --check` 通过。
- 日志：`/tmp/moventra-runtime-monitor-tests.log`、`/tmp/moventra-runtime-monitor-blnk-tests.log`、`/tmp/moventra-runtime-restore-tests.log`、`/tmp/moventra-worker-runtime-tests.log`。
- Render 连接器返回无已选工作区，要求用户确认后传 workspaceId。已列出 My Workspace 并向用户询问；尚未读取服务、环境变量、部署及数据库内容。本轮无云端变更、无外部通知、无生产迁移或部署。

详细指标和恢复处置见 [运行手册](../../deploy/blnk/monitoring-and-recovery.md)。本次日志 WARN 是本地观测能力，不表示已配置线上报警。

## 发布适配：最新 main 基线 bdb7c7f

发布使用独立 worktree，保留 main 的渠道投影、onboarding、用户目录及角色功能。旧本地迁移 003/004 对应关系已过时，发布版 Ready 核验 main 的 001–005，ledger 启用时核验 006；没有新增或修改迁移 SQL。Docker 同时打包 worker/ledger，默认仍启动 API；本次不创建云端 Worker、不开放生产账本。此前“待确认工作区”已由用户提供项目 prj-daep4m8n74is73es7g1g 及当前 CLI workspace 元数据明确目标。

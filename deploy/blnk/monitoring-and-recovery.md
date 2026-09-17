# 本地 shadow 运行监控与恢复

2026-09-18；FLOW-RUNTIME-002。仅本地隔离环境，不代表生产告警已接入。

## 状态入口

在 services/api，沿用本地 shadow 环境变量运行：

```bash
go run ./cmd/ledger status
```

只读查询当前 BLNK_NAMESPACE 的任务状态，2 秒超时；不访问 Blnk、不修改任务。不新增公网路由。需要与原 CLI 相同的本地隔离配置，不能查询生产库。

| 字段 | 含义 |
| --- | --- |
| observedAt | 数据库本次观测时刻 |
| runnable | pending/commit_pending/release_pending 总数，包括尚未到重试时间的任务 |
| due | 已到 next_attempt_at、可以消费的数量 |
| retrying | runnable 中 attempts>0 的数量；可能包含待恢复事项，不等同确定失败 |
| awaitingProvider / providerUnknown / reviewRequired | 分别等待渠道、结果未知、人工复核；不参与自动消费 |
| oldestRunnableSeconds | 最早 runnable 创建至今时长，包括先前等待渠道时间；不是本次处理延迟 |
| oldestDueSeconds | 最早到期任务超过 next_attempt_at 的时长 |
| oldestProviderWaitSeconds | 等待渠道/结果未知中最早 updated_at 至今时长，表示最近状态更新时间口径 |

无对应任务时年龄为 null；数据库不可用时命令失败，不能将失败解释为零积压。

## Worker 日志

`go run ./cmd/worker` 输出 JSON 日志。每轮错误即时 WARN；队列样本最多每分钟一次，排在有界批次后，长批次会推迟采样。事件 `ledger_queue` 包含上述队列状态与连接池 acquired/total/max、累计等待连接次数及累计获取耗时。连接池累计指标不是单次延迟，重启会归零。

`providerUnknown>0`、`reviewRequired>0` 或 `oldestDueSeconds>=300` 发出 WARN。队列查询失败发 `ledger_queue_unavailable`，不发送伪零样本。不输出客户 ID、金额、来源证据、数据库连接串或原始上游错误。

建议告警采集端将 `ledger_queue_unavailable`、持续积压与超过 3 分钟无队列样本分开处理；这是初始运维阈值，需基于容量测量调整。当前只实现日志事件，未连接告警接收端、未发送通知、未创建定时监控。

## 本地备份恢复演练

从仓库根目录执行：

```bash
bash services/api/scripts/test-runtime-restore.sh
```

脚本创建两个随机命名的本地 moventra_test_* 库，写合成任务及审计证据，生成 custom-format pg_dump 和 SHA-256 校验，恢复到另一空库。逐表比较全部行，覆盖大于 JS 安全整数的金额、固定幂等标识、待处理任务和审计；再次核验迁移，并验证 journal 不可删除。退出只清理本次测试库和临时目录。

这验证应用 PostgreSQL 的逻辑备份，不包含 Blnk PostgreSQL、Redis/Valkey 或生产 PITR，不证明跨系统恢复一致性。合成 journal 的 Blnk ID 故意不是实际交易，不启动 worker 处理这些夹具。

## 真实故障的处置边界

1. 保留任务/effectKey/reference/证据，先查看状态；未知结果不新建相同经济事项，不释放在途，不改余额配平。
2. Worker 故障修复后可按原任务恢复；业务查询继续使用原归属、MFA 和审计规则。
3. 数据库恢复前停止写入与消费，保留原库和恢复点；云端备份及恢复需另行授权。
4. 应用库与 Blnk 的恢复点可能不同；恢复后先按固定 reference 核对已落账事项，处理本地有分录而 Blnk 无交易等差异，再恢复消费。不能仅凭数据库 restored 或 readyz 200 开放生产记账。
5. 未完成真实渠道对账、跨系统恢复验证前，不将 shadow 切换为生产账本。

## 可重复的运行验证

`bash services/api/scripts/test-worker-runtime.sh` 会在随机本地测试库实际运行 status CLI 和独立 Worker，断言 JSON 观测、连接池大小及 SIGTERM 正常退出。空队列场景故意配置不可达 Blnk，不会触发任何上游金融调用。测试退出清理本次库和临时二进制。

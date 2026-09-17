# Blnk 本地验收记录 — 2026-09-17

基线：Moventra `ce0a88a` 加原有未提交工作及本次 Blnk 增量。没有提交 Git，没有生产发布。设计与范围见 [Blnk 接入](../integrations/blnk.md)。

## 本次已执行

| 验证 | 结果及边界 |
| --- | --- |
| 原生 Blnk Core v0.15.4 + PostgreSQL/Redis | 官方源码 `f3067eb56a573055ce86c3328566145b467f393b` 本地构建运行；合成数据，独立应用测试库，完整 Go race 测试通过 |
| Docker 一键验收 `bash services/api/scripts/test-blnk.sh` | 真实固定 digest Blnk 镜像、独立 Compose 项目/卷、随机 PostgreSQL 应用库；测试通过，脚本已清理自身容器/卷及应用库 |
| 多卡状态流程 | 钱包 10000 分，卡 A 转入 3000、卡 B 转入 2000；未知保留在途；A 确认、B 拒绝退回，总额仍为 10000 |
| 消费与退款 | A 消费 1010、退款 250 后客户 USD 总额 9240；重复回调/并发重放不重复记账；不同金额重用 effectKey 拒绝 |
| 跨系统故障恢复 | 注入本地 journal 写入失败，Blnk 已应用但本地回滚；核对先显示 mismatch；重建服务后使用原 reference 恢复，不重复扣款 |
| 并发余额不足 | 余额 6000 同时发起两笔 4000 转卡，仅一笔占用，另一笔 rejected，钱包剩余 2000 |
| 精度与资产白名单 | USDT `9007199254740993` 最小单位完整保存；Cregis/链上重复证据合并；未注册 token、USDT 记入 USD 钱包被拒绝 |
| 归属及证据 | 跨客户账户、错卡在途、错连接/卡事实、重复绑定外部卡被拒绝；journal/evidence/audit 不能 UPDATE/DELETE |
| HTTP 恢复 | 丢失成功响应、reference 字段冲突、QUEUED/INFLIGHT 不判成功、跳转不转发密钥、错误不泄露响应载荷；精度缺失读取完整交易 |
| API 权限 | 客户本人、跨客户拒绝、管理员 MFA、独立 ledger_read_grants、旧企业 viewer 不扩权、审计失败不返回数据、Blnk 失败不显示零；单连接池也能完成读请求 |
| 网关及前端回归 `pnpm test` | 64 项通过，包含新增 ledger GET 精确路由、写方法拒绝及前端精确金额/主体/汇总校验 |
| 静态检查 | `go vet ./...`、`go build ./...`、Compose 配置校验、`git diff --check` 通过；共享前端两端 `pnpm typecheck`、`pnpm build` 通过（后台有现存大 chunk 提示） |

真实 Firebase 登录测试没有配置专用凭据，明确跳过；这次 API 权限测试使用测试 verifier，不宣称验证了真实登录。未修改前端界面，未执行浏览器流程验收或前端余额切换。

## 仍未验证/未实施

- Slash 实际调额、幂等查询及其 utilization 与本地卡资金的对应规则；本地测试只输入合成渠道确认结果。
- Cregis/链上真实回调验签、地址归属、最终性、重组和真实资产覆盖；本地只测试可信标准事实之后的记账。
- 卡授权占用、增量/多次清算、费用和争议政策、正式换汇与卡转出。
- 历史真实余额迁移、唯一写入方切换、前后台真实操作闭环、上游资金池对账、压测与备份恢复。
- GitHub 提交/推送、生产应用库迁移、Blnk/Render/Cloudflare 生产部署、真实资金操作：均未执行。

`reconciliation=matched` 只表示本地分录与 Blnk 一致；响应另带 `externalReconciliation=not_checked`，不能据此认定上游资产已对平。当前只允许隔离 shadow 模式，未开放 live 开关。

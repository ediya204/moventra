# Moventra Harness：工程协作入口

维护日期：2026-09-18。适用当前仓库。Harness 指让开发代理能够读取上下文、执行任务、验证结果和交接工作的工程文件；不新增业务功能、生产权限或后台定时任务。

## 文件职责

| 入口 | 唯一职责 | 更新时机 |
| --- | --- | --- |
| [AGENTS.md](../../AGENTS.md) | 项目身份、硬性边界、必读入口和交付约束 | 长期规则或协作边界改变 |
| [项目说明](../../project.md) | 产品定位、架构与开发方向 | 产品/架构决策改变 |
| [开发总纲](../DEVELOPMENT.md) | 开发次序、证据类别、兼容和容量原则 | 工程方法改变 |
| [当前状态](../current-state.md) | 当前能力、工作区增量、已知发布及未验证项 | 功能或发布状态改变 |
| [文档索引](../README.md) / [完整目录](../catalog.md) | 人工推荐阅读路径 / 自动生成的文件清单 | 专题新增、移动、重命名 |
| [业务闭环标准](../business/delivery-standard.md) | FLOW 流程卡与 E01–E09 验收 | 验收方法改变 |
| [任务模板](task-template.md) | 单次任务的范围、调查、证据和交接 | 每条跨端/金融/多阶段流程按需使用 |
| [文档维护规则](documentation.md) | 谁在何时更新什么，如何避免状态过期 | 文档流程或检查工具改变 |
| [检查脚本](../../scripts/check-docs.mjs) | 本地链接、JSON 示例、目录完整性检查 | 检查需求改变 |

AGENTS.md 保持简短，具体领域规则留在原专题；不要另建相互竞争的 CLAUDE.md、另一套金额规则或“代理记忆真相”。工作记录写入仓库内对应流程/发布文档；不自动写入用户全局记忆。

## 一次任务的执行顺序

1. 读取 AGENTS.md、开发总纲及当前状态；记录 cwd、分支/HEAD 与相关工作区差异。只有在当前范围需要时阅读旧项目。
2. 按任务主题读对应子项目 README、专题和代码；金融任务额外读取领域、契约、F/R 场景；Slash 协议变更再核对本次涉及的官方资料与环境。
3. 对照页面 → transport → 网关 → Go handler → 授权 → 数据层填写流程卡。区分现有能力、需要修改的差异及待定业务政策。
4. 在已授权范围内实现；保留并行修改，不以旧迁移覆盖线上编号。文档任务只修改文档及明确相关的工程维护工具。
5. 根据影响运行验证；共享前端变更验证两端，金融变更覆盖精度/权限/幂等/未知结果。只改文档时运行文档检查，不重跑无关资金流程。
6. 更新相关专题、当前状态及必要的索引。记录代码状态、测试结果、真实渠道和部署分别是否完成；没有本次证据就保留待验证。
7. 按用户明确要求提交/发布；需要发布时保留精确 commit 与平台版本证据。未要求发布时保留可审阅工作区，不自动推送。

## 命令入口

从仓库根目录运行；完整运行前提以[根 README](../../README.md)、[API README](../../services/api/README.md)和[隔离服务 README](../../services/local-workspace/README.md)为准。

| 改动范围 | 验证入口 |
| --- | --- |
| Markdown / Harness | `pnpm docs:index`（目录有增减时）、`pnpm docs:check`、`git diff --check` |
| 前端路由/共享模块 | `pnpm check:boundaries`、`pnpm typecheck`、`pnpm test`、对应端构建 |
| Go | 在 services/api 中运行 `go test ./...`、`go vet ./...`、`go build ./cmd/...`；记录环境导致的跳过 |
| PostgreSQL | `bash services/api/scripts/test-postgres.sh`，独立随机本地测试库 |
| 隔离业务 | `pnpm test:workspace`；采集器用模拟 HTTP 的 Python 测试 |
| Blnk / Worker | 仅涉及该模块时按专题运行 test-blnk / test-worker-runtime / test-runtime-restore 脚本 |

Node 22 若不能加载既有测试中的 TypeScript 导入，按[本地验证记录](../business/admin-session-persistence.md)使用 `NODE_OPTIONS=--experimental-strip-types pnpm test`；这是该环境兼容方式，不宣称所有 Node 22 版本行为相同。

## 恢复和交接

上下文不足或任务中断时，交接当前目标、明确授权、版本和差异、已经完成的证据、尚未验证的风险、下一项可执行动作。引用仓库文档，不复制密钥、客户原始数据或冗长日志。另一任务的新修改先核对再合并；不能用旧工作区状态覆盖正在进行的实现。

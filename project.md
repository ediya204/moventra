# Moventra 项目说明

更新日期：2026-09-18。本文以 GitHub `main` 提交 `9b44672` 为整理基线，提供项目定位、结构、开发入口和能力边界。发布状态引用仓库已有记录，本次文档编写未重新验证线上服务或真实业务流程。

## 项目定位

Moventra 是面向客户与运营人员的账户、卡片、交易查询及业务管理平台。官网、客户端、运营后台与 API 共用一个仓库，各自独立构建；共享认证、界面组件和数据契约。

- 正式仓库：[ediya204/moventra](https://github.com/ediya204/moventra)，统一维护 `main`。
- 官网及客户端入口：[moventra.me](https://moventra.me)。
- 运营后台入口：[admin.moventra.me](https://admin.moventra.me)。
- ADSFLOW 是独立历史项目；迁入的部分源码不代表两者运行环境、数据或发布状态相同。

当前产品同时包含正式身份与查询、隔离本地业务流程、线上测试资金流程及影子账本实现。必须按模块判断运行模式，不能将模拟资金、只读投影或审批结果当作真实支付与结算。

## 仓库结构与技术栈

| 路径 | 职责 | 主要技术 |
| --- | --- | --- |
| `apps/client` | 官网、客户登录与客户工作台 | React 18、TypeScript、Vite、MUI |
| `apps/admin` | 运营登录、客户目录、业务查询与审核界面 | React 18、TypeScript、Vite、MUI |
| `services/api` | 身份校验、主体授权、业务接口、审计及受控 CLI | Go、PostgreSQL、Firebase Admin SDK |
| `services/local-workspace` | 隔离本地业务服务与合成数据预览 | Node.js、SQLite、Python 采集工具 |
| `packages/shared` | 两端共用认证、UI、主题、类型及数据适配 | TypeScript、React |
| `packages/assets` / `packages/tooling` | 品牌资源与构建配置 | 静态资源、Vite |
| `deploy` | Cloudflare、Render 与 Blnk 配置及发布记录 | Workers、Docker |
| `tests/frontend` / `docs` | 前端回归、业务规范、契约与验收记录 | Node 测试、Markdown、OpenAPI |

主要请求链路：浏览器 → 同域 Cloudflare 网关 → Go API → PostgreSQL。Firebase 提供登录身份，Go 校验角色、客户归属、资源权限与运营 MFA；前端隐藏入口不能代替服务端授权。

## 能力与验收边界

以下是基线源码及版本记录的摘要，不是本次重新执行的验收报告。旧 README 的早期描述存在滞后，涉及新增能力时优先核对对应专题及源码。

| 模块 | 基线包含的能力 | 仍需区分的边界 |
| --- | --- | --- |
| 身份与开户 | 客户/管理员角色、Firebase 登录、运营 MFA、开户申请及审核相关流程 | 身份认证、审核与服务激活分别判断；管理员也不自动获得所有客户数据权限 |
| 客户与运营查询 | 账户/交易查询、运营概览、注册用户目录、渠道卡交易及客户卡片快照 | 卡片测试快照与内部绑定不代表真实资金归属或上游卡片控制权 |
| 线上测试资金 | 独立测试额度、模拟充值、兑换、提现、订单及运营审核 | `mode=online_test`；真实执行及提现资格为 false，不调用真实资金渠道 |
| 本地业务工作区 | 用户、费率、BIN/渠道、卡片归属、审批及资金原型源码已迁入 | 使用隔离服务及合成数据，不作为生产资金后端 |
| Blnk 与后台任务 | 影子账本、持久化任务、Worker、观测和恢复工具 | 本地实现及基础设施发布不等于生产账本激活；线上测试资金不接 Blnk |
| 渠道接入 | 渠道来源、查询投影及相关导入/同步实现与记录 | 实际连接范围、自动同步、Webhook 和真实渠道验证按专项记录确认 |

最新[线上测试资金记录](docs/business/online-test-funds.md)记载了 API、两端前端和选择性迁移的发布结果，但真实客户登录及运营 MFA 后的下单/审核人工验收尚未完成。自动化测试、资源发布及未认证请求被拒绝不能替代该验收。

## 本地开发

前端使用 Node.js 22+、pnpm 10.32.1；本地业务工作区要求 Node.js 22.13+。Go 模块声明版本为 1.26.5，API 本地环境要求 PostgreSQL 17+。具体配置见各子项目 README，凭据只通过本机或运行环境注入。

在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm dev:client       # 默认 http://127.0.0.1:8853
pnpm dev:admin        # 默认 http://127.0.0.1:8850
```

前端启动不自动配置 Firebase、创建客户主体或启动 Go API。API 的独立开发库、环境变量及启动步骤见 [Go API README](services/api/README.md)，默认端口为 `8870`。迁移命令必须针对明确选定的隔离开发库，不能直接套用到生产数据库。

需要合成数据的本地业务预览时，单独运行：

```bash
pnpm workspace:dev
```

该命令启动隔离 API `8868` 与后台 `8850`，不要与前述后台开发进程同时占用端口；端口冲突按服务错误处理，不停止其他会话的进程。详细行为见[本地工作区说明](services/local-workspace/README.md)。

## 验证与交付

根据改动范围选择验证命令，以下为开发入口，本次文档更新未运行这些业务测试：

```bash
# 仓库根目录：前端边界、测试、类型及独立构建
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build:client
pnpm build:admin

# 本地业务服务回归
pnpm test:workspace

# 仓库根目录：新建隔离 PostgreSQL 测试库的 API 回归
bash services/api/scripts/test-postgres.sh

# 在 services/api 目录执行
go test ./...
go vet ./...
go build ./cmd/...
```

普通 Go 测试缺少对应环境时会跳过数据库或 Blnk 集成项，应以输出为准。涉及影子账本、Worker 或恢复流程时，按专项文档执行对应隔离测试。页面存在、构建通过或 HTTP 200 均不代表业务闭环完成。

官网/客户端和运营后台分别通过 Cloudflare Worker 发布；Go API 使用 Render，PostgreSQL 保存应用数据。当前 `render.yaml` 将 API 自动部署设为关闭。GitHub 提交、迁移、API 发布、两端前端发布及认证后的业务验收分别记录；文档推送本身不执行部署。

## 开发约束与后续工作

- 保留共享工作区无关改动，仅提交本次范围内文件；不提交凭据、真实客户数据、本地数据库或构建产物。
- 金额明确币种、最小单位、精度与方向；未知、零、失败、不支持分别表达。不同币种不直接相加。
- 来源记录、投影、资金影响及审计需可追溯、幂等；审批与结算保持独立。
- 前后端变更按完整流程验收：入口、列表、详情、关联对象、操作结果、异常重试及跨端一致性。
- 生产数据库连接、迁移、部署及真实金融写接口均需独立明确授权。

后续优先补齐已发布测试资金流程的认证浏览器验收，再按业务授权推进真实渠道验证、生产账本边界及运行保障。企业能力、渠道执行与完整资金对账等目标，应以专题的实际实现及验收证据逐项确认。

## 继续阅读

- [开发约束](AGENTS.md)、[开发总纲](docs/DEVELOPMENT.md)、[业务闭环标准](docs/business/delivery-standard.md)
- [文档索引](docs/README.md)、[业务总览](docs/business/README.md)
- [客户端](apps/client/README.md)、[运营后台](apps/admin/README.md)、[Go API](services/api/README.md)
- [交易与资金规则](docs/domain/transactions-and-funds.md)、[接口契约](docs/api/contract.md)、[资金验收场景](docs/testing/financial-scenarios.md)
- [客户卡片绑定](docs/business/customer-card-binding.md)、[线上测试资金](docs/business/online-test-funds.md)
- [Blnk 接入](docs/integrations/blnk.md)、[运行与恢复](deploy/blnk/monitoring-and-recovery.md)、[部署记录](deploy/README.md)

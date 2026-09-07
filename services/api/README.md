# Moventra Go API

更新日期：2026-09-07。独立 Go 模块 `moventra.local/api`，面向客户端与运营后台，部署于 Render。本服务查询客户投影与手动导入的独立渠道投影，不调用旧生产 API、Slash 上游或真实资金写接口。完整范围见 [业务与路由](../../docs/business/routes-and-api.md)。

## 正式卡交易只读投影增量

新增独立渠道投影、显式连接读取权限和 MFA 校验，详情见 [发布及导入说明](../../docs/releases/channel-projection-2026-09-07.md)。该发布任务记录了获授权的迁移 002、手动导入及部署结果；不新增客户资金分录或在线上保存 Slash 凭据。本轮仅整理文档，没有重新执行迁移、导入、部署或本人登录业务验收。

## 已实现

- Firebase ID Token 验证适配器：校验撤销、邮箱已验证；本地用户禁用立即阻止后续请求。生产入口拒绝 Firebase Auth emulator 模式。
- 用户与客户主体分离：个人主体 / 企业主体，一个登录用户可以拥有个人主体并加入企业。
- 个人所有权、企业有效成员、运营按主体/资源显式授权。运营查询额外要求 MFA。
- 身份及可访问主体、账户列表、交易列表；金额用最小单位字符串输出，USD 2 位、USDT 6 位。
- 运营总览 `GET /admin-api/v1/ops/overview?days=7|14|30`：现有 USD 交易投影的服务端聚合，沿用逐客户 `transactions:read`、MFA 和审计；按香港自然日统计成功交易流入/流出及状态分布。完整性、渠道结算、商户、卡片和客户运营指标尚不可用，见 [总览契约](docs/operations-overview.md)。
- 个人升级企业：持久化提交和最新申请查询，UUID 幂等键、并发重复保护、原子审计。
- 版本化 PostgreSQL 迁移、跨主体外键、健康检查、优雅退出、Docker 构建定义。

## 尚未完成 / 禁止作为生产验收结论

Firebase 密码/TOTP 登录、Go 身份与范围查询已有真实签名联调记录，基础设施已部署；个人/企业自助开通、客户范围授权管理、企业材料审核与激活、卡片和资金执行、云端渠道采集及 Webhook 尚未完成。企业升级提交中的 `legalName` 只是第一阶段意向申请，不是完整 KYB 材料。

数据库 `transactions` 是只读业务查询投影，不是资金账本；没有余额及资金写入接口。审批通过与服务激活为独立状态，不会自动迁移个人资金。企业成员当前三个角色都只有整个所属企业的查询能力；受限子账户成员权限与写权限后续单独实现，不能提前分配给需要更小范围的成员。

## 本地启动

需要 Go 1.26.5+、PostgreSQL 17+。先进入 `services/api`，创建独立开发库后设置环境变量（参见 `.env.example`，程序不自动加载 dotenv）：

```bash
createdb moventra_development
export DATABASE_URL='postgresql:///moventra_development?host=/tmp'
go run ./cmd/api migrate
# 在进程环境中配置 FIREBASE_PROJECT_ID、GOOGLE_APPLICATION_CREDENTIALS。
# 凭据文件放在仓库外，不要粘贴到聊天、提交 Git 或放进前端环境变量。
go run ./cmd/api
```

默认端口 8870，`GET /healthz` 检查进程，`GET /readyz` 当前只检查数据库及迁移 001 存在，不能证明渠道迁移 002 已就绪。API 启动不自动执行迁移，也不自动创建用户/成员/运营权限。

认证 API 使用 `Authorization: Bearer <Firebase ID token>`。选定第一阶段为 Bearer 模式，尚未实现此前讨论的 Cookie 会话交换。Go 用可信 UID 映射本地用户，不接受客户端邮箱、角色或自报 UID 作为授权依据。仅在已验证 token 上读取 MFA 因子；每次请求检查 Firebase 撤销状态，因此也依赖 Firebase 网络可用性。

生产前端需经同域转发访问本服务，当前不启用跨域 CORS。`/admin-api/v1`、`/client-api/v1` 是新契约，与旧系统 `/admin-api` 及客户端敏感字段 `/client-api/cards/...` 不同，代理必须精确路由，不能用通配规则直接切换所有旧接口。

## 验证

```bash
go test ./...
bash scripts/test-postgres.sh
go vet ./...
go build -o bin/api ./cmd/api
```

`go test` 未指定 `TEST_DATABASE_URL` 时会明确跳过数据库集成测试。脚本连接本地 `/tmp` PostgreSQL socket，新建随机 `moventra_test_*` 数据库，测试完成后删除；不会使用开发/生产数据库。验证跨主体越权、运营资源授权、MFA、禁用用户、精度、分页、审计故障拒绝返回数据、迁移重复与校验、升级申请并发幂等。测试注入 verifier 不会测试真实 Firebase 签名与登录链路，也不能用于正式服务启动。

Dockerfile 已提供；需本机 Docker daemon 可用后才能验证容器构建。容器使用非 root 用户，数据库与 Firebase 凭据运行时注入，生产数据库连接需按 Render 的 TLS 配置设置。

## 设计和契约

- [开发总纲与多渠道资金规范](../../docs/DEVELOPMENT.md)（区分当前渠道投影与待实施金融模型）
- [账户与升级模型](./docs/account-model.md)
- [OpenAPI 3.1 契约](./docs/openapi.json)

## 开通与后续范围

`POST /api/v1/register` 只创建已验证 UID 的本地用户。受控 CLI `api provision-user`、`api provision-personal`、`api provision-operator` 分别处理身份、个人主体及指定客户的运营只读授权；使用方式与拒绝边界见账户模型。它们不是公开自助开户或运营网页权限管理接口，生产执行需明确授权。

下一阶段需实现企业资料、审核、成员权限细化及独立服务激活，并接入客户端相应流程；当前 V1 客户端只开放个人范围。

旧本地 Slash Python 预览/同步工具、私有 SQLite 及凭据未纳入此仓库；历史记录见 [Slash 本地投影档案](../../docs/frontend/slash-live-data.md)，不能按其旧路径运行本服务。当前机器契约仍有“未部署”的陈旧 servers 描述；实际部署以 [部署记录](../../deploy/README.md) 为准，本次 Markdown 校对不修改 JSON 契约。

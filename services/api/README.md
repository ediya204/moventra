# Moventra Go API

> 2026-09-18：客户端开卡应用与八个BIN目录已发布，全量真实金融执行仍关闭；指定客户TRC20限额充值进展见[验收发布](../../deploy/2026-09-18-deposit-pilot.md)。当前能力及验证范围见[当前状态](../../docs/current-state.md)和[本次发布记录](../../deploy/2026-09-18-client-issuing-release.md)。下方带日期的历史段落保留当时实施状态。

更新日期：2026-09-07。独立 Go 模块 `moventra.local/api`，面向客户端与运营后台，部署于 Render。本服务提供身份授权、客户与渠道投影查询、开户、线上测试资金、BIN 目录和普通 Slash 通知来源观察。通知消费及受控来源核验包含 Slash 只读 GET；不开放真实资金执行。完整范围见 [业务与路由](../../docs/business/routes-and-api.md)。

## 正式卡交易只读投影增量

新增独立渠道投影、显式连接读取权限和 MFA 校验，详情见 [发布及导入说明](../../docs/releases/channel-projection-2026-09-07.md)。该发布任务记录了获授权的迁移 002、手动导入及部署结果；不新增客户资金分录或在线上保存 Slash 凭据。本轮仅整理文档，没有重新执行迁移、导入、部署或本人登录业务验收。

## 已实现

- Cregis WaaS：签名/回调类型校验、只读流水客户端、`cmd/cregis-readonly` 单页核验命令；本地模拟测试通过，尚未接入 API 运行时或后台、尚未真实渠道验证。另保留 Team API 签名辅助函数。见 [接入边界](../../docs/integrations/cregis.md)。
- Firebase ID Token 验证适配器：校验撤销、邮箱已验证；本地用户禁用立即阻止后续请求。生产入口拒绝 Firebase Auth emulator 模式。
- 用户与客户主体分离：个人主体 / 企业主体，一个登录用户可以拥有个人主体并加入企业。
- 个人所有权、企业有效成员、运营按主体/资源显式授权。运营查询额外要求 MFA。
- 身份及可访问主体、账户列表、交易列表；金额用最小单位字符串输出，USD 2 位、USDT 6 位。
- 运营总览 `GET /admin-api/v1/ops/overview?days=7|14|30`：现有 USD 交易投影的服务端聚合，沿用逐客户 `transactions:read`、MFA 和审计；按香港自然日统计成功交易流入/流出及状态分布。完整性、渠道结算、商户、卡片和客户运营指标尚不可用，见 [总览契约](docs/operations-overview.md)。
- 个人升级企业：持久化提交和最新申请查询，UUID 幂等键、并发重复保护、原子审计。
- 版本化 PostgreSQL 迁移、跨主体外键、健康检查、优雅退出、Docker 构建定义。

## 尚未完成 / 禁止作为生产验收结论

Firebase 密码/TOTP 登录、Go 身份与范围查询已有真实签名联调记录，基础设施已部署；个人开户申请、运营审核及功能资格已有后续实现；企业材料审核/激活、完整成员权限管理及真实卡片/资金执行仍未完成。普通 Webhook 与异步只读采集已上线，前端投影持续更新与历史全量同步不能据此视为完成。企业升级提交中的 `legalName` 只是第一阶段意向申请，不是完整 KYB 材料。

数据库 `transactions` 是只读业务查询投影，不是资金账本；独立线上测试余额及模拟命令不写该投影，也不构成真实资金执行。审批通过与服务激活为独立状态，不会自动迁移个人资金。企业成员当前三个角色都只有整个所属企业的查询能力；受限子账户成员权限与写权限后续单独实现，不能提前分配给需要更小范围的成员。

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

默认端口 8870，`GET /healthz` 检查进程；当前 `database.Ready` 在 2 秒内核验 001–005、007、011、012 的存在及 checksum，启用 ledger 时额外核验 006。这不是全部模块迁移检查，不能由 readyz 成功推断 008–010 或上游业务已验收。API 启动不自动执行迁移，也不自动创建用户/成员/运营权限。

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

Slash Python 采集工具及隔离 Node 服务源码已恢复到 services/local-workspace，私有 SQLite 及凭据未迁入；历史记录见 [Slash 本地投影档案](../../docs/frontend/slash-live-data.md)，不能按其旧路径运行本服务。当前机器契约仍有“未部署”的陈旧 servers 描述；实际部署以 [部署记录](../../deploy/README.md) 为准，本次 Markdown 校对不修改 JSON 契约。

## 2026-09-13 开户审批权限授权

`api grant-existing-onboarding` 仅在明确设置 `CONFIRM_EXISTING_CUSTOMER_SCOPES=yes` 后执行一次受控授权：沿用现有 active 运营的个人客户 accounts:read / transactions:read 范围，幂等添加 onboarding:review 并原子记录用户授权审计。跳过客户所有人、企业成员、停用身份和企业客户。不在迁移或启动时自动运行，不包含未来客户，也不审批或开通客户。生产运行依据用户本次“沿用现有后台账号和客户范围”的明确确认。客户端提交后，运营仍需 MFA 并填写审批说明。

## 2026-09-13 两角色候选

新增 users.role（customer/admin）；两端身份 GET 分别为 `/client-api/v1/me` 与 `/admin-api/v1/me`。跨端角色拒绝，管理员继续按 MFA 和已有资源范围授权。保留渠道与开户接口；只新增 004，不改已应用 001–003。迁移、备份和发布顺序见[联合发布记录](../../docs/releases/2026-09-13-admin-login-joint.md)。

## 注册用户目录与 005

`GET /admin-api/v1/users` 供所有 active admin 经 MFA 查看客户用户基础资料，复用 Firebase Admin SDK 的 GetUsers/GetUserByEmail，已有及后来注册的用户均可查询。精确邮箱搜索可识别仅存在于 Firebase、尚未完成本地注册的身份。不会写入客户或自动授权；业务关联详情保持 staff_grants。新增 005_user_directory_audit，/readyz 要求版本 005；发布前显式迁移。身份服务失败或审计提交失败返回 503，不把失败伪装为空列表。官方依据：https://firebase.google.com/docs/auth/admin/manage-users 。

注册用户查询支持 `userId` 精确过滤（与 email 互斥、offset=0），用于后台直接加载用户详情。权限与审计规则保持一致，无新增迁移。

## 2026-09-17 Blnk 本地影子账本

新增用户钱包、多卡/在途分户、持久化记账任务与恢复、本地账本核对、独立授权的双端只读接口。默认关闭，仅支持本地隔离 shadow 库；现有账户/交易投影不切换为资金账本。说明与命令见 [Blnk 接入](../../docs/integrations/blnk.md)、[本地环境](../../deploy/blnk/README.md)，机器契约见 [ledger.openapi.json](docs/ledger.openapi.json)。真实 Blnk 集成验收运行 `bash scripts/test-blnk.sh`，普通 `go test` 缺少环境变量时会跳过该项。

## 2026-09-18 运行优化发布候选

API 支持 `DB_MAX_CONNS`（默认 5，范围 1–100）；按进程配置，总预算需包含所有副本及 Blnk。`/readyz` 在 2 秒内核验最新 main 的迁移 001–005 checksum；启用 ledger 时额外核验 006。此前旧本地 003/004 编号不适用于本次发布，既有 SQL 字节保持不变。就绪检查不执行迁移，不代表上游或业务验收。

Docker 镜像包含 api、ledger、worker 三个程序，默认入口仍为 api。worker 为独立 shadow 任务消费程序，具备超时、重试恢复及 JSON 队列/连接池观测；`ledger status` 为受信本地只读观测。两者继续保留本地隔离保护，不允许通过此次部署启用生产账本。云端不新增不可运行的 Worker 服务。

验证命令包括 scripts/test-blnk.sh、scripts/test-runtime-restore.sh、scripts/test-worker-runtime.sh，分别验证真实本地 Blnk、合成应用库恢复及实际 Worker 进程。见 [运行手册](../../deploy/blnk/monitoring-and-recovery.md)。

## 2026-09-18 客户卡片测试快照

新增受控 `api card-bindings-plan` / `api bind-card-snapshot` 与客户只读卡片、关联交易接口；流程和边界见 [FLOW-CARD-TEST-01](../../docs/business/customer-card-binding.md)。CLI 要求 BIND_EMAIL，由服务端 Firebase 核验已验证且未禁用邮箱；不接受调用方自报 UID。执行另需 BIND_CONNECTION、BIND_REVISION、BIND_EXPECTED_CARDS、BIND_REASON。目标必须已有 active/customer 登录身份及个人主体，不修改角色或审批，不接管资金归属。

生产本次仅显式应用 007 及登记 checksum；006 影子账本不属于本次范围，不能使用全量 `api migrate` 顺带执行。新版本 readiness 要求 007，先迁移后部署。已有 001–005 字节及 checksum 保持不变，回退旧 API 时保留新增授权和审计表。

## 线上测试余额

受控 `migrate-test-wallet` / `test-wallet-plan` / `grant-test-wallet` 命令和独立客户 GET 查询。仅008测试表，不启用 Blnk 或任何真实资金接口。配置、幂等和验收见[流程](../../docs/business/online-test-wallet.md)。

### 正式登录后的线上测试资金

见 [FLOW-TEST-FUNDS-01](../../docs/business/online-test-funds.md)。`migrate-test-funds` 仅补充 008/009，跳过尚未启用的 006 影子账本。所有测试资金写入在独立表内；不调用付款、发卡或渠道接口。

客户及后台分别访问 `/client-api/v1/customers/{id}/test-funds`、`/admin-api/v1/customers/{id}/test-funds`；订单详情 `/orders/{orderId}`；POST `/commands` 必须带 UUID `Idempotency-Key`。后台还要求 MFA 和逐客户 `online_test_funds_review_grants`。固定测试报价、金额精度、状态与幂等契约见流程卡和 OpenAPI。

对已有线上测试账户启用既有开户审核人：先使用 `TEST_WALLET_EMAIL` 执行 `test-funds-review-plan`，核对唯一的 `eligibleReviewerIds`，再设置 `TEST_FUNDS_REVIEWER_ID`、`CONFIRM_ONLINE_TEST_ONLY=yes` 执行 `enable-test-funds-reviews`。此命令不会新增真实资金权限，也不会开通客户服务。

## Slash 普通通知

新增 `/webhooks/slash` 的验签收件箱及只读异步 GET。独立于账本和前端投影，操作、HTTP 契约、迁移和回退见 [上线记录](../../deploy/slash-webhook-online-2026-09-18.md)。密钥仅从服务端 `SLASH_API_KEY` 读取。

## 项目主钱包与逐卡分配（本地候选，未部署）

新增迁移 011；Ready 要求其 checksum。`api project-wallet-plan` 和 `api project-wallet-apply` 从 stdin 接受严格 JSON：`targetEmail`、`assignment`、`expectedPlan`。assignment 必填 connectionId/accountId/virtualAccountId/label/revision/cardIds/reason/evidenceRef。plan 不写库，输出 hash；apply 要求相同 hash。运行凭据为既有 Firebase、DATABASE_URL、PROJECTION_OPERATOR_UID、服务端 SLASH_API_KEY；每次仅 GET 核验指定 virtual account 与父账户及名称匹配且未关闭。不输出密钥和银行账号，不调用 Slash 写接口。

首次将 APEXIS Op 配置为项目共用钱包时，仅把已审阅的当前卡 ID 清单分给指定用户。后续对其他用户再次运行固定清单分配，不设默认收卡用户；缺失来源 wallet 标识时拒绝。既有钱包禁止静默换连接。详情见 [FLOW-WALLET-001](../../docs/business/project-wallet.md)。现有测试资金开卡保持模拟，真实 Slash 开卡尚未接通。

## 2026-09-18 BIN catalog

新增正式 `/card-bins` 管理页与 `/admin-api/v1/card-issuing` 契约；来源目录导入使用 `issuing-admin import-catalog`。未配置价格以空字符串传输、数据库 NULL 保存，与免费 `0` 区分。生产保持真实发卡执行关闭。详见 `docs/business/bin-catalog-sync-2026-09-18.md` 与 `services/api/docs/issuing.openapi.json`。

## 2026-09-18：后台用户归属读取修复（代码已发布）

正式 channel-projections 卡列表、卡详情及交易查询从既有 project_wallet_cards / 有效 customer_card_bindings 读取归属，返回 assignmentKind 与 internal.ownershipStatus/customerId/userId/customerName。后台列表、详情和交易抽屉显示同一用户；新导入保留绑定，客户端原有范围与字段裁剪不变。无新迁移、改绑或资金操作。实现与验收见 [流程卡](../../docs/business/card-owner-display.md)。

## 客户端开卡运行与定向迁移

API 初始化独立 issuing 服务；`issuing-worker` 运行持久化发卡任务，默认 ISSUING_MODE 关闭。live 要求独立 TLS Blnk、运营验收清单和对应供应商服务端凭据，不可把本地测试结论填成生产认证。新增迁移014；本发布不包含并行013，迁移器使用显式编号。`scripts/issuing-checkout-sql.py` 只生成014，`scripts/test-issuing-checkout-migration.py` 与 `scripts/test-issuing-catalog-release.py` 验证本机随机隔离库。见[流程](../../docs/business/client-card-issuing.md)及[生产迁移记录](../../deploy/2026-09-18-issuing-checkout-migration.md)。

## 开卡只读准备模式（2026-09-18已部署）

`ISSUING_MODE=prepare`需有效HTTPS账本URL、密钥和可选专用CA（ISSUING_BLNK_CA_PEM）。API保持开卡不可执行；issuing-worker每分钟仅做认证GET与只读数据库查询。live仍要求真实验收清单。独立Worker使用`Dockerfile.issuing-worker`。`Dockerfile.blnk-tls`在原固定Blnk镜像内增加5443私有TLS入口，证书私钥只进服务端环境，见[生产准备](../../deploy/2026-09-18-issuing-preparation.md)。
## 资金中心接入准备（未激活）

新增 015 迁移及双链/卡片资金 Worker 增量，配置、零期初登记、恢复边界与验收清单见[资金中心运行说明](../../docs/business/funds-center.md)。默认仍不启用 live；本批没有执行生产迁移或渠道金融写入。`crypto-worker enroll-zero-card` 为受信运维入口，不是公共 API；拒绝非零或已消费的存量卡。

## 地址独立模式

新增不执行资金的DEPOSIT_ADDRESS_MODE=observation，使用既有资金表与独立回调；显式迁移与导入命令见[地址接入](../../docs/business/deposit-address-integration.md)。不以地址开通代表正式账本激活。

## 余额查询与人工资金（2026-09-18，代码已发布，真实执行未启用）

新增016迁移（订单、幂等命令、独立权限、不可变审计），API不自动迁移，readiness未强制新增依赖。`manual_funds_grants`默认为空，逐客户或全局read/create/review/execute须受控配置，现有admin身份不自动获得资金权限。不得在生产盲跑全量迁移。

复用ledger配置；shadow仅隔离验证，live额外要求`MANUAL_FUNDS_ENABLED=true`且不绕开已有live验收/Cregis/期初依赖。独立`go run ./cmd/manual-funds-worker drain`或`run`恢复持久订单，镜像包含二进制但不自动启动；不调用银行、Slash或链上付款。线下付款需人员另行付款并提交结果凭证。参见[机器契约](docs/manual-funds.openapi.json)及[完整流程/测试/交接](../../docs/business/platform-advance.md)。

TRC20限额充值使用`api prepare-deposit-pilot`核验零期初，再开启`DEPOSIT_PILOT_MODE=enabled`；API内部每15秒执行指定客户/地址的最终性及入账任务，无出金writer。配置、限额、恢复及关闭见[地址流程](../../docs/business/deposit-address-integration.md)。不设置全量资金认证标志，不自动执行数据库迁移。

## 卡片状态同步

017保存当前状态；018新增持久卡片命令并取消周期补查。API启动校验018；`api migrate-card-controls` 只安装018，要求已安装002/010/011/017，不自动安装资金迁移。既有同步映射保留，操作开关默认关闭：设置 `CARD_SYNC_CONNECTION` 后运行 `api slash-webhook-enable-card-controls`，核验连接账户/项目钱包匹配后启用。Worker每5秒处理队列，空队列不查询Slash；通知、手动核对和命令结果恢复只查询对应卡片。PATCH前持久submitted，超时/重启不重发，12次未确认进入review；手动GET或Webhook观察到目标状态可解除。checkedAt不按时间判过期。详见[流程与限制](../../docs/business/card-state-sync.md)。

`FUNDS_DISPLAY_MODE=production`关闭test-wallet/test-funds读取及写入；crypto GET可读取限定充值的正式账本，POST仍受独立启用限制。此展示切换不执行迁移、不创建期初金额、不修改充值额度。见[生产展示](../../docs/business/funds-center.md)。

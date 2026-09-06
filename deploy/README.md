# Moventra 部署记录

2026-09-07（香港时间）。本轮经用户“部署”授权发布基础设施和前端快照；不代表真实登录或金融业务验收。

## 已发布

- 网站：https://moventra.apexisnetworking.work
- 登录页：https://moventra.apexisnetworking.work/login
- Cloudflare Worker：`moventra-web`，版本 `94f4fd77-64f4-4b30-bc55-08df57eb693a`。
- API：https://moventra-api-ejeq.onrender.com
- Render 服务：`srv-daepgj8u01pc73fgdhsg`，Singapore / Starter，deploy `dep-daepgk0u01pc73fgdjg0` 状态 `live`。
- PostgreSQL：`dpg-daepg09t0dsc73b7q55g-a`，17 / Basic 1GB / 20GB，Singapore。位于用户指定项目 `prj-daep4m8n74is73es7g1g` 的 Production 环境，公网 IP 白名单为空。
- 首次新空库 `api migrate` 成功；已清除 pre-deploy command，后续迁移需单独检查批准。
- Firebase 项目 `edi-gws-20260309-hk`，Web 应用 `moventra-card-bin`。Render 使用专用服务账户 `moventra-auth-reader`，仅授予 `roles/firebaseauth.viewer`，通过 Secret File 注入；未使用个人 CLI 凭据或管理员密钥。

## 源码与发布范围

GitHub：https://github.com/ediya204/moventra-card-bin 。Go 运行版本 `3fd2363`，前端和网关快照 `d35c451`；后续文档提交不改变运行产物。Render 自动部署关闭，避免未经验证的共享目录变化直接上线。

同目录另有前端任务在开发，发布使用 `/tmp/moventra-release-20260907` 的独立 `codex/deploy-web` worktree。主工作目录的未提交开发保留，没有重置或覆盖。原主工作目录本地 main 保留原提交；已发布源码以 origin/main 与发布 worktree 为准，不可直接覆盖本地未跟踪文件。

公开仓库仅包含经检查的 Go 基础、React 前端、文档和部署配置；没有上传本地数据库、真实 Slash 快照、渠道凭据、服务账户私钥、旧 `zttrust_manage_front` 或本地 Demo 服务。React package.json 中 Demo 脚本属于本地开发入口，当前发布源码快照不包含其服务文件。

`render.yaml` 保存资源设置；本次通过 CLI 在既有项目中创建资源，没有关联 Blueprint 自动同步。新建环境必须先配置 Secret File 并对新空库显式初始化；不要直接将生产初始化命令永久加入启动流程。

## 本轮验证

- Go：隔离 PostgreSQL 集成测试及 race、`go vet`、编译通过。测试验证权限/MFA逻辑，不代表真实 Firebase 登录联调。
- React：主目录重新构建通过；独立发布快照全新 TypeScript/Vite 构建通过。存在大于 500KB chunk 提示。
- 网关：6 个测试通过；Wrangler production dry-run 通过。
- Render：Docker 构建、迁移、进程启动及 deploy live 已确认。
- 线上 `/healthz`、`/readyz` 返回 200 JSON；API 直连与同域网关的无令牌/无效令牌请求均返回 401。
- 同域旧 `/admin-api/login` 和 `/local-slash-demo/management/live` 返回 404，不会转发到旧系统或本地 Demo。
- 浏览器实际确认官网及登录页面渲染；curl 确认 `/`、`/login`、`/portal` 返回 HTML 200。未将 portal HTML 可访问视为客户业务验收。
- 初次 Python urllib 请求被边缘返回 403；未改 WAF，curl 与实际浏览器验证通过。Render 首次切换期间出现一次 readiness 502，服务 live 后复测为 200。

## 首轮部署时的业务待办（历史，当前状态见下方登录切换发布）

登录页面仍调用旧接口，当前域名无法使用旧管理员账户完成登录。Firebase SDK 初始化不是登录切换；下一步需接入 provider、真实用户 ID Token、Go 用户/主体映射、运营 MFA、资源授权和撤销验证。

没有创建业务用户或运营授权，没有导入本地真实金融数据，没有验证真实渠道或执行真实资金操作。客户端和新管理模块中的本地 Demo 不构成生产能力。

## 后续发布

从经审查的源码建立独立快照，前端 `pnpm build` 后进入 `deploy/cloudflare` 运行 `npm test`、`npx wrangler deploy --env production --dry-run` 和已授权的正式发布。运行配置的 API_ORIGIN 指向上述 Render 服务，compatibility_date 使用 UTC 已到达日期。

Render 后续代码发布使用指定 commit 的手动 deploy，并确认 `/readyz`、未认证拒绝、业务授权和日志；迁移另行审批。不能把部署检查通过当作登录和金融验收通过。


## Firebase 登录切换发布（2026-09-07）

运行代码 `03227e0` 已发布：Cloudflare `b8916ce0-5d68-4848-9265-9841af4cb0ce`；Render deploy `dep-daepon5g1s2s73da7e20` 为 live，健康检查通过。本次没有结构迁移。

登录已从旧接口切换为 Firebase 邮箱密码 + TOTP，登录后的 `/session` 展示已接入的身份、MFA、客户与运营授权范围及只读查询。生产旧工作台/portal 路由转向该入口；本地显式开发 Demo 保留。尚未接入的新业务模块不随身份登录自动开放。

真实验证：16 项 Firebase 签名/TOTP + 本地隔离 PostgreSQL/Go 检查通过；包括真实密码、错误密码、TOTP 绑定/挑战/错误码、跨主体与资源越权、停用、撤销、伪造 MFA 声明及运营审计。一次使用绑定验证码立即登录被 Firebase 拒绝，改为等待下一验证码后通过，页面已有对应提示。所有临时测试身份和本地数据库已清理。

线上追加验证：临时已验证 Firebase 用户通过 CF 网关与 Render 直连均返回 403 `user_not_enabled`，证明身份验证不自动产生业务授权；该身份已删除，测试没有写生产用户/客户/授权表。浏览器确认新登录页及错误凭据提示，密码提交后清空。

用户指定的首个邮箱已在 Firebase 创建（初始邮箱未验证），受控 Render job `job-daepqadg1s2s73dad4tg` 成功开通对应 Go users 身份。仅此实际用户身份写入生产；未分配客户、成员关系或 staff_grants。首个任务因命令环境变量前缀未被执行器接受而失败，改用显式 `env ... api provision-user` 后成功，任务日志确认仅身份开通。没有发送邮件或保留/展示生成密码，持有人需在页面请求密码设置邮件并自行完成邮箱验证及 TOTP 绑定。

生产数据库继续关闭公网访问；外部只读查询工具无法连接，未为验证而开放 IP 白名单。身份开通以受控任务成功及其日志为证据。本人首次登录、邮箱验证和验证器绑定尚待持有人完成，不能用测试身份替代。

本地同步采用内容比较与三方合并，仅 App.tsx 的路由变更手动按精确片段合入，保留并行任务新增的 LegalPage 路由；发布版本不含那部分后续开发。主目录依赖出现系统 dataless 占位导致构建停滞，因此前端与 Wrangler 在发布 worktree 中独立重新安装后验证，未覆盖共享 node_modules。

可重复线上拒绝检查：`RUN_DEPLOYED_AUTH_TESTS=1 FIREBASE_PROJECT_ID=edi-gws-20260309-hk node adsflow-admin-react/tests/firebase-deployed.mjs`。需要指定项目测试身份管理权限，只创建并清理云端临时身份，不修改生产数据库。

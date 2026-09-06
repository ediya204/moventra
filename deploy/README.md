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

## Google 登录与注册分流发布（2026-09-07）

- 运行代码：`1d2471a6fa3e8b4ceece3c075f22dbdc953e0465`，已推送 origin/main。
- Render：`dep-daepu0tbedkc73e8hq1g`，状态 live；`/readyz` 返回 ready。
- Cloudflare：`b3e74009-3e85-417b-90c3-e193083b232e`，正式域名 https://moventra.apexisnetworking.work。
- 独立发布目录 `/tmp/moventra-registration-publish` 从最新远端克隆，只纳入 Google 登录、注册分流、相关契约和测试；保留共享目录的其他开发。
- 本轮验证：前端构建与状态分流测试通过，7 项网关测试通过，隔离 PostgreSQL race/并发注册与权限测试通过，go vet 与 Wrangler dry-run 通过。首次 dry-run 早于构建完成因 dist 不存在退出，构建完成后重跑成功。
- 线上验证：正式登录页显示 Google 按钮；网关与 Render 注册接口均拒绝无凭据请求（401）；旧登录接口仍为 404。临时已验证 Firebase 身份经网关和 Render 直连 `/api/v1/me` 均为 403 registration_required，测试身份已清理，没有写生产 users/customers/grants。
- 本次没有结构迁移、生产业务身份测试写入或真实资金操作。Google 本人选账号、密码关联和实际注册提交仍待用户验收；不以负向身份测试代替完整注册验收。
- 如需回退：Go 上一运行提交 `03227e0663cdb9c98936a611b65f401aa0cd37e2`，Cloudflare 上一版本 `b8916ce0-5d68-4848-9265-9841af4cb0ce`；应成对回退，避免错误码/路由不一致。

### 2026-09-07 独立域名发布

- 后台 `admin.moventra.apexisnetworking.work` → Worker `moventra-admin`，版本 `301fc700-32bd-4a9c-b31d-61851f8b4c75`。
- 客户端 `moventra.apexisnetworking.work` → Worker `moventra-web`，版本 `1ce0ef65-58a1-4a80-af06-22bcf7aa34d0`。
- 公共 DNS 已解析；通过解析出的 Cloudflare IP 保留原域名/SNI 实测 HTTPS 登录页 200；内置浏览器显示“Moventra 运营后台登录”。本机解析器曾缓存无记录，不能用该缓存否定权威绑定成功。
- 两端独立构建/内存会话/网关业务路由；Go 授权仍是最终边界。共享身份项目，不宣称独立用户库。
- Firebase 后台域名已授权。两端构建及 9 项网关测试通过；未部署 Go、未迁移数据库、未修改真实用户权限、未访问真实资金接口。
- 详细命令与账户开通边界见前端 `docs/firebase-setup.md`。域名可访问不等于管理员业务授权已完成。
## 受控个人主体关联（2026-09-07）

用户明确选择个人用途后，为指定已验证身份执行受控个人主体关联。运行提交 `3d24ee0`；Render deploy `dep-daeq0ugu01pc73figlf0` 为 live；一次性任务 `job-daeq1ulg1s2s73db57ug` 为 succeeded，日志确认 personal subject linked。主体关联使用事务及唯一所有权，新增主体为 draft/inactive，仅首次创建写入审计；不创建资金账户、运营授权或真实交易，无结构迁移。目标身份与主体 ID 留在受控任务日志，不写公开记录。

本轮隔离 PostgreSQL race/五并发幂等测试、停用与不存在身份拒绝、服务不激活、审计单次落库和既有权限回归通过；go vet 通过，线上 readyz 正常。初次新增测试影响共享测试样本计数，补充该测试自身数据清理后重跑全部通过。本轮未发布前端或 Cloudflare；并行域名发布结果见上节。本人工作台可点击“刷新身份和权限”读取个人范围；未代替用户完成页面登录验收。

## 客户端首页发布（2026-09-07）

代码 `7829ccc`，客户端 Worker `moventra-web` 版本 `5eaa10ed-560b-4032-8c5c-4c742b54384e`。个人/企业用户通过登录后从 /session 进入 /portal 真实客户端首页，安全设置位于 /portal/security。客户端构建、9项网关回归与 dry-run 通过；线上浏览器确认未登录 /portal 回到客户端登录页。未代替本人完成认证后首页验收。仅发布客户端，没有重新部署运营 Worker、Go、数据库或权限。共享 App.tsx 通过精确路由补丁保留其他页面改动。
## 实际账号授权（2026-09-07）

在用户明确指定并授权的独立管理员身份与客户身份之间完成受控配置。Firebase 管理员身份已创建，本地身份任务 `job-daeq4bid0e5s739i82b0` 成功；运营授权任务 `job-daeq4jf40ujc7389jj9g` 成功，日志确认两项客户只读权限、客户端无 staff_grants、MFA 仍强制。邮箱与 UID 不写入公开部署记录。

Go 运行提交 `3897fe1d3df5071f7aa572eb141c270ea753ba24`，部署 `dep-daeq33on74is73f097u0` 为 live，readyz 正常。没有结构迁移或真实资金变更。首次组合 shell 任务因 Render 参数解析失败而未执行命令，改为单命令任务后成功。

本次隔离 PostgreSQL race 测试通过，覆盖指定客户授权、重复授权、角色混用拒绝、MFA 拦截、跨端/跨客户拒绝及审计失败事务回滚；go vet 和 go build 通过。真实目标管理员尚需本人设置密码、验证邮箱和绑定 MFA，不以授权落库代替本人登录验收。

后台域名 HTTPS 再次验证 200；独立 Worker 与 Firebase authorizedDomains 配置沿用上节已发布版本。

授权重复执行任务 `job-daeq4r5g1s2s73dbearg` 同样 succeeded，返回同一客户范围。授权函数 ON CONFLICT 不重复插入，只有新授权才写审计；本地数据库测试已核验授权和审计数量不增加。

## 后台登录放行修复（2026-09-07）

原页面在 Firebase 返回 User 后先进入 /session，再显示 Go 权限拒绝，容易误以为客户端已登录后台。现改为先等待 Go 确认运营权限；拒绝或异常时退出本地 Firebase 会话，清除用户/权限并在登录页显示错误。只有运营且 MFA 完成才设置 authenticated profile；未完成邮箱验证/MFA 的设置流程不代表后台业务访问已放行。空邮箱/密码禁用提交。

后台 Worker 版本 `9bd2b03e-6d5d-4f54-8660-e7cb159fa8c5` 已部署。React AuthProvider 回归覆盖等待、普通客户拒绝/退出、运营放行、MFA 待设置、接口异常退出；注册分流测试、9 项网关测试、TS/Vite 构建及 dry-run 通过。SDK 与 Go 响应在组件回归中为测试替身，不代表本人密码/MFA 登录验收；未重置真实用户密码、MFA 或业务权限。仅发布后台 Worker，保留客户端独立发布版本。


## MFA 前拒绝客户端邮箱（2026-09-07）

后台 Worker `07421c0b-c911-4514-b157-ecfcfb48ad66` 已部署。构建配置已批准的运营邮箱列表，在 Firebase 密码请求前拒绝其他邮箱；后台关闭 Google 入口及对应调用，客户端不变。Go 后置鉴权保留，前置邮箱列表不作为服务端安全边界。

本次 13 项组件/配置/注册/网关测试、后台 TS/Vite 构建与 dry-run 通过。线上浏览器用指定客户端邮箱和明确非真实测试密码提交后，显示“此账号没有运营后台权限，请使用客户端入口”，URL 保持 /login，没有 MFA 表单。未使用、索取或更改用户真实密码/验证码。

## V1 个人账户与团队功能下线发布（2026-09-07）

运行源码 `c933ce5` 已推送 origin/main，基于最新 `a5f09b9` 保留后台登录前置限制。发布目录 `/tmp/moventra-v1-publish`；共享开发目录的后续客户端重构与报价变更未混入本次部署。

- 客户端 https://moventra.apexisnetworking.work ：Worker `moventra-web`，版本 `6bf1f4ca-0adb-4ce1-92ff-6dc872ffa214`。
- 后台 https://admin.moventra.apexisnetworking.work ：Worker `moventra-admin`，版本 `f609e815-969f-401b-bceb-3f5de15a5e8c`。
- 17 项发布回归、两端 TypeScript/Vite 构建及 Wrangler dry-run 通过。保留现有大 chunk 警告。后台沿用已部署的运营登录邮箱配置，经线上产物与原构建字节比对确认；配置值不写入公开文档。
- 正式域名登录 HTML 和入口 JS 均与本次构建一致；两端无令牌 me 为 401，旧团队和本地 Demo API 为 404；Render readyz 正常。
- 浏览器验证 `/portal/team/invite` 与后台 `/teams/demo/members` 在未登录状态均回到各自登录页面并正常渲染；后台运营提示与无 Google 登录入口保留。
- 本机 DNS 仍有后台域名负缓存，HTTP 验证使用公共 DNS 解析地址并保留正式域名/SNI；没有修改 DNS、WAF 或 Access。
- 未部署 Go、未迁移数据库、未变更权限或真实资金。本人认证后的完整业务与真实通道验收未执行；本地 Demo 金融模块仍不属于已接入生产能力。

字段与历史依赖保留范围见 `adsflow-admin-react/docs/v1-personal-release.md`。需要回退时，客户端上一版本 `5eaa10ed-560b-4032-8c5c-4c742b54384e`；后台上一版本 `07421c0b-c911-4514-b157-ecfcfb48ad66`。

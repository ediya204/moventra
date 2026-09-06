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

## 尚未上线的业务闭环

登录页面仍调用旧接口，当前域名无法使用旧管理员账户完成登录。Firebase SDK 初始化不是登录切换；下一步需接入 provider、真实用户 ID Token、Go 用户/主体映射、运营 MFA、资源授权和撤销验证。

没有创建业务用户或运营授权，没有导入本地真实金融数据，没有验证真实渠道或执行真实资金操作。客户端和新管理模块中的本地 Demo 不构成生产能力。

## 后续发布

从经审查的源码建立独立快照，前端 `pnpm build` 后进入 `deploy/cloudflare` 运行 `npm test`、`npx wrangler deploy --env production --dry-run` 和已授权的正式发布。运行配置的 API_ORIGIN 指向上述 Render 服务，compatibility_date 使用 UTC 已到达日期。

Render 后续代码发布使用指定 commit 的手动 deploy，并确认 `/readyz`、未认证拒绝、业务授权和日志；迁移另行审批。不能把部署检查通过当作登录和金融验收通过。

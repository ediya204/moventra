# Moventra

项目定位见[项目说明](project.md)，当前能力见[状态摘要](docs/current-state.md)，AI 工程协作与文档维护见[Harness](docs/harness/README.md)。

运营后台、个人客户端与 Go API，共用一个 GitHub 仓库，统一在 `main` 维护，各自独立构建与发布。

```text
apps/
  client/                 客户端与官网：独立入口、路由与构建
  admin/                  运营后台：独立入口、路由与构建
services/
  api/                    Go API、授权、审计与 PostgreSQL
packages/
  shared/                 共用认证、UI、主题、类型与数据适配
  assets/                 共用品牌素材与字体相关静态文件
  tooling/                Vite 配置
tests/frontend/          登录、权限和个人版本回归测试
deploy/                  Cloudflare、Firebase 与 Render 配置
docs/                    开发规范、接口与历史功能记录
```

## 开发与验证

需要 Node.js 22+、pnpm 10.32.1、Go 1.26.5；数据库测试需要本机 PostgreSQL。

```bash
pnpm install --frozen-lockfile
pnpm dev:client                   # http://127.0.0.1:8853
pnpm dev:admin                    # http://127.0.0.1:8850
pnpm build:client
# 角色由 Go 服务判定，无需前端邮箱名单
pnpm build:admin
pnpm typecheck
pnpm test
bash services/api/scripts/test-postgres.sh
```

`apps/client/vite.config.ts` 固定客户端身份，`apps/admin/vite.config.ts` 固定运营身份，不通过同一个 App 切换两端路由。后台以 Go 返回的 admin 角色决定准入。客户端保留 Google 登录，后台使用运营邮箱密码和 MFA。Firebase 身份项目共用，Go 的客户归属、运营资源授权和 MFA 是最终数据访问边界。

`pnpm check:boundaries` 禁止两端相互引用源码、共享包反向依赖应用，并检查本地导入路径。共享库变更需验证两端；单端变更可独立发布。开发 Demo 只在开发模式使用，生产构建不打包 Demo 页面。

## 发布

官网 `https://moventra.me/` 已绑定现有客户端 Worker，根路径展示官网，`/login` 为客户端登录。2026-09-07 已验证权威 DNS、HTTPS 200 和 Chrome 官网渲染，并加入 Firebase authorizedDomains。`www.moventra.me` 同样展示官网；`admin.moventra.me/login` 已绑定独立运营后台并通过 Chrome 页面验证。三个新域名均已加入 Firebase 授权，旧入口保留过渡。

- 客户端：`moventra.me` → Cloudflare Worker `moventra-web`。
- 运营后台：`admin.moventra.me` → Worker `moventra-admin`。
- Go：Render `moventra-api`，仓库根目录设置为 `services/api`，分支为 `main`。
- Cloudflare 资源配置分别读取 `apps/client/dist` 和 `apps/admin/dist`。
- 数据库、Firebase 项目 ID、应用 ID、服务账户与实际云资源 ID 不随源码重命名；不得通过重命名重建数据或身份。

详情见 [部署配置与证据](deploy/README.md)、[开发总纲](docs/DEVELOPMENT.md) 和 [Go API](services/api/README.md)。

## 当前能力与文档

更新日期：2026-09-18。当前能力与证据统一见[状态摘要](docs/current-state.md)，开发思路见[项目说明](project.md)，专题见[文档索引](docs/README.md)。本次按本地 main `89ca9c3` 静态核对，未重新检查线上服务。

身份、开户、客户/渠道查询、注册用户目录、后台卡片归属、测试资金和 BIN 目录各按独立授权开放。Slash 普通通知已有上线记录，但来源观察不自动更新页面投影或记账；真实资金、真实开卡及生产 Blnk 账本未因这些功能发布而启用。最新 API/后台运行代码记录为 `a2fa1f6`，见[发布证据](deploy/2026-09-18-session-consolidation.md)。

## 本地运行与 GitHub 边界

本仓库已恢复 `services/local-workspace` 的 Node/SQLite 隔离业务服务及 Python 采集工具。运行 `pnpm workspace:dev` 启动合成数据 API（8868）和后台（8850）；详情及环境限制见[服务 README](services/local-workspace/README.md)。私有配置、真实数据库、快照与凭据未迁入；旧 ADSFLOW 端口和数据不代表此项目环境。

正式 Go `/admin-api/v1`、`/client-api/v1` 与旧本地 `/local-slash-demo` 契约分别维护。源码、自动化测试、浏览器验收、真实渠道验证与部署分别报告；文档更新不构成新的发布或授权。

换电脑开发请从[换机交接](docs/harness/new-computer.md)开始；当前发布版本与待验收项已记录，无需迁移云端生产数据。

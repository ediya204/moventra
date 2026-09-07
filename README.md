# Moventra

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
# 设置已批准的运营邮箱列表后构建（此列表不是后端授权依据）
VITE_ADMIN_LOGIN_EMAILS="${VITE_ADMIN_LOGIN_EMAILS:?请配置批准的运营邮箱}" pnpm build:admin
pnpm typecheck
pnpm test
bash services/api/scripts/test-postgres.sh
```

`apps/client/vite.config.ts` 固定客户端身份，`apps/admin/vite.config.ts` 固定运营身份，不通过同一个 App 切换两端路由。后台未配置运营邮箱时拒绝全部账号。客户端保留 Google 登录，后台使用运营邮箱密码和 MFA。Firebase 身份项目共用，Go 的客户归属、运营资源授权和 MFA 是最终数据访问边界。

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

更新日期：2026-09-07。全站逻辑从 [业务总览](docs/business/README.md) 开始阅读，覆盖身份开户、卡片交易、资金订单、审批、风控、对账和系统管理。快速状态见 [当前功能与接入状态](docs/current-state.md)，专题入口见 [文档索引](docs/README.md)。

- V1 面向个人账户，不提供客户团队创建、邀请或协作；后台内部管理员、运营、财务和审批权限保留。费率方案统一从“费率管理”进入，底层继承关系保留。
- 正式后台 `/workbench` 已提供授权 USD 交易的资金流、活跃度与状态概览，沿用客户范围和 MFA；本地概览读取另一套 Slash 缓存。
- 已上传的正式 `/transactions` 和 `/cards/:id` 读取手动导入的渠道投影，另需渠道读取授权与 MFA；商户 Logo 仅辅助展示。源码、导入和部署证据见 [接入记录](docs/releases/channel-projection-2026-09-07.md)。
- 本地 Slash 仅手动同步。卡交易支持 7/14/30 天和自定义 UTC 日期、六类状态筛选；来源 status 与 detailedStatus 独立保留。
- 交易抽屉展示卡片名称和后四位，按来源连接内的精确卡片 ID 打开关联详情。本地所属用户读取内部绑定；正式渠道投影尚无客户绑定，不从 Slash 卡名推断。
- 卡 BIN 详情提供草稿、已上架、暂停开卡、已归档的状态维护；这是本站产品配置，不代表修改上游卡片状态或真实开卡。
- 卡片管理、BIN、费率、审批和资金原型在 DEV 模式保留；五标签卡工作台、解冻申请仍有本地未合入增量。正式构建提供身份、个人查询、运营概览及渠道只读页面，真实卡片控制和资金执行尚未接入。

## 本地运行与 GitHub 边界

本仓库包含两端前端、共享模块、Go 基础和文档。旧本地 Node/SQLite Demo 与 Python Slash 采集服务位于旧工作区，未迁入本仓库；其私有数据和凭据也不提交。克隆本仓库不等于拥有 8852 的完整业务后端。

文档中的旧 LOCAL 接口、迁移和测试命令需要相应本地服务；Go 渠道投影是独立契约，不兼容旧路径。GitHub 推送、构建、云部署和真实业务验收分别报告；本次文档整理不构成生产部署。

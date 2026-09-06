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

更新日期：2026-09-07。阅读 [当前功能与接入状态](docs/current-state.md) 和 [文档索引](docs/README.md)，区分正式基础、DEV 页面、本地服务与待实施方案。

- V1 面向个人账户，不提供客户团队创建、邀请或协作；后台内部管理员、运营、财务和审批权限保留。费率方案统一从“费率管理”进入，底层继承关系保留。
- 本地 Slash 仅手动同步。卡交易默认按 pending、settled、declined、reversed、refund、dispute 六类筛选；来源 status 与 detailedStatus 独立保留。
- 交易抽屉展示卡片名称和后四位，按来源连接内的精确卡片 ID 打开关联详情。所属用户读取内部数据库绑定，不从 Slash 卡名推断。
- 卡 BIN 详情提供草稿、已上架、暂停开卡、已归档的状态维护；这是本站产品配置，不代表修改上游卡片状态或真实开卡。
- 上述业务页面在 DEV 模式保留。正式生产入口仍是认证、个人查询及受授权运营查询；真实风控冻结、资金划拨、出金和解冻申请完整流程尚未接入。

## 本地运行与 GitHub 边界

本仓库包含两端前端、共享模块、Go 基础和文档。旧本地 Node/SQLite Demo 与 Python Slash 采集服务位于旧工作区，未迁入本仓库；其私有数据和凭据也不提交。克隆本仓库不等于拥有 8852 的完整业务后端。

文档中的 LOCAL 接口、迁移和测试命令需要相应旧本地服务。当前 Go 没有因此增加相同接口。GitHub 推送、构建、云部署和真实业务验收分别报告；本次文档与源码同步不构成生产部署。

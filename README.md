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

- 客户端：`moventra.apexisnetworking.work` → Cloudflare Worker `moventra-web`。
- 运营后台：`admin.moventra.apexisnetworking.work` → Worker `moventra-admin`。
- Go：Render `moventra-api`，仓库根目录设置为 `services/api`，分支为 `main`。
- Cloudflare 资源配置分别读取 `apps/client/dist` 和 `apps/admin/dist`。
- 数据库、Firebase 项目 ID、应用 ID、服务账户与实际云资源 ID 不随源码重命名；不得通过重命名重建数据或身份。

详情见 [部署配置与证据](deploy/README.md)、[开发总纲](docs/DEVELOPMENT.md) 和 [Go API](services/api/README.md)。

## 当前能力与文档

文档更新：2026-09-07。完整分类见 [文档索引](docs/README.md)。生产客户端为个人账户查询；企业模型和升级意向申请已在 Go 实现，企业审核、成员管理与客户端企业流程待接入。`/register` 仍是表单预览；Google 登录后的资料补全可创建本地登录用户，但不自动创建客户主体或业务账户。

运营后台目前开放认证、MFA 和按客户资源授权的只读查询；卡片、资金、审批、费率、消息和渠道管理仍为保留的原型或目标设计。真实账号授权任务的成功不替代持有人完整登录验收。

## 历史资料与本地工作

`docs/frontend` 保留各模块历史设计、Demo 与发布记录，历史描述不等于当前生产能力。部分旧本地 Demo 服务和私有数据从未纳入 GitHub，不会因本次目录整理被上传。真实交易、余额、卡渠道、资金写入仍以明确接入与验收范围为准。

新本地项目目录为 `moventra`；旧工作目录中的未提交实现、私有数据和并行工作保留，未被覆盖或迁入公开仓库。已应用迁移文件保持字节不变，以保留校验和；历史备份记录保留真实原文件名。

# Go API 验证与历史证据

更新日期：2026-09-07。当前命令在 `services/api` 执行：`go test ./...`、`bash scripts/test-postgres.sh`、`go vet ./...`、`go build -o bin/api ./cmd/api`。普通 go test 未提供 TEST_DATABASE_URL 时会跳过数据库项；脚本建立独立测试库并运行 race 测试。

最新目录重构版本 `be31513` 的历史记录包含两端构建、17 项前端/网关回归、Go vet/build 和隔离 PostgreSQL race 回归；详情见 [部署记录](../../../deploy/README.md)。当前测试代码含注册、受控个人主体/运营授权及审计回滚，已超出下方第一阶段范围。真实 Firebase 测试是单独 opt-in 脚本，见 [认证验证](../../../docs/frontend/firebase-setup.md)。

本次仅更新 Markdown 并检查文档，不重跑云端身份测试或生产业务验收。企业审核/激活、卡渠道和真实资金执行仍未完成。

## 2026-09-06 第一阶段历史记录

以下为原阶段快照；其中“尚未联调”“没有发布”等仅描述 9 月 6 日当时，已被后续发布记录更新。


范围：新增独立 services/api Go 模块；现有管理端与客户端演示未切换后端。

## 已执行

- `go test ./...`：通过；未设置 TEST_DATABASE_URL 的普通运行会跳过数据库集成项。
- `bash scripts/test-postgres.sh`：通过。PostgreSQL 17.9 随机独立数据库，使用 `go test -race -count=1 -v ./...`，24 个数据库子用例以及认证提前拒绝测试通过。脚本退出后查询确认无残留 moventra_test_* 数据库。
- `go vet ./...`：通过。
- `go build -o bin/api ./cmd/api`：通过。二进制位于忽略的 bin 目录。
- `npx --yes @redocly/cli lint docs/openapi.json --extends minimal`：通过，无警告。8 条路径、9 个操作。

## 已验证边界

个人只能读取自己的主体；有效企业成员可读取企业；客户端不能获得运营权限；运营必须有 MFA 与具体资源/客户授权；撤销成员和禁用用户被拒绝；未知查询条件不被忽略；金额超过 JavaScript 安全整数时仍以原始十进制字符串返回；运营审计不可用时不返回业务数据。

个人升级：四个并发同键提交产生同一个申请，只有一次创建和一次审计；不同内容复用键与不同键重复申请均冲突；其他用户不可代为提交或读取；提交不会新增企业主体或修改交易。数据库禁止跨主体账户父子关系和给个人主体添加企业成员。

## 未验证 / 未完成

- Firebase 使用可替换 verifier 进行接口边界测试；真实项目配置、真实签名/撤销/MFA 登录链路尚未联调。
- 企业升级审核、关联企业创建及服务激活尚无 API，只有数据结构约束和后续设计。
- Docker daemon 未运行，容器构建未验证；本机 Go 编译已通过。
- 没有发布 Git 提交、Cloudflare/Render 资源、生产迁移或真实资金操作。

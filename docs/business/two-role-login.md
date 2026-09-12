# 两角色与登录隔离

日期：2026-09-13。状态：已联合发布，生产记录见文末。FLOW-AUTH-002。

## 流程卡

| 项目 | 内容 |
| --- | --- |
| 目标及范围 | 客户、后台管理员分别登录各自应用；不扩大数据范围；联合版本隔离验证 |
| 基线 | `/Users/edi/Documents/ChatGPT/moventra`，main，ce0a88a；已有多项未提交前后台、网关与文档改动，逐文件保留 |
| 页面关系 | 客户 `/portal/login` → `/session` → `/portal`；管理员 `/admin/login` → `/session` → MFA → `/workbench`；安全页仍使用原路径 |
| 业务身份 | Firebase UID → users.id / users.role；customer/admin 为仅有应用角色 |
| 数据依据 | PostgreSQL 保存角色；staff_grants 是既有客户资源范围，不能授予应用角色 |
| 接口链 | AuthContext → liveApi → 本站 `client-api/v1/me` 或 `admin-api/v1/me` → 网关 → Go authenticate → users / 客户关系 / staff_grants |
| 状态及操作 | Firebase 未登录、邮箱未验证、待注册、错误角色、待 MFA、准入成功、停用、依赖失败；错误角色清空会话，客户端注册恢复保留 |
| 跨端变化 | 后端每次请求重新读取角色；管理员不能作为客户访问 client-api，客户不能访问 admin-api；身份不在网关改写 |
| 权限 | 客户归属保留；管理员 MFA、资源授权、审计保留；前端邮箱名单移除 |
| 验收 | admin-admission、gateway、TestPostgresBoundary、TestRoleMigration；两端类型检查、构建、浏览器登录入口已验证；真实 Firebase 登录未执行 |
| 迁移决策 | 用户已授权并完成发布；混合旧身份迁移明确报错，不自动删除客户归属或扩大权限 |

## 差异及兼容

旧版通过是否存在 staff_grants 推导 operator，前端额外使用邮箱列表，客户端网关又把 operator 改为 false。现在使用 users.role 单一应用角色，返回兼容 operator 字段；旧 `/api/v1/me` 保留真实角色，不允许伪装客户身份。

旧 `/login` 只重定向本站规范入口，不接受 next 参数指定外站。客户站访问 `/admin/*` 返回 404；管理员站访问 `/portal/*`、`/register` 返回 404。Worker 与本地 Vite 同时执行站点隔离；两端 Firebase 实例及内存会话继续独立。共享 Firebase 项目不代表 token audience 分离，接口安全依靠服务端角色、归属和 MFA。

正式生产路由不加载 DemoApp；其历史经办/审核/控制等测试角色不代表正式角色。本次不改动隔离 Demo 的资金审批策略。

## 迁移与发布次序

新增 `004_user_roles.sql`。联合发布以 GitHub main 399b6f9 为基线，保留已上线 001/002/003 的字节及 checksum；角色任务原先使用的 003 与开户迁移冲突，已改成新的 004。

迁移只回填既有管理员，不新增任何客户资源授权。旧身份混用会中止整个迁移事务；角色降级后再次运行迁移不会重新提升。受控 provision-operator 同事务设置 admin 并保留原客户范围/审计；provision-personal 拒绝管理员。

已获用户授权并执行：备份与混合身份检查 → 迁移 004 → API → 两端 Worker。新前端遇到旧 API 缺少 role 会拒绝准入，不能倒序发布。生产备份恢复及 004 校验已完成；真实 Firebase 登录测试仍未执行。

## 本次验证

- 自动化：临时 PostgreSQL race 测试已通过，包括角色回填、重复迁移、checksum、错误角色、MFA、数据范围、撤权、审计。
- 前端/网关：`pnpm test` 67 项通过，包含客户/管理员准入、注册恢复、网关隔离、旧入口跳转和原业务回归。
- 类型检查与两端构建：`pnpm build` 通过（两端脚本均先执行 tsc）。原工作区依赖目录阻塞 stat/readdir；使用 `/tmp/moventra-auth-validation` 中同一源码及锁文件，`pnpm install --frozen-lockfile --ignore-scripts --offline` 安装后验证，未改原工作区依赖；153 个前端源码/配置文件哈希对比一致。
- Go：`go vet ./...`、`go build` 通过。
- 浏览器：正式构建本地预览，客户 8953 `/portal/login` 显示邮箱/密码及 Google；管理员 8950 `/admin/login` 显示邮箱/密码且无 Google。两端 `/login` 均正确跳转。HTTP 验证对端入口及管理员 `/register` 为 404；内置浏览器对 404 导航报告拒绝加载。
- 真实 Firebase 账号登录、MFA 挑战及业务数据浏览器联调：未执行；角色链由认证组件自动化和隔离 PostgreSQL 测试验证，不冒充线上验收。
- 真实渠道：不适用，无渠道行为改动。
- 部署：源码 `85ccf6e` 已发布到 Render API 和两个 Cloudflare Worker；004 及数据保留校验通过。19 项线上 HTTP 检查与 10 个线上文件字节匹配通过，详见联合发布记录。

联合整合补充：本次在最新线上源码之上保留开户、渠道及其回归；001–003 升级 004、原授权/开户记录不变、重复迁移不恢复降级角色均已通过。最新测试与上线边界见[联合发布记录](../releases/2026-09-13-admin-login-joint.md)。

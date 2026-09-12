# 后台布局与登录隔离联合发布候选

日期：2026-09-13。用户要求同步 GitHub 并发布；生产数据库迁移尚待明确授权。当前状态：整合与本地验证完成，生产未切换。

## 范围与基线

- GitHub main 基线 399b6f9；隔离分支 codex/admin-login-joint-release，工作目录 /tmp/moventra-joint-release-20260913。共享主目录的无关未提交内容保持原样。
- 后台 DashboardLayout 共用于运营总览、渠道交易、卡详情和开户审批；保留本地六组菜单。已接入入口可用，未接入功能禁用，不加载生产 Demo。
- 客户 `/portal/login`、后台 `/admin/login`；旧 `/login` 同站跳转，对端入口 404。服务端 customer/admin 角色判定，MFA 和每客户/每连接授权继续独立检查。
- 保留已部署开户申请、审批、默认客户端功能资格，以及渠道投影只读链。没有渠道资金写入或金融账本改动。

## 数据库兼容

线上 003 已用于开户，登录任务的原 003_user_roles 改为 004_user_roles；前三个迁移字节不变。004 新增 users.role，默认 customer，把原 staff_grants 用户标为 admin，不新增资源授权。发现客户归属与运营身份混用时事务整体失败。迁移只执行一次并校验 checksum，不复活之后降级的角色。

- `001_initial.sql`: `808e2ab48c8e750dc54a8c2850996d1dffa066a7fcdf1ce05689b51944d3ba29`
- `002_channel_projection.sql`: `bf953dd680ecfe28c06443e0aaa088eafd2b72bcd4b0ce2dacda7ef8960d80a2`
- `003_onboarding.sql`: `bc409ff516c5c268072b9a9e5644a4b49a03b0f7e7cc963d65897a3e028afe21`
- `004_user_roles.sql`: `d3299b84674d6f0f61439f589c82e288c9a3e6711d1dc44b7a16b1f86b7a2caf`

## 本次验证

- `pnpm test`：67 项通过；包含角色准入、网关隔离、开户 GET/POST、总览、渠道 transport、关联卡详情和导航回归。
- `pnpm build`：两端 TypeScript 和 Vite 生产构建通过；仍有原图表大分包提示。
- `bash services/api/scripts/test-postgres.sh`：隔离 PostgreSQL 全套 race 回归通过。覆盖 001/002/003 升级 004、迁移重放/校验、旧开户事件及渠道授权保留、错误角色、MFA、授权范围、开户并发与审计回滚。测试只使用合成记录。
- `go vet ./...`、`go build`：通过。
- 真实 Firebase 账号、持有人 MFA 和已登录业务浏览器验收：未执行，不以单元测试代替。
- 真实渠道验证/金融写操作：未执行。
- 生产数据库连接、备份、迁移及部署：本次尚未执行。

## 待授权的生产步骤与恢复方案

1. 为现有 Render PostgreSQL 创建新备份，私下保存导出并计算 SHA-256，恢复到独立本地数据库。执行只读预检，确认迁移 001–003 checksum、用户混合身份数为零，记录原客户状态、staff_grants、channel_read_grants、onboarding_events 和交易记录数量/校验摘要。
2. 在恢复库预演 004，核对角色与旧权限/业务记录不变。发现冲突即停止，不自动改绑身份或移除客户归属。
3. 对固定 GitHub 提交构建 Render 候选；仅本次使用显式迁移步骤 `api migrate`，必须在新 API 接受流量前完成。若使用临时 preDeployCommand，成功/失败后恢复原空配置，保留 autoDeploy=off，不把迁移加入永久启动命令。迁移失败保留旧服务。
4. API live/ready 后，发布客户端及后台 Worker；校验线上 HTML/关键分包与本次产物相同，旧登录重定向、跨端 404、匿名 API 401。持有人再验证密码/MFA、开户及渠道页面。
5. 应用异常时回退本次之前的 Worker/API。004 为新增列，旧 API 可继续使用；保留该列和迁移记录，不删业务数据或已应用迁移。只有确认数据损坏且另获授权才考虑从备份恢复。

发布前核对的 API：`dep-daio9ip5efls73eb0ki0` live，源码 `2d86136f4629a2f9f7a8821833361655dcfea4fc`；autoDeploy=off，preDeployCommand 为空。Worker 回退版本以本次线上 versions 核对结果补充。

本次 Wrangler 4.129.0 两端 dry-run 通过；线上 Worker 客户端 a29e13aa-9f2d-4d25-a778-255441edf20a、后台 7f53bf22-b7ed-4ba7-baa5-08ba88a28395，均经 deployments list 重新核对，作为此次发布前回退版本。浏览器确认 8960 管理员登录为邮箱密码、8963 客户登录保留 Google；未使用真实凭据。

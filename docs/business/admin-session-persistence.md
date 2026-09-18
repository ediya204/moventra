# FLOW-admin-session-persistence：后台刷新恢复登录

日期：2026-09-18。本地变更，尚未部署。

| 项目 | 内容 |
| --- | --- |
| 目标及范围 | 后台登录后同标签页刷新保持身份；关闭标签页结束会话；客户端保持原有内存模式 |
| 基线 | main / 89ca9c3，修改前工作区干净；线上 index-BM8FRtXe.js 实测使用 NONE 内存持久化 |
| 页面关系 | /admin/login → MFA → /workbench 及已有业务详情；刷新保留当前 URL，由已有页面准入逻辑处理 |
| 业务身份 | Firebase UID；Go 确认本地运营身份及资源授权，无业务数据迁移 |
| 数据依据 | Firebase SDK 的 browserSessionPersistence 保存后台身份；Go 是业务权限权威，不缓存授权结果 |
| 接口链 | AuthProvider 的 onIdTokenChanged → loadSession → liveGet /admin-api/v1/me → 同域网关 → 既有 Go 身份查询 |
| 状态及操作 | 恢复期间 ready=false、未准入；Go 成功且 MFA 合格后进入后台；拒绝或异常沿用退出行为；主动退出清除 SDK 会话 |
| 跨端变化 | 后台使用 SESSION；客户端维持 NONE；独立命名 SDK 实例，无跨端数据动作 |
| 权限 | 保留账号状态、角色、MFA 和逐资源服务端授权；恢复 Firebase 身份不能直接放行业务页面 |
| 验收 | admin-admission.test.mjs 覆盖持久化配置、恢复等待、准入成功、缺 MFA、停用及主动退出；两端类型检查、构建和根目录测试 |
| 待定决策 | 无；本次授权仅本地修改，生产部署及本人登录验收未执行 |

## 验证边界

测试中的 SDK 边界使用替身，验证实际应用初始化配置与 AuthProvider 恢复准入逻辑，不等于真实浏览器 Firebase 登录验收。真实浏览器还需验证：登录及 MFA 后刷新当前业务页、主动退出后刷新、关闭标签页后的会话行为。浏览器的恢复已关闭标签页功能可能恢复 sessionStorage，不将关闭标签页视作服务端撤销令牌。

设计及本地实现完成。2026-09-18 自动化验证：

- 新增持久化回归测试在修改前失败（NONE 不符合 SESSION），修改后认证相关 6 项测试通过。
- `pnpm typecheck` 和 `pnpm build` 通过，覆盖客户端与后台。
- 本机 Node v22.16.0 直接运行 `pnpm test` 因不能直接加载既有 .ts 导入而失败；使用 `NODE_OPTIONS=--experimental-strip-types pnpm test` 后 109 项全部通过，边界检查通过。
- `git diff --check` 通过。

浏览器登录验收未执行；真实渠道验证不适用（无渠道接口变更）；部署未执行。

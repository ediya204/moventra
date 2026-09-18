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

## FLOW-client-session-persistence：客户端刷新恢复登录

2026-09-18 后续变更：下表替代上方历史记录中的“客户端保持内存模式”，后台策略不变。

| 项目 | 内容 |
| --- | --- |
| 目标及范围 | 客户端登录后同一标签页刷新恢复身份；本地修复，主动退出仍清除会话 |
| 基线 | main / 45cc01c；已有卡控制等多处工作区修改，保持原样；本批仅认证配置、认证回归及对应文档；启动 pnpm dev:client |
| 页面关系 | /portal/login → /session → /portal 及业务详情；刷新保留当前 URL；恢复等待沿用现有路由准入 |
| 业务身份 | Firebase UID 与服务端 customer 身份，无业务记录迁移 |
| 数据依据 | SDK browserSessionPersistence 保存身份，Go 为权限权威；不保存业务授权快照 |
| 接口链 | AuthProvider onIdTokenChanged → loadSession → liveGet /client-api/v1/me → 同域网关 → Go 既有身份与授权查询；仅修改 SDK 保存策略 |
| 状态及操作 | 恢复时 ready=false；服务端确认 customer 后准入；停用或网络异常不准入；管理员身份拒绝并退出；缺注册保留资料补全；主动退出清除 SDK 会话 |
| 跨端变化 | 客户端 NONE 改 SESSION；后台保持 SESSION，命名 SDK 实例仍隔离；无跨端业务数据变化 |
| 权限 | 服务端角色、账号状态和逐资源权限继续校验；后台 MFA 无变化 |
| 验收 | E01/E03：持久化配置及恢复身份等待准入；E05：管理员与停用身份拒绝；E06：网络异常不准入、注册恢复、主动退出后重新挂载保持未登录；E02/E04/E07/E08/E09 不适用：无路由、跨端业务、写操作、列表或资金规则变更 |
| 待定决策 | 无；真实浏览器登录验收与生产部署未执行 |

根因是客户端显式选择 inMemoryPersistence，刷新即清空身份。兼容方案为复用后台的标签页会话策略；按 [Firebase 官方持久化说明](https://firebase.google.com/docs/auth/web/auth-state-persistence) 核对，不扩展为跨浏览器重启的永久登录。

设计和本地实现完成。自动化使用 SDK 替身验证配置与真实 AuthProvider，不能代替实际 Firebase 浏览器刷新验收。修改前持久化用例失败（NONE ≠ SESSION），修改后认证 6 项通过。本轮两端类型检查、构建、边界及文档检查通过。完整测试 125 项中 124 项通过、1 项失败：既有工作区 CardControls 引入使 card-snapshot.test.mjs 的模块替身无法解析该组件，与会话修改无关，未改动该并行功能。git diff --check 通过。真实渠道验证不适用；部署未执行。

### 2026-09-19 GitHub main 同步验证

本轮复验完整前端/网关136项全部通过，两端类型检查、构建、边界和文档检查通过；此前CardControls模块替身失败已由后续卡片批次修复。本轮提交客户端标签页会话保存及既有文档整理，历史测试结论保留，不执行生产部署，真实Firebase登录后刷新仍未验收。

# 两角色与登录隔离

2026-09-19 发布补充：账户安全页面已随 `63371c7` 发布；迁移、测试、平台版本和验收限制见[统一发布记录](../../deploy/2026-09-19-consolidated-ui-release.md)。下方较早的“本地未部署”段落保留原实现阶段证据，不代表本批当前部署状态。

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

## 2026-09-19 全局管理增量

应用角色仍为customer/admin；新增独立全局管理身份，覆盖现有及未来客户和渠道，不绕过MFA或资金复核。旧文中的“不能授权未来客户”继续适用于provision-operator；新机制及发布状态见[全局管理员](global-administrator.md)。

## FLOW-AUTH-LOGIN-UI-001：分栏登录与 2FA 弹窗（2026-09-19，本地未部署）

| 项目 | 内容 |
| --- | --- |
| 目标及范围 | 客户端与运营端登录页采用白底品牌插画区/登录表单，既有 TOTP 挑战使用居中弹窗；仅改展示与交互 |
| 基线 | main `14fe215` 加当前共享工作区增量；保留其他任务改动。共享 LoginPage 原文件无未提交差异；本地预览命令 `node tests/frontend/login-preview.mjs`，8866端口 |
| 页面关系 | `/portal/login` 或 `/admin/login` → 密码或既有客户 Google 登录 → 已绑定 TOTP 弹窗 → `/session` → 既有业务入口；取消回到密码输入，邮箱保留、密码及验证码清空；找回密码/注册保留原布局 |
| 业务身份 | 沿用 Firebase UID、已绑定 factor UID、本地 users.role；弹窗不生成新的身份或权限 |
| 数据依据 | Firebase resolver 为既有 TOTP 挑战依据；浏览器隔离预览仅合成身份，不调用 Firebase、业务 API 或生产数据库 |
| 接口链 | LoginPage → 原 AuthContext.signIn/signInWithGoogle → Firebase → 原 completeMfa.resolveSignIn → liveApi 本站身份端点 → 网关 → Go 角色/MFA/资源授权；全部认证契约不变 |
| 状态及操作 | 凭据提交、挑战、验证中、错误重试、取消、成功；六位数字支持粘贴/自动填充，错误清空验证码，多验证器切换清空旧码；验证中禁止重复提交及取消 |
| 跨端变化 | 两端共用 LoginLayout/LoginPage；后台仍无 Google 登录。无业务列表、资金或客户主体变更 |
| 权限 | 原后台 MFA 与准入检查不变；未添加邮件验证码、恢复码或 MFA 绕过；不收集卡片安全码 |
| 验收 | E01/E06/E07：login-dialog 3项交互测试；加原 admin-admission/session-state 共10项通过。两端类型/构建通过。浏览器隔离验收见下文；E02/E04/E08/E09不适用，无业务详情、跨端写入、分页或金额变化；E05沿用准入自动化，真实服务拒绝未复验 |
| 待定决策 | 无，本批只实现用户指定视觉和弹窗；真实登录验收及部署未执行 |

新布局仅登录页使用，保留 Moventra 标识与蓝色强调，不复用参考站品牌、用户数或交易规模宣称。语言切换继续支持中英文。手机尺寸隐藏宣传区，保留完整表单和弹窗；MUI Dialog提供遮罩、焦点限制、Escape取消，退出弹窗后聚焦密码字段。会话提示修正为现行的当前标签页刷新恢复行为。

设计/本地实现已完成；本次运行两端 `pnpm typecheck`、`pnpm build`，10项登录/准入/会话回归通过。全量 `pnpm test` 受到并行工作区变更影响，观察到 MessageCenter 导入缺失和资金导航断言失败，未视为全量通过；不在本次登录范围内修补其他任务源码。真实 Firebase、真实渠道验证、部署均未执行。

浏览器隔离验收：桌面分栏、390px手机表单/验证码弹窗、错误验证码后重试、取消/ Escape退出、取消后密码聚焦、模拟有效码进入 `/session`、后台无Google入口及中英文切换均已检查。模拟码只用于本地夹具；没有输入真实账号密码或验证码。全量回归因失败后未退出而手动停止，不能作为通过证据。

视觉调整（本地）：按用户反馈将左侧改为白色背景、深色文字与蓝色强调，复用仓库已有 Minimals `SeoIllustration` 及 `character_3.png` 人物素材，以细线分隔登录区；未引入外部图片或新增依赖。认证逻辑及2FA弹窗不变。

## FLOW-AUTH-SECURITY-001：账户安全设置（2026-09-19，本地未部署）

### 目标、差异与兼容方案

原安全页仅展示身份和首次 TOTP 绑定，密码/邮箱修改缺入口，已绑定验证器只能提示联系管理员。本批沿用 Firebase 身份与 Go UID 授权，将共享页重组为登录账户、密码、邮箱、2FA 三行展开表单及侧栏登录状态；不新增认证服务或改变金融权限。密码支持直接修改与邮件重设，邮箱验证后生效，验证器先增后减，保留至少一种验证方式。没有自助跳过 MFA 的恢复入口。

| 项目 | 内容 |
| --- | --- |
| 目标及范围 | 客户和运营本人管理登录资料；本地实现与隔离验证，不操作真实身份或部署 |
| 基线 | main `5164482` + 本批未提交增量；工作目录 `/Users/edi/Documents/ChatGPT/moventra`；保留既有资金记录、开卡及发布文档的并行改动 |
| 页面关系 | 客户侧栏设置直接进入 `/portal/security`，移除“个人设置/我的账户”标签及个人设置中转页，旧 `/portal/settings` 重定向到安全页；旧 `/portal/accounts` 仅保留直接访问兼容，不提供导航入口；后台 `/session?security=1`；表单原地展开，关闭清空输入；成功修改密码/验证器返回本站登录页；邮箱验证在邮件链接完成后重新登录 |
| 业务身份 | Firebase UID；不以新邮箱创建账户或更改 Go 客户归属；业务资料邮箱展示不在本批同步范围 |
| 数据依据 | Firebase User/emailVerified/providerData/enrolledFactors 是登录资料来源；Go session.mfaVerified 仅表示本次登录，不能当作绑定状态 |
| 接口链 | AccountSecurity → Firebase SDK updatePassword / sendPasswordResetEmail / verifyBeforeUpdateEmail / sendEmailVerification / multiFactor；SDK 直连身份服务，不经业务网关；刷新沿用 AuthContext → 同域 me → Go 授权 |
| 状态及操作 | 默认概览→展开→提交中→成功或失败；密码二次一致性、邮箱格式、TOTP六位校验；近期登录过期清除敏感输入并提供重新登录；网络失败留在原表单重试，不显示伪成功；发邮件不等于变更已完成 |
| 2FA替换 | 新验证器 enroll 成功后退出并提示使用新设备登录，再选择旧设备确认移除；移除前 reload 并核对数量/目标；当前仅一个时不提供移除；最多五个；SDK仍执行身份安全门槛，客户端保留数量检查不是服务端定制策略 |
| 跨端变化 | 两端共享 Firebase 用户，新密码/邮箱/验证器由同一身份服务持久化；业务主体与权限不变，重新登录后重新查询；没有业务订单或消息计数变化 |
| 权限 | 保留 Firebase 最近登录限制、原运营MFA与Go逐请求授权；Google-only账户不开放直接密码修改；未验证邮箱不能绑定或换邮箱；不采集卡OTP/PAN/CVV |
| 验收 | E01/E06/E07覆盖密码、邮件、MFA失败/重试/重复提交、验证器数量变化；E02/E03保留原安全页深链，敏感输入不进URL/存储；E04真实跨端持久化、E05真实Firebase拒绝待验证；E08/E09不适用，无分页或资金 |
| 待定决策 | 无新增业务政策；真实身份联调/邮件送达/多设备认证待授权测试，负责人待分配，阻塞正式服务验收而非本地实现 |

官方依据：[Firebase 用户管理](https://firebase.google.com/docs/auth/web/manage-users)、[SDK 接口](https://firebase.google.com/docs/reference/js/auth)、[TOTP MFA](https://firebase.google.com/docs/auth/web/totp-mfa)。本次核对官方接口；不修改 Firebase 云配置。解绑最新验证器可能使令牌失效，页面要求重新登录，不假设原会话继续有效。

### 本批证据

设计、本地实现完成。本轮 `pnpm typecheck`、`pnpm build` 两端通过；`pnpm test` 203项通过，包含8项账户安全交互回归，覆盖密码一致性/重复提交、近期登录恢复、邮箱成功与失败、MFA增减/并发状态变化、取消清理及第三方身份。`pnpm docs:check` 和 `git diff --check` 通过。

浏览器使用本地合成数据 `http://127.0.0.1:8898/portal/security` 检查桌面概览、三组展开、邮箱与绑定失败提示、390px密码/2FA表单，390px无横向溢出。320px下主体可见，但既有全站320px最小宽度与桌面滚动条组合出现15px横向滚动，本批未改全站尺寸约束。二维码及成功写入由组件自动化覆盖，浏览器夹具拒绝所有身份写入，不冒充完整Firebase浏览器验收。

真实 Firebase、邮件送达、跨端身份持久化、真实渠道及部署未执行。共享 `AccountSecurity` 独立承载设置，不改 Go 授权链；隔离预览增加并行卡片备注接口的拒绝桩以保证页面可启动。回退可移除本批共享组件接入，不涉及数据库迁移。

入口精简追加验收：11项客户端工作台回归、客户端类型/构建、文档与差异检查通过；浏览器确认旧 `/portal/settings` 自动到 `/portal/security`，页面不再出现两个旧标签。此为203项全量回归之后的导航增量，未重复宣称全量已重新运行。

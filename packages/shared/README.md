# Moventra 共享前端模块

更新日期：2026-09-07。共用认证、Firebase SDK、UI、主题、类型与数据适配；每端路由由各自应用维护。

- `src/auth`：Go 身份查询、注册分流、MFA 与会话状态。
- `packages/shared/src/pages/LoginPage.tsx`、`src/website/auth`：共用登录、找回密码与认证布局。
- `packages/shared/src/theme.ts`、`src/components`：MUI 主题和公共组件。
- `src/api`、`src/slash` 等：包含历史 Demo/旧只读接口适配，存在于共享包不表示生产路由开放。
- `packages/shared/src/config/firebase.web.json`：公开 Web SDK 配置，不放 Admin SDK 凭据或渠道密钥。

共享包不得反向依赖 `apps/client` / `apps/admin`；两应用不得互相引用源码。根目录 `pnpm check:boundaries` 检查边界及本地导入；共享代码变更运行两端 `pnpm typecheck`、`pnpm build` 和 `pnpm test`，后台构建无需邮箱授权配置。

素材在 `packages/assets/public`，构建工具在 `packages/tooling/vite.ts`。更多见 [主题约定](../../docs/frontend/ui-theme.md)、[文档索引](../../docs/README.md)。

2026-09-13 已联合发布：共用认证改用服务端 customer/admin 角色及站点专属身份端点，移除前端邮箱名单。共享 transport 同时保留已上线的开户 GET/POST 和渠道只读白名单。见[联合发布记录](../../docs/releases/2026-09-13-admin-login-joint.md)。

2026-09-17：`auth/ledgerApi.ts` 提供同域 `getShadowLedger`，复用 Firebase Bearer 与两端路由隔离。`ledgerContract.ts` 检查 shadow 标识、主体、精确字符串金额及汇总；不切换现有页面余额，不提供资金写方法。见 [Blnk 接入](../../docs/integrations/blnk.md)。

2026-09-19（本地未部署）：`components/ChannelCardStatus` 供两端展示渠道原始卡片状态，采用紧凑浅色圆角标签与同色图标/文字，未知状态保留原值；不修改状态或权限。样式及验证见[卡片状态展示](../../docs/business/card-state-sync.md#2026-09-19-状态展示精简本地未部署)。


2026-09-19：新增 `SectionNavigation` 路由分区导航与 `FundsNavigation`，支持手机横向滚动和选中入口可见；`SessionPage` 的 `embedded` 参数用于客户安全页，默认认证页保持独立。资金表单及记录采用一致的容器与响应式布局，见[客户端页面统一](../../docs/frontend/client-workspace-layout.md)。本地未部署。

2026-09-19（本地未部署）：`finance/OtcExchange` 管理输入防抖、自动报价、过期刷新及成交前展示；`CustomerFunds` 继续管理订单提交、持久幂等与异常恢复。金额采用最小单位整数，旧响应不能覆盖新输入，见[OTC流程](../../docs/business/funds-center.md#flow-funds-otc-autoquote自动报价与成交2026-09-19本地)。

2026-09-19（本地未部署）：cryptoMoney/fundsAmount按两位截断展示USDT，usdtDecimal处理来源十进制金额；cryptoUnits继续保留六位输入精度，格式化文本不得用于计算或提交。管理模块decimal的可选displayPrecision只用于展示，编辑默认保留完整精度。见[展示规范](../../docs/frontend/ui-theme.md#usdt-金额展示2026-09-19本地未部署)。


2026-09-19 登录界面（本地未部署）：共享 LoginLayout 提供白底品牌插画区与登录表单，原 TOTP 挑战改为居中弹窗；认证方式和服务端准入不变。详见[登录流程](../../docs/business/two-role-login.md#flow-auth-login-ui-001分栏登录与-2fa-弹窗2026-09-19本地未部署)。

## 消息模块（2026-09-19，本地未部署）

`auth/messageContract.ts`、`auth/messageApi.ts` 和 `messages/MessageCenter.tsx` 提供独立方法白名单、消息类型、收件箱及铃铛；与财务transport分离，不执行金融动作。快照已读、原单关联及异常恢复见[消息中心](../../docs/business/message-center.md)。


## 统一 USD 开卡增量（2026-09-19，本地）

开卡契约支持 funds_wallet/issuing_wallet 来源及执行开关，订单明确原扣款/退款路径；新卡普通详情通过 issuingOrderId 返回原单。见 [统一开卡](../../docs/business/client-card-issuing.md)。

## 2026-09-19 卡片中心发布

ChannelCardStatus为双端卡片原始状态提供统一浅色标签与语义图标，不修改状态逻辑。

## 统一资金记录组件（2026-09-19）

`finance/FundRecords.tsx`由两端复用，独立GET transport与契约，按URL恢复筛选/分页/详情；金额格式沿用既有精确展示。见[资金记录](../../docs/business/fund-records.md)。

2026-09-19（本地未部署）：`auth/AccountSecurity` 为共享安全设置，密码/邮箱/验证器使用 Firebase SDK，保留 Go 授权。见[安全设置流程](../../docs/business/two-role-login.md#flow-auth-security-001账户安全设置2026-09-19本地未部署)。

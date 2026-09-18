# Moventra 客户端

> 2026-09-18：客户端开卡应用与八个BIN目录已发布，真实金融执行仍关闭。当前能力及验证范围见[当前状态](../../docs/current-state.md)和[本次发布记录](../../deploy/2026-09-18-client-issuing-release.md)。下方带日期的历史段落保留当时实施状态。

更新日期：2026-09-07。独立入口在 [App.tsx](src/App.tsx)，官网和个人客户端共用此应用；不引用运营应用源码。

从仓库根目录运行 `pnpm dev:client`（127.0.0.1:8853）、`pnpm build:client`；产物为 `apps/client/dist`，部署到客户端 Worker。身份固定为 client，不使用 `VITE_SITE_KIND` 切换应用。共用认证/UI 位于 [packages/shared](../../packages/shared/README.md)。

生产使用 Firebase 邮箱密码或 Google 登录。已开通用户由 `/session` 进入 `/portal`，安全页为 `/portal/security`。查询只展示获授权个人主体的账户与交易，空数据、未关联和失败分别显示；已支持明确授权的只读卡片和关联交易；资金中心四流程已发布，正式资金尚未激活；旧测试记录在独立历史入口保留。

`/register` 仅做表单预览和校验；通过 Firebase 验证的会话遇到 `403 registration_required` 才通过资料补全调用 Go 注册，常见于首次 Google 登录。注册创建登录用户，不自动开通个人主体、企业、资金账户或运营权限。企业模型保留在后端，当前前端为 V1 个人范围。

本地首页展示正式钱包和最近5笔资金订单，交易与账单页仅展示卡片交易，提供描述、UTC 日期、单选状态筛选和当前筛选 CSV 导出，资金记录通过独立入口查询；基础账户与基础交易仅保留在 `/portal/accounts`，默认前50条且没有分页界面。首页卡片按来源显示服务端总数并预览前5张。2026-09-19本批尚未部署，见[首页流程](../../docs/business/funds-center.md#flow-client-overview-001生产首页数据一致性2026-09-19本地修复)。客户卡片通过独立 card-projections 契约读取显式分配范围，不能访问后台 channel-projections；卡片列表按服务端分页，不能与基础账户/交易默认前 50 条的限制混用。完整说明见 [身份与业务开通](../../docs/business/identity-and-production.md)。

开发 Demo 路由仅在 DEV 且显式 Demo 配置下可用；对应隔离 Node/SQLite 服务已恢复，使用 `pnpm workspace:dev` 运行合成数据；仅启动前端不提供业务后端或私有数据。生产不打包 Portal 原型。

参阅 [开发约束](../../AGENTS.md)、[文档索引](../../docs/README.md)、[认证配置](../../docs/frontend/firebase-setup.md)、[部署记录](../../deploy/README.md)。

## 2026-09-13 登录隔离候选

客户登录为 `/portal/login`，旧 `/login` 自动跳转。客户身份使用 `/client-api/v1/me`；管理员角色拒绝进入客户端。保留已上线的开户申请、功能资格和导航；部署依赖角色迁移 004。见[联合发布记录](../../docs/releases/2026-09-13-admin-login-joint.md)。

官网 SEO 实现、验证和 Google 提交步骤见 [官网 SEO](../../docs/frontend/website-seo.md)。`pnpm test:seo` 检查首页索引与应用页面 noindex 边界。

2026-09-18：`/portal/cards`、卡片详情及 `/portal/transactions` 的卡片交易区支持显式分配的只读测试快照。深链 `/portal/cards/:id?connection=...`、`/portal/card-transactions/:id?connection=...`；每页20条、搜索及分页在 URL 保存。绑定不激活资金功能，余额保持未知，新增导入不自动扩大测试授权。见 [客户卡片测试绑定](../../docs/business/customer-card-binding.md)。

## 线上测试钱包

`/portal` 和 `/portal/funds` 新增独立的线上测试余额查询区，仅显示受控配置的测试额度，明确不可提现或充值到真实卡片。见[流程与验证](../../docs/business/online-test-wallet.md)。

正式登录资金中心 `/portal/funds` 已接服务端线上测试资金：USDT/法币充值、报价兑换、提现申请、状态记录和稳定订单详情。需要个人账户已审批启用及独立测试额度；全部属于模拟流程。待确认写请求在当前标签页保存幂等键，网络异常后重试同一请求。见 [流程卡](../../docs/business/online-test-funds.md)。

## 客户端开卡（2026-09-18，应用已部署，真实执行关闭）

正式 `/portal/cards/new` 已接 BIN、USD 开卡钱包、报价和声明支付；`/portal/card-orders` 及详情支持持久化恢复，新卡详情为 `/portal/issued-cards/:id`。本地真实 Blnk + 模拟 Slash 的隔离闭环已验收，不使用线上测试额度，不代表真实金融服务启用。见 [FLOW-CLIENT-ISSUING-001](../../docs/business/client-card-issuing.md)。

## Cregis 隔离资金

`/portal/crypto` 接入共享 CryptoFunds，充值/提现/OTC/订单详情读取独立资金 API；生产 `/portal/funds` 已切换正式资金视图，旧测试入口不再展示。USDT 与 USD 分币种展示，模拟地址不生成二维码。见 [资金流程](../../docs/business/cregis-funds.md)。

四流程资金页面已替换 `/portal/funds`，旧测试数据保留但生产入口已移除；首次进入充值页才申请 Cregis 地址。具体路由、近期记录及正式启用边界见[资金中心](../../docs/business/funds-center.md)，代码发布见[发布记录](../../deploy/2026-09-18-funds-center-release.md)，正式TRC20充值与OTC已分能力启用，提款及卡充提仍关闭；见[激活记录](../../deploy/2026-09-18-production-funds-activation.md)。

## 人工资金记录（2026-09-18，代码已发布）

资金中心新增 `/portal/funds/manual` 和 `/portal/funds/manual/orders/:orderId`，只读本人后台人工出入金订单；服务端裁剪内部凭证、备注与操作员ID。记录与数字货币充值区分，入账共用现有钱包。无客户人工加减余额入口。代码已发布，生产016迁移及资金授权未启用；[FLOW](../../docs/business/platform-advance.md)。

USDT充值页接入独立地址查询/首次申请接口，TRC20绑定复用、二维码复制、渠道通知分页及详情；正式入账未开通时明确提示。见[地址接入](../../docs/business/deposit-address-integration.md)。

## 卡片状态同步

卡片列表/详情显示渠道最近核验状态与时间；详情支持启用、停用、注销确认及手动核对。只允许本人正式归属且已开启操作能力的卡片；处理中/待核实禁止重复修改，注销保留历史。页面每15秒读取本系统，隐藏标签页暂停，不触发周期Slash查询。参见[流程](../../docs/business/card-state-sync.md)。

生产首页使用ProductionWallet读取正式crypto快照，资金总览及记录共用live范围。旧test-funds页面跳转资金中心，不展示测试钱包或历史测试入口；未开户币种显示未开通。见[生产资金展示](../../docs/business/funds-center.md)。

## 正式资金分能力接入（2026-09-18）

生产充值不显示试点限额；OTC/提款/卡充提按具体能力和客户资格控制，未核验渠道显示具体原因。

## 刷新保持登录（2026-09-19，已部署）

客户端 Firebase 身份改为当前标签页会话保存，刷新业务页后自动恢复，并重新请求服务端身份与权限；主动退出清除会话。关闭标签页后不承诺继续登录。流程和验证边界见[会话记录](../../docs/business/admin-session-persistence.md#flow-client-session-persistence客户端刷新恢复登录)。

2026-09-19本地展示调整：正式卡片状态统一为渠道原值与对应图标，不显示核验时间；尚未部署，见[卡片状态](../../docs/business/card-state-sync.md)。

## 卡片中心布局（2026-09-19，本地未部署）

顶部集中申请新卡与开卡订单；授权卡片支持关键词和状态组合筛选、条件标签与清空、URL 恢复及移动端卡片布局。筛选为当前来源的服务端查询，每页20条；排序仅影响当前页，新开卡记录独立展示。见 [FLOW-CARD-CENTER-UX-01](../../docs/business/customer-card-binding.md#flow-card-center-ux-01--卡片中心布局与筛选2026-09-19本地)。

卡片列表另新增“余额”“近30天消费”两列，状态表头统一为“状态”。金额来源尚未接入，两项明确显示暂不可用，不表示零；详见[展示边界](../../docs/business/customer-card-binding.md#2026-09-19-两列金额展示补充本地未部署)。


## 客户端页面统一（2026-09-19，本地未部署）

正式工作台统一页面标题、说明、分区导航与响应式内容；资金中心取消重复操作条，人工出入金纳入分区，手机资金记录使用摘要布局。设置、安全、消息与帮助分别展示实际可用路径及能力状态。保留已有卡片中心/详情改动与全部金融能力校验。范围、流程卡及隔离验收见[页面布局与导航](../../docs/frontend/client-workspace-layout.md)。

本地视觉预览：`node tests/frontend/client-layout-preview.mjs`，访问 `http://127.0.0.1:8865/portal/funds`。预览仅合成身份、数据和OTC报价，订单等业务写操作拒绝；不连接生产，不代表真实登录或渠道验收。

2026-09-19 OTC本地交互：卖出金额停止输入400ms后自动获取报价并显示买入数量；统一显示汇率、费用、合计扣款和“成交”按钮。报价过期自动更新，订单沿用原幂等恢复逻辑，见[自动报价与成交](../../docs/business/funds-center.md#flow-funds-otc-autoquote自动报价与成交2026-09-19本地)。未部署。

2026-09-19本地卡片详情：列表入口为“详情”，概览/交易/资金/充值到卡/退回钱包有稳定URL；CVV沿用当前登录、临时展示30秒，无二次验证，不持久保存。生产尚未启用CVV或本批资金执行。见[详情流程](../../docs/business/customer-card-binding.md#flow-card-detail-001卡片详情与充提2026-09-19)。

2026-09-19（本地未部署）：首页、资金余额、充值记录、OTC买入、订单及费用的USDT展示统一两位直接截断，金额输入和接口保留原精度。见[全站规则](../../docs/frontend/ui-theme.md#usdt-金额展示2026-09-19本地未部署)。


2026-09-19：卡片详情本地调整为上方卡面/操作与资金双栏、下方交易/资金两个标签。点击卡面临时显示完整卡号、名称、到期日和CVV，默认遮蔽并30秒清除。见[详情流程](../../docs/business/customer-card-binding.md#2026-09-19-卡片详情双区布局与完整卡号本地未部署)。未部署。


2026-09-19 登录界面（本地未部署）：共享 LoginLayout 提供白底品牌插画区与登录表单，原 TOTP 挑战改为居中弹窗；认证方式和服务端准入不变。详见[登录流程](../../docs/business/two-role-login.md#flow-auth-login-ui-001分栏登录与-2fa-弹窗2026-09-19本地未部署)。


2026-09-19 卡片详情操作区：按钮采用与卡面同宽的两列布局，右侧快捷入口底部对齐；仅本地排版变更，未部署。

## 消息中心（2026-09-19，本地未部署）

`/portal/messages` 接持久化列表、分类/已读筛选、搜索、游标分页和 `/:messageId` 深链；铃铛查询最近5条及未读总数。详情单独标已读，全部已读使用签名快照保留新消息。支持OTC通知及运营站内信，服务未启用/错误不伪装为空收件箱。跨端隔离验收及生产开关见[消息中心](../../docs/business/message-center.md)。

2026-09-19（本地未部署）：USDT充值、提现采用三步表单＋右侧须知＋近期记录表，手机单栏；提现仍先报价后确认，网络和费用按原服务能力。见[布局流程](../../docs/business/funds-center.md#flow-funds-transfer-style充值与提现参考图布局2026-09-19本地未部署)。


## 统一 USD 开卡增量（2026-09-19，本地）

统一开卡读取资金中心 USD，订单展示原扣款/退款账户类型；新卡进入普通卡片中心，资金记录可返回原开卡订单。卡分户资金核对与授权占用门槛继续控制通用充提。见 [开卡闭环](../../docs/business/client-card-issuing.md)。

资金中心当前分区为总览、USDT充值、USDT提款、OTC与交易记录；独立法币充提入口已移除，旧链接返回总览。卡片详情内操作不受此导航调整影响（2026-09-19，本地未部署）。
本地视觉预览：`node tests/frontend/client-layout-preview.mjs`，访问 `http://127.0.0.1:8865/portal/funds`。预览仅合成身份和数据，全部写操作拒绝；不连接生产，不代表真实登录或渠道验收。

2026-09-19本地卡片详情：列表入口为“详情”，概览/交易/资金/充值到卡/退回钱包有稳定URL；CVV沿用当前登录、临时展示30秒，无二次验证，不持久保存。生产尚未启用CVV或本批资金执行。见[详情流程](../../docs/business/customer-card-binding.md#flow-card-detail-001卡片详情与充提2026-09-19)。


## 2026-09-19 卡片中心发布

卡片中心支持顶部操作、服务端搜索/状态筛选、URL恢复、当前页排序及移动布局；状态统一浅色标签，创建日期为YYYY/MM/DD。该批余额与近30天消费尚为占位，已由下述指标发布替换。见[卡片中心流程](../../docs/business/customer-card-binding.md)。

## 2026-09-19 卡片历史与指标

卡片列表与详情已上线可选metrics：可消费额度、截至完整窗口的近30天消费、消费构成明细和手动补同步。020迁移和指定账户23张卡初始化已完成；渠道未提供额度时显示未知，不填零。见[卡指标](../../docs/business/card-metrics.md)。

## 首页概览本地候选（2026-09-19）

首页按常用入口、横向钱包概览、独立消费分析、紧凑卡片列表、近期资金记录组织；桌面趋势图宽于辅助对比区，手机依序堆叠。以资产和流向图标辅助识别钱包与资金记录；卡片概览直接显示现有额度/近 30 天消费指标及详情入口。增加逐卡每日消费柱状图（完整分页并核对指标后绘制）、预览卡片状态分布与近30天消费横向对比，按币种和完整统计区间分别比较。异常提醒限于最近记录，隐藏内部来源名称。未部署；完整流程与验收见[首页布局](../../docs/frontend/client-workspace-layout.md#flow-client-home-002首页概览与常用操作2026-09-19本地候选)。本机预览：`node tests/frontend/client-home-preview.mjs`，访问 `http://127.0.0.1:8868/portal`，仅使用合成数据。

2026-09-19 额度数据接入（本地实现，未部署）：浅灰额度卡使用同一渠道快照的 availableMinor（剩余可消费额度）、cycleSpendMinor（本周期已用）和 totalLimitMinor（明确的单卡 utilizationLimit 总额度）。总额度仅提取已识别的单卡规则，卡组共享或其他规则显示未提供；只有总额度等于已用加剩余且大于零才显示进度，不用近30天消费或钱包余额推算。卡分户及统一 USD 钱包余额独立读取，保留核对状态与充提权限门槛。刷新沿用 metrics-sync，只排队只读查询；近30天消费明细区间保持。

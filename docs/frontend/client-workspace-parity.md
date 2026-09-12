# FLOW-004 客户工作台布局一致性

2026-09-13。范围：正式客户端与本地 Demo 的产品导航、主内容宽度、四栏概览、快捷操作及双栏统计区域。正式数据与模拟数据继续隔离。

## 基线与差异

正式源码 `/Users/edi/Documents/ChatGPT/moventra`，main / ce0a88a，工作区已有多项未提交改动，本次均保留。旧 ADSFLOW 目录仅作原型参考。用户截图与正式 ClientHome 均是四项导航；DEV Portal 为七项导航与完整演示仪表板。本次修改 ClientHome、Portal，新增 workspaceNavigation 共用定义及组件测试，不迁入旧 Demo 服务。

## 流程卡

| 项目 | 本次范围 |
| --- | --- |
| 页面关系 | /portal 与 /portal/overview → funds/cards/transactions/messages/support/settings；settings → accounts/security；/portal/cards/new 提供未开通说明 |
| 身份与依据 | 保留 Firebase/Go 会话中的 personal customer；账户和交易保留服务端授权范围；无主体时不查询 |
| 接口链 | ClientHome → liveGet → /client-api/v1/customers/:id/accounts 或 transactions → 现有同域网关 → 现有 Go 查询；未修改接口、网关或 handler |
| 状态和动作 | 真实账户/交易保留加载、失败、未关联、空数据、最多50条提示及刷新；正式余额/卡片/统计未提供，显示未知与未开通，四项金融快捷操作禁用 |
| 跨端 | 正式端与 Demo 共用七项导航和侧栏宽度定义；不混接 Demo 模型。后台业务状态不在此次展示变更范围 |
| 权限 | 原身份、MFA及主体范围不变，主体切换丢弃旧响应；不新增生产 API、资金操作或客户渠道授权 |
| 验收 | 导航深链、未知金额、禁用金融动作、未关联、读取失败、主体切换；桌面浏览器使用独立身份/空数据夹具 |
| 待定 | 客户余额、卡片、消费退款统计及办理接口尚未接入，负责人待分配；真实业务验收和部署待执行 |

## 本次证据

- 本地实现：完成上述展示与导航调整。账户/交易数据口径未变；没有将 Demo 数字作为正式资金展示。
- 自动化：新增 `node --test tests/frontend/client-workspace.test.mjs` 4项通过；既有 session-state 与网关12项通过；check:boundaries通过。
- 类型与构建：原工作区依赖访问阻塞，未改依赖目录。将源码复制至 `/tmp/moventra-ui-verification`，使用已有本机依赖缓存；客户端 TypeScript检查及Vite生产构建通过。测试运行器单独使用 React18.3.1、react-test-renderer18.3.1及TypeScript5.9.3。隔离构建未复制生产环境文件，产物用于验证而非直接发布。
- 浏览器：独立本地夹具验证桌面工作台结构、真实空态、禁用按钮和设置页面跳转；线上未认证 /portal 导向 /login。无法据此声称完成真实账号验收。窄屏覆写未生效，窄屏交互未完成浏览器验收。
- 真实渠道验证：未执行；没有真实渠道读写、数据库连接或迁移。
- 部署：未执行。需依仓库 AGENTS.md 的明确生产部署授权要求确认后，使用正式构建配置及限定文件范围发布客户端。

## 2026-09-13 授权同步与发布准备

用户本次明确授权“同步 发布”。使用 `/tmp/moventra-client-publish-20260913` 从 origin/main 4a9edaa 独立克隆，以冻结锁文件安装依赖。先恢复已部署但未推送的 2026-09-11 官网调整；重建 HTML、Website、AuthLayout、LegalLinks、ClientHome 与当前线上资源逐字节一致，确认发布基线未回退。对应线上原版本为 2ec7f0e1-c273-45a5-993c-0b15537582d9。

随后仅加入本次工作台修改。完整 `pnpm test` 58项、咨询回归5项、`pnpm build:client`（含TypeScript）及 production Wrangler dry-run 全部通过。构建使用正式 Firebase 配置及固定 client 身份，没有测试身份替换或 Demo 页面。共享工作区与发布目录四个相关源码/测试文件逐字节一致，其余并行修改保留。实际云版本及上线核验另记发布记录。

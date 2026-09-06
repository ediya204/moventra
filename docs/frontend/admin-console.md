# 管理总后台：结构与本地实施

## 当前仓库状态（2026-09-07）

保留的运营 Demo 页面在 `apps/admin/src/admin`；生产运营入口仅开放登录、找回密码和身份/授权工作台。审批、配置、资金订单管理尚未接入生产 Go API。

本页为历史设计/实现档案。下方的“当前”“已实现”“本次”均指原记录当时；历史端口、脚本、迁移、数据及测试结果不代表现有仓库可复现或生产已验收。当前能力与可执行命令见 [文档索引](../README.md)、[开发总纲](../DEVELOPMENT.md)。

## 历史记录正文

## 本期目标

将以卡片分析、异常查询为主的运营后台，扩展为管理人员的统一入口。首页首先回答“哪些客户需要处理、哪些配置可管理、最近是谁做了什么”；原经营分析和业务查询保持原有数据来源。沿用 Public Sans、微软蓝和 MUI / Minimals 的组件与主题，不另建视觉体系。

## 信息架构与完成状态

| 一级领域 | 页面 / 入口 | 本期实现 |
| --- | --- | --- |
| 管理空间 | `/workbench`、`/approvals` | 管理总览、客户状态图、开户待办、最近管理操作；审批目录按状态、关键词分页查询 |
| 客户与开户 | `/user-groups/users`、`/user-groups/groups`、`/customers` | 复用用户开户、审核、启停、组归属与客户账户目录 |
| 卡片与交易 | `/cards`、`/transactions` | 保留卡片及交易详情；普通模式保留卡资产与 OTP 活动 |
| 资金与财务 | `/finance/orders`、`/pricing`、`/reports` | 新增客户端资金订单列表及详情、统一费率入口；保留财务报表，普通模式保留收入分析 |
| 风险与合规 | `/risk`、`/reconciliation` | 保留风险监控与资金对账 |
| 经营分析 | `/operations`、`/analytics/*` | 原运营工作台移至 `/operations`；普通模式保留卡片、交易和账户组分析；Slash Demo 保留场景库 |
| 系统管理 | `/system/audit`、`/system/channels`、`/system/access`、`/system/settings` | 全局日志查询、接入能力和数据批次、现有身份权限说明、本地后台名称和公告配置 |

导航由 `apps/admin/src/admin/navigation.ts` 集中定义。按最长路径选择当前菜单，避免卡片详情与卡资产页面同时高亮；通过首页进入下级页面时自动展开所属分组。原 `/workbench` 地址仍有效，现在展示管理总览。全局搜索支持邮箱、`user:`、`order:`、`tx:` 和卡片关键词。

列表操作在最后一列，点击数据行进入对应详情。审批通过/拒绝复用原用户详情的状态校验与版本校验；费率管理直接进入同一个组费率编辑器（`?tab=fees`），不复制计费规则。

## 数据与实现边界

- 管理总览读取本地 `mg_users / mg_groups / mg_fees / mg_audit`。客户状态图采用真实计数，不生成装饰性趋势数据。用户统计与 Slash 来源卡片没有建立客户映射，不混合为同一客户资产规模。
- `/finance/orders` 复用 `portalList` 和 `portalEntry`。后端锁定资金订单分组、过滤、分页，再输出白名单字段；列表与详情采用同一投影。USD 分与 USDT 百万分单位分别展示，不做不同币种相加。
- 审批中心当前只接入开户。资金订单目前只读，尚未加入资金审核/付款操作。
- `/system/access` 显示现有登录返回的角色，以及真实执行的本地 operator/member 权限边界。它不创建管理员、不分配生产权限，也不是可编辑 RBAC 系统。
- 渠道页中的“本次读取成功”仅指本地数据库读取成功。真实 Slash API 连通性未验证，不提供真实密钥编辑或凭证存储。
- 原线上业务查询继续使用原只读接口。新增管理接口固定使用 `/local-slash-demo`，不通过线上业务代理写数据。
- 后台名称、公告只作用于管理总览；公告不发邮件，不推送到客户端。

## 接口与迁移

新增管理 API（均需独立本地 operator 会话）：

- GET `/local-slash-demo/management/console/overview`
- GET `/local-slash-demo/management/console/audit`：keyword、action、from/to（UTC）、page/pageSize。
- GET `/local-slash-demo/management/console/orders`、`orders/:id`。
- GET `/local-slash-demo/management/console/system`
- GET / POST `/local-slash-demo/management/console/settings`

设置 POST 白名单为 `workspaceName`、`notice`、`revision`，不会接受权限、支付或渠道安全字段。采用事务保存配置和审计，旧版本返回 409。写接口继续校验本地 Origin，member 会话无法访问管理接口。

增量迁移 `004_admin_console.sql` 新增 `mg_settings`（namespace、workspace_name、notice、revision、updated_at）和审计查询索引。既有业务字段和数据库保持不变。默认配置在读取时提供，不覆盖用户已有设置。`004_admin_console.down.sql` 可单独回退这张表和索引；执行前停服并备份本地数据库，回退会删除本模块展示配置。

`management:clean` 现在也清理指定 namespace 的后台设置，仍保留 Slash 来源场景与原 Portal 资金数据。整个 Demo 批次清理时配置通过外键级联删除。

## 历史运行与验证

```text
历史命令（旧环境记录，当前仓库不可直接执行）：
# 在 apps/admin 目录
npm run management:init
npm run slash:demo

# 检查
node --test tests/admin-console.test.mjs
node --test tests/*.test.mjs
npm run build
```

- 原前端：`http://127.0.0.1:8850/workbench`（现有后台登录）。
- 完全隔离演示：`http://127.0.0.1:8852/workbench`，登录 `demo@moventra.local` / `demo-only`；必要时点击“启用本地管理演示”。
- 本地 API 仅监听 `127.0.0.1:8862`。

2026-09-06 验证：

1. 新增 7 项测试覆盖总览/审批一致性、设置事务与并发、日志筛选分页、资金订单同源与白名单、批次隔离、HTTP 权限与 Origin、导航匹配。
2. 浏览器确认总览计数：1 个待审核、2 个启用用户、2 个用户组、1 个专属费率用户。
3. 点击资金订单行进入 `DEMO-PORTAL-SEED-WITHDRAW`：支出52 USDT、手续费2 USDT、获得50 USDT，状态待审核，与客户端记录一致。
4. 浏览器保存总后台名称“Moventra 管理总后台”，操作日志出现 `settings.update`。
5. 桌面视觉检查已完成。响应式布局沿用 MUI 断点、移动端抽屉和表格横向滚动；尚未在真实手机设备验收。

## 后续实施顺序

1. 统一真实客户身份：打通管理用户、Portal 用户和 Slash 所属实体映射。
2. 接入正式管理员目录与服务端 RBAC：超级管理员、运营、财务、风控、客服分工，权限必须由后端执行。
3. 资金审核工作流：按充值/兑换/提现类型设计审批和渠道回调，费用快照绑定报价与订单，保持账务幂等。
4. 渠道配置和监控：密钥托管、连接探测、失败补偿、Webhook 投递调查。
5. 运营管理扩展：通知模板、工单处理、批量操作与配置生效时间。

这些是后续接入计划，当前页面不以空按钮或虚构成功状态冒充已完成的生产能力。本次未部署、未写真实 Slash、未改变生产角色或资金。

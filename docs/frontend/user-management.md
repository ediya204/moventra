# 用户组与开户管理（本地实现）

## 功能规划与已实现范围

采用“用户组列表 → 分组详情 / 成员列表 → 用户详情”的结构。用户组是商业分组，与后台管理员角色分开。沿用微软蓝主题、MUI DataGrid、Tabs、Dialog 和现有 PageHeader；列表行和末列详情按钮均可进入详情。

| 模块 | 已实现行为 |
| --- | --- |
| 用户组 | 新建、编辑、启停、成员数、按组查看成员、默认费率 |
| 用户与开户 | 姓名/邮箱/编号搜索、状态/组筛选、服务端分页；新增申请、批准/拒绝、启停、调整分组 |
| 开户审核 | 新用户先待审核，批准后创建 USD 与 USDT 零余额本地账户；重复批准不会重复开户 |
| 手续费 | 10 类业务、百分比加固定费、组继承、用户覆盖、显式零费率、后端精确试算 |
| 密码重置 | 创建 15 分钟一次性链接、用户设置新密码、密码哈希存储、旧会话撤销 |
| 审计与并发 | 操作原因、审核意见、操作者和时间；revision 防止旧页面覆盖新数据 |

**这是可操作、持久化的本地管理模块。** 没有修改原后台远程用户表，不调用真实 Slash 开户，不发邮件，不改变原 Portal 演示钱包的固定计费逻辑。管理用户与原 Portal / Slash 卡片客户映射尚未打通，不能用这里的新用户登录原生产客户端。新增的本地成员登录接口只验证本模块的凭证与会话。

## 页面入口

- 后台侧栏：用户管理 → 用户组管理、用户与开户。
- 本地原前端：`http://127.0.0.1:8850/user-groups/groups`（需要原后台登录）。
- 完全隔离演示：`http://127.0.0.1:8852/user-groups/groups`。
- 用户目录：`/user-groups/users`；开户申请：`/user-groups/new-user`。
- 分组详情：`/user-groups/groups/DEMO-GROUP-STANDARD`。
- 示例用户：`/user-groups/users/DEMO-USER-001`（启用）、`/user-groups/users/DEMO-USER-002`（待审核）。
- 浏览器验证开户记录：`DEMO-USER-a4e48047-0db1-4c68-bcaa-bff57a3a210b`，姓名 Demo UI 验证客户、邮箱 `ui-check-0906@example.com`。
- 密码设置：`/demo-reset-password#<一次性令牌>`；令牌仅在创建时展示，不写入 URL 查询参数、不发送邮件。

8852 登录使用 `demo@moventra.local` / `demo-only`。进入模块后点击“启用本地管理演示”，建立独立 HttpOnly 本地操作会话。此演示身份不是生产权限实现。

## 初始化、启动、验证、清理

在 `apps/admin` 目录运行（Node 需支持 `node:sqlite`）：

```sh
npm run management:init
npm run slash:demo
```

初始化可重复执行，不覆盖已修改的组、用户或费率；没有基础 Demo 批次时先建立批次。服务仅监听 127.0.0.1:8862，演示前端为 8852；8850 的 `/local-slash-demo` 也仅代理该本地服务。

```sh
npm run management:test
node --test tests/*.test.mjs
npm run typecheck
npm run build
```

仅清理本模块某批次的数据（**包含该批次新增用户、费率、密码凭证、审核记录和会话**，保留原 Slash 场景与 Portal 资金数据）：

```sh
npm run management:clean -- --namespace slash-clearing-v1
```

访问管理模块会按需恢复两个默认组和两个默认用户。需要保持清空时先停止演示服务并关闭管理页面。不要用 `slash:clean` 代替：后者会清理整个场景批次。

## 存储和 API

增量迁移 `003_user_management.sql`：

| 表 | 用途 |
| --- | --- |
| mg_groups | 商业用户组、状态、revision |
| mg_users | 所属组、合成邮箱、开户状态、审核意见、凭证哈希与版本 |
| mg_fees | scope(group/user)、owner_id、业务 kind、bps、fixed_minor |
| mg_accounts | 本地开户结果，每用户每币种唯一、整数余额 |
| mg_resets | 令牌 SHA-256、有效期、消费时间 |
| mg_sessions | 会话令牌哈希、operator/member 角色、期限 |
| mg_audit | 独立操作日志，不含令牌和明文密码 |

表通过 namespace 隔离，复合外键维持用户、组、账户和重置记录关系。必要索引覆盖组/状态用户查询和目标审计查询。不会删除或重命名旧字段。独立回退文件 `003_user_management.down.sql` 只删除本模块表及版本标记；执行会丢失本模块数据，应先备份 SQLite 并停服。通用 `rollback` 命令会回退整个 Demo 模式，不应当作本模块回退使用。

浏览器 API 前缀固定 `/local-slash-demo/management`；后端前缀 `/admin-api/settlement-management/demo/management`：

- GET `session`、`catalog`、`groups`、`users`、`groups/:id`、`users/:id`。
- POST `groups`、`users`；POST `groups/:id` 或 `users/:id` 下的 `profile`、`status`、`fees`。
- POST `users/:id/review`、`users/:id/reset-password`、`fees/preview`。
- POST `reset/complete`（一次性令牌授权）。
- POST `session`（演示操作身份）、`member-login`，GET `member/me`。

写接口校验本地 Origin，运营接口验证独立 operator cookie；member cookie 无权管理。认证和重置完成接口限频，响应 no-store。用户返回对象使用字段白名单，费用从同一后端规则计算，客户端不决定最终费用。

## 费率规则

优先级：用户覆盖 → 所属组配置 → 系统演示默认。使用 `null/缺少配置` 表示继承，显式 0 表示免费，不混为一项。变更组归属后继承项实时使用新组费率，用户覆盖项保留。

| 业务 | 计费币种 / 精度 | 默认百分比 | 默认固定费 |
| --- | --- | --- | --- |
| USDT 充值 | USDT / 6 | 0% | 0 |
| USDT 兑换 USD | USDT / 6 | 0.50% | 0 |
| USD 兑换 USDT | USD / 2 | 0.50% | 0 |
| USDT 提现 | USDT / 6 | 0% | 2 USDT |
| 开卡、卡片充值、卡片转回、内部划拨、卡片消费 | USD / 2 | 0% | 0 |
| 外汇消费 | USD / 2 | 2% | 0 |

以上是内部 Demo 定价，不代表 Slash 收费标准。百分比存整数基点，固定费存整数最小单位，采用 BigInt：`ceil(amountMinor × bps / 10000) + fixedMinor`。金额、固定费上限 10^12 最小单位，百分比 0–100%。本期不设置阶梯费率、最低/最高费、历史生效区间或退款退费政策。

## 验证记录（2026-09-06）

- 自动化新增 8 项：初始化与筛选、审核开户、继承/零值/精确舍入、分组迁移、一次性重置与旧会话撤销、组停用限制、HTTP 权限/来源限制、按批次清理隔离。
- 全量 `node --test tests/*.test.mjs`：80/80 通过。
- TypeScript 检查与生产构建通过；现有 ApexCharts 大 chunk 提示仍存在。
- 浏览器实际完成登录、组目录、新增合成用户、审核开户，确认两个零余额币种账户和启用状态；点击整行进入详情；保存提现专属费率 1.25% + 2 USDT，输入100 USDT 后页面显示后端试算结果 3.250000 USDT。
- 独立临时批次实测 `management-init` / `management-clean`：仅删除管理记录，115条来源记录仍保留，随后清理测试批次。
- 密码实际更换、旧密码拒绝及会话失效通过内存数据库/API 自动化验证，没有修改任何真实用户凭证。

## 下一阶段接入边界

若要正式运营，还需将管理 API 接到真实后台的租户/管理员权限，定义客户与 Portal/Slash 的可靠映射，接入真实开户/KYC状态回调，将费用快照绑定报价和订单并落实扣费/退费账务，接入邮件或身份服务的密码重置。现有本地表和按钮不能作为这些生产能力已完成的证据。

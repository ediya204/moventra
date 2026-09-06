# Slash 真实数据接入现有本地后台

> 历史实施记录。当前同步已改为手动，取消5分钟循环；所属用户来自内部数据库，交易关联卡可独立补采。最新规则见 [当前状态](../current-state.md)、[手动同步](slash-manual-sync.md) 和 [交易抽屉](transaction-drawer.md)。以下历史命令依赖旧本地服务，未纳入GitHub。

## 当前仓库状态（2026-09-07）

旧本地环境曾运行真实只读采集与 8852 视图；Python 采集器、SQLite、凭据和循环任务未纳入当前仓库，也未部署到 Cloudflare/Render。本次未复查旧进程是否仍运行，不能据此宣称持续同步。

本页为历史设计/实现档案。下方的“当前”“已实现”“本次”均指原记录当时；历史端口、脚本、迁移、数据及测试结果不代表现有仓库可复现或生产已验收。当前能力与可执行命令见 [文档索引](../README.md)、[开发总纲](../DEVELOPMENT.md)。

## 历史记录正文

实施日期：2026-09-07（Asia/Hong_Kong）。用户授权将此前导出的两组各 20 张卡及交易导入当前后台，并持续更新。范围为本机 8852 的运营视图；不是生产部署、客户账本迁移或真实资金操作。

## 页面和数据归属

- `/cards?source=slash`：真实卡列表，固定本次导出的 latestCreated 和 recentConsumption 两组，各 20 张；当前并集 40 张。按组筛选、分页、详情、跳转单卡交易。
- `/transactions?source=slash`：账户已捕获的最近 30 天交易、来源金额和两层状态、单卡/关键词/状态筛选、详情。
- `/system/channels`：同步状态入口。卡片、交易页也显示相同状态与立即同步按钮。
- 原有 Demo 页通过 `source=demo` 保留。真实卡没有冻结、转账或扣款入口，不写入 ca_* / Go / Portal 钱包或资金台账。没有建立客户主体归属，因此不把真实数据映射给 Demo 客户或开放给 member。
- 非 slash-demo 模式的原有 cards/transactions 页面维持原有来源。

真实数据只位于后端 `services/api/.slash-preview/live.sqlite`；真实 key 位于既有 `.env.slash.local`，不进入前端或返回给浏览器。数据文件和配置受 Git 忽略与私有文件权限保护。字段白名单不含 PAN/CVV/OTP。

## 历史初始化与运行

在 `services/api` 中用已批准的导出批次初始化一次：

```text
历史命令（旧环境记录，当前仓库不可直接执行）：
python3 scripts/slash_live.py init --export-dir .slash-preview/exports/20260906T161919Z-6b3a135a
```

已存在的 live-config.json 不会被重复初始化覆盖。启动当前后台：

```text
历史命令（旧环境记录，当前仓库不可直接执行）：
cd apps/admin
npm run slash:demo
```

Node 后台启动时执行一次 GET-only Python 同步；每轮完成后 300 秒再次执行。无需打开浏览器，但电脑和后台进程必须保持运行。休眠/停服暂停，服务重启再次抓取。页面每 15 秒读取保存状态，支持手动触发；同一进程并发请求合并，跨进程 flock 防止两个同步者同时写库。单轮 240 秒超时后终止子进程，保留已有数据并报告失败。本次没有安装系统开机自启、云任务或 Webhook。

固定的 40 个 cardId 逐个刷新；不会每轮重新扫描 26893 张卡改变两组选卡排名。若要改为动态“最新 20 + 最近消费 20”，需另行定义更新成员和退组策略。

交易查询最近 30 天，最多 50 页，每轮 upsert 新增或改变的来源记录；保留已捕获历史记录，页面按当前时间窗口查询。每轮额外轮转查询至多 20 条未在本轮列表中的历史交易详情，包含 pending 与 posted；失败尝试也推进轮转，避免阻塞后续记录。不是全量补数、完整对账或即时订阅；游标未耗尽明确 partial coverage。即使游标耗尽，也无跨页同一时点保证。

## 服务端接口与授权

本地前端前缀 `/local-slash-demo/management/live/`，Vite 固定转发至本机 8862 的 `/admin-api/settlement-management/demo/management/live/`：

| 方法/路径 | 行为 |
| --- | --- |
| GET status | 同步状态、revision、上次成功/完成、下一次任务、错误、覆盖、余额来源值 |
| GET cards / transactions | 服务端分页、筛选和同范围汇总 |
| GET cards/:id / transactions/:id | 当前连接范围内详情 |
| POST sync，空对象 | 仅启动本地只读同步任务，202；不调用渠道写接口 |

列表参数白名单 page（从 0 起）、pageSize（默认 20，上限 100）、keyword、status、group（仅 cards）、cardId（仅 transactions）、revision。revision 不匹配返回 409，前端回到第一页/刷新读取。所有详情和列表均按连接和资源类型隔离，外部 ID 不裸查。

沿用已有本地 HttpOnly operator 会话，并由服务端私有配置额外限定 namespace 与 authorizedActors：本次仅 demo-operator 获得该连接读取/同步权限；未登录/member 拒绝 401，viewer/reviewer 拒绝 403，跨范围详情 404。每次读取/手动同步写现有本地审计。主 API 与 Vite 入口都限定 loopback，校验 Host、Origin、跨站 Fetch Metadata。

这是用户本机已有演示会话下的只读连接授权，不具备生产运营 MFA/租户授权。不能将此服务暴露到公网或用其替代生产安全层。生产接入仍需正式主体映射与 MFA。

## 金额、状态与失败处理

amountCents 保存十进制整数字符串，汇总使用 BigInt；来源 USD/scale=2 来自官方 Transaction 约定。仅当前窗口内有效日期、有效金额且 status=posted 进入汇总。pending/failed、费用注释不重复计入。posted/reversed 等组合保留原值并提示待核实；来源 posted 汇总不等于已确认结算、账户余额或可用资金。

余额按 cash/credit 等来源类型分开显示原始 amountCents；返回中未确认币种，明确标记未核实，不跨类型相加。缺失与零分别保留。

主抓取失败不发布部分写入，旧记录及 revision 保留；卡/余额/历史详情局部失败则保留对应旧值，状态为 partial。显示每条最近读取时点和错误、上次成功时点；超过阈值显示 stale。live_versions 保留内容变化，重复观察不重复创建版本；live_runs 保存请求审计和覆盖。观察时间为本地采集时间，不冒充渠道事件版本。

## 本次验证

- Python 27 项测试通过：原有导入/选卡 22 项，新增幂等更新、精度、失败旧值、历史轮转和账户隔离 5 项。
- Node 全套 147 项通过，其中 live 4 项覆盖真实连接范围、精确金额、日期未知、revision、operator/member/viewer、跨站、只读路由、审计、并发合并、任务调度和失败保留。
- React TypeScript / Vite 构建通过；实际浏览器验证真实卡与同步控件。最终运行数据/时间另见交付记录，运行批次保存在私有 SQLite。
- 真实渠道 GET 已执行；未调用金融写接口，未迁移或部署生产，未提交/推送 Git。

官方依据：[Card detail](https://docs.slash.com/api-reference/card-get-by-id)、[Transaction detail](https://docs.slash.com/api-reference/transaction-get-by-id)、[Transaction schema](https://docs.slash.com/api-reference/schema-transaction)。详情端点复用既有安全字段投影，card 请求显式 include_pan=false / include_cvv=false。

展示窗口按查询时的最近 30 天重新计算，sourceRequestInWindow 保留原抓取窗口标记。交易在抓取期间推进到新日期时，不沿用旧抓取区间的排除提示去解释当前汇总。

本次真实验证记录：初次从既有批次导入 40 张卡、5000 条交易；两轮更新成功后为 40 张卡、5011 条不同交易，revision=3，最近成功时间 2026-09-07 00:33:11（Asia/Hong_Kong）。两轮合计 206 次渠道请求，全部 GET。浏览器已核对更新成功、下一次 00:38:11、真实交易详情及近期消费组 20 条；随后为加载展示区间修正重启本地后台，启动任务自动继续。私有 live-acceptance.json 另记录 10 项实际 HTTP 断言；同步继续运行时上述数字只是该时点记录。

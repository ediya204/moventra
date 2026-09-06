# 卡 BIN 产品目录与客户端开卡

## 当前仓库状态（2026-09-07）

BIN 页面保留在 `apps/admin/src/bins`，客户端卡片原型在 `apps/client/src/portal`；生产无 BIN 管理或发卡 API。V1 已移除团队选择，以下团队字段仅反映历史版本。

本页为历史设计/实现档案。下方的“当前”“已实现”“本次”均指原记录当时；历史端口、脚本、迁移、数据及测试结果不代表现有仓库可复现或生产已验收。当前能力与可执行命令见 [文档索引](../README.md)、[开发总纲](../DEVELOPMENT.md)。

## 历史记录正文

实施日期：2026-09-06。本次只写入本地 SQLite Demo，不调用真实 Slash 发卡接口。

## 功能规划与落地

按“维护产品 → 上架 → 客户选择 → 后端校验 → 保存开卡快照 → 查询关联卡片”组织功能。BIN 前缀与卡产品分开理解：同一个 BIN 可以配置多个内部产品，产品 ID 才是开卡选择和关联的主键。

| 使用位置 | 已实现能力 |
| --- | --- |
| 后台 /card-bins | 产品列表、名称/BIN/ID 搜索、状态筛选、后端分页、点击整行进入详情；操作列放在末尾 |
| 后台 /card-bins/new | 创建名称、6/8 位 BIN、卡组织、USD 币种、公开说明、内部平台/上游参考、开卡数量上限 |
| 后台 /card-bins/:id | 编辑、状态维护、已开数量、维护记录、关联客户端卡片入口 |
| 客户端 /portal/cards/new | 产品单选、搜索、分页、BIN/卡组织/币种/说明/剩余名额展示、卡名称及团队选择 |
| 客户端 /portal/cards | 产品筛选、BIN/产品搜索、列表及导出显示 BIN 与产品名称 |
| 客户端 /portal/cards/:id | 展示开卡时的产品名称、BIN、卡组织、版本快照 |

界面复用现有 MUI、DataGrid、PageHeader、Microsoft 蓝色主题与响应式布局。

产品状态为本系统枚举：草稿不对客户端展示；上架可开卡；暂停展示但不能开卡；归档隐藏且不可重新上架。暂停和归档不会停用已创建的卡片。

## 数据模型、迁移与边界

增量迁移 `demo-server/slash/migrations/005_card_bins.sql` 随 `openStore()` 自动执行，增加两张表，不改动原有业务字段。

| 表/字段 | 含义及来源 |
| --- | --- |
| bin_products.namespace / id | 隔离 Demo 批次与内部产品 ID，联合主键 |
| name / bin_prefix / network / currency | 运营配置的展示名称、BIN 前缀、卡组织、币种 |
| platform / upstream_product_id | 内部发行映射参考；当前未接入真实路由 |
| status / max_cards | 内部产品生命周期与本批次产品累计开卡上限；不是上游库存，也不是单用户限额 |
| description / internal_note | 客户可见说明 / 后台内部备注 |
| revision / created_at / updated_at | 本系统配置版本及时间，不作为 Slash 来源更新时间 |
| bin_card_links | namespace + card_id 唯一；关联 product_id、开卡时 product_revision、snapshot_json |
| portal_state.cards[].binProduct | 同一开卡事务保存的前端可读产品快照 |
| mg_audit | 复用操作日志，记录 bin.create / bin.update，可从审计页跳转到产品 |

索引覆盖产品状态/BIN、关联卡片的产品查找；没有把 BIN 设为唯一键。已发卡产品锁定 BIN、卡组织、币种、平台和上游参考 ID。历史卡片快照不随产品改名变化。旧卡没有可靠映射时显示“BIN 未关联”，不根据后四位或卡名称推断 BIN。

6/8 位 BIN 格式依据 [Visa 官方术语表](https://developer.visa.com/pages/glossary)。本目录字段、生命周期、数量限制和关系都是内部模型，不是 Slash 官方字段。格式正确不代表发行机构、卡组织或渠道已经确认支持。

客户端接口采用白名单，不返回内部备注、平台映射或上游参考 ID。仅保存 BIN 前缀、后四位，不生成完整 PAN、CVV 或 OTP。

## 接口与一致性

API 基础路径为 `/admin-api/settlement-management/demo`；普通前端经 `/local-slash-demo` 固定转发本地服务，BIN 写入不会转发旧远程后台。

- GET `/portal/bin-products`：客户端产品列表，仅 active / paused，后端搜索分页。
- GET `/management/bins`、GET `/management/bins/:id`：后台目录与详情。
- POST `/management/bins`、POST `/management/bins/:id`：创建与维护，沿用本地管理会话和 Origin 校验。
- 原有客户端 action 接口的 open 动作新增 `productId`、`productRevision`；不接受客户端伪造 BIN、卡组织或产品快照。

开卡在同一数据库事务内校验产品存在、上架、配置版本和剩余名额，建立关联并保存状态及幂等记录。重试同一成功请求返回原结果；产品暂停或配置更新后，旧选择会被后端拒绝。数量上限不能调低到已开卡数量以下。

当前沿用单一本地 Demo 工作空间，尚未接入真实客户租户身份。真实发卡、客户/用户组可售范围、BIN 专属费率、多币种及实体卡是后续接入项。本次为 USD 虚拟卡模拟开卡，预算为 0、费用为 0，不执行扣款，也不将原有费率预览当成实际账单。

## 历史初始化与启动

在 `apps/admin` 目录运行，使用支持 `node:sqlite` 的项目 Node 环境：

```text
历史命令（旧环境记录，当前仓库不可直接执行）：
npm run slash:import -- --namespace slash-clearing-v1 --seed 20260906 --replicas 1
npm run slash:demo
```

重复执行 import 保留已维护的产品和既有客户端开卡记录。默认产品首次初始化三个；也支持首次读取目录时懒初始化。

| 默认产品 ID | 合成 BIN | 初始状态 |
| --- | --- | --- |
| DEMO-BIN-USD-VISA | 990001 | 上架 |
| DEMO-BIN-USD-MC | 99000201 | 上架 |
| DEMO-BIN-USD-RESERVE | 990003 | 暂停 |

这些前缀仅是合成测试值，不代表真实分配。实例由后台继续维护，当前状态可能已由操作者调整。

入口：正常本地前端 `http://127.0.0.1:8850/card-bins` 与 `http://127.0.0.1:8850/portal/cards/new`；隔离 Demo 前端使用相同路径、端口 8852；本地 API 端口 8862。后台写入需要已有的本地管理登录会话。

## 清理与回退

以下命令仅在需要重置演示时执行，不是正常启动步骤。

```text
历史命令（旧环境记录，当前仓库不可直接执行）：
# 只重置该批次客户端工作流与 BIN 开卡关联，保留产品配置
node demo-server/slash/cli.mjs portal-reset --namespace slash-clearing-v1

# 删除该批次全部 Slash Demo / 管理 / 客户端 / BIN 数据
npm run slash:clean -- --namespace slash-clearing-v1
```

`management-clean` 会清理管理数据和操作日志，不清理 BIN 产品目录。完整批次 clean 使用外键级联，不影响其他命名空间。

迁移提供 `005_card_bins.down.sql`。结构回退应停服、备份本地 `demo-server/slash/data/projection.sqlite`，同时回退应用代码后执行；只运行 SQL 会留下客户端状态中的历史快照，重新启动新代码又会创建表，不能视为完整功能回退。既有全量 `cli.mjs rollback` 会回退整个 Demo 结构，且要求先清理所有 Demo 批次，不能用于仅撤销 BIN 功能。

## 验证记录

```text
历史命令（旧环境记录，当前仓库不可直接执行）：
node --test tests/*.test.mjs
npm run build
```

93 项自动化测试通过，其中 `tests/card-bins.test.mjs` 新增 6 项：目录幂等/分页/白名单、开卡快照与重复提交、伪造与过期配置/暂停/归档/限额拒绝、旧卡兼容与产品筛选、乐观版本与命名空间清理、HTTP 鉴权与 Origin 校验。构建通过；现有 ApexCharts 大体积 chunk 提示仍存在。

浏览器已完成产品选择到创建卡片、详情显示、后台数量联动与已发卡身份字段锁定的检查。验证卡片：

- ID：`DEMO-CLIENT-0ac7b9e7-ee24-4a0b-9ff0-747e7483e4ee`
- 名称：Demo BIN 选择验证；后四位：1478
- 产品：DEMO-BIN-USD-VISA；BIN：990001；开卡快照版本：0
- 开卡记录金额：0 USD；初始卡预算：0；没有真实发卡或资金操作

真实上游 BIN 支持范围、产品映射与发卡授权、费用扣款和租户隔离不在本地验证范围内。

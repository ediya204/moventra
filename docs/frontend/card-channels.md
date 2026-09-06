# 发卡渠道与 BIN 产品关联

2026-09-06 本地实现。入口：`http://127.0.0.1:8852/card-bins/channels`（正常本地前端端口 8850 同路径）。卡 BIN 管理新增“卡BIN产品 / 渠道管理”分栏。

## 8 个 BIN，只先添加 1 个

1. 创建一个 Slash 渠道，记录名称、实体参考 ID、账户参考 ID（可选）。同一实体/账户范围复用该渠道。
2. 在渠道详情展开“导入 / 补充产品目录”，复制 Slash `GET /card-product` 返回的 `items`，预览后导入。
3. 目录列出 8 个产品时，只对需要开放的产品点击“添加卡BIN产品”。渠道、上游产品 ID 和 BIN 自动带入；填写展示名称、卡组织等资料后保存。
4. 保存草稿只建立关联；上架后才在客户端选择列表展示。后续新增第 2 个，只需回到同一渠道的目录继续添加。
5. 也可编辑已有、尚未发卡的卡 BIN 产品，选择渠道及上游产品；已发卡产品不允许静默换渠道，应新建产品。

计数中的“已关联”按不同上游产品 ID 去重，包含草稿和归档的内部产品，不等于已经上架。同一上游产品可以关联多个内部产品。未关联产品可单独筛选；目录支持后端搜索、分页。

## 官方字段与本地字段

[Slash 产品目录](https://docs.slash.com/api-reference/card-product-get) 返回 `items[].id`、`prefix`、`status`，并提供 `metadata.nextCursor` 分页。[创建卡片](https://docs.slash.com/api-reference/card-post) 使用 `cardProductId` 选择产品；`cardGroupId` 是另一个字段，不能混用。

本系统复用 `bin_products.upstream_product_id` 保存该产品 ID，通过渠道关联限定其范围，不额外创建同义字段。BIN 字符串不是发卡路由主键，也不能用于推断卡组织、币种或开户权限。

人工导入只保存 id/prefix/status 白名单，保留原始来源状态。当前仅 `active` 允许后续开卡；其他值保留原值并阻止开卡。导入支持数字1–8位 prefix，只有6/8位可以进入现有 BIN 表单；异常长度整批拒绝，不处理完整卡号。

导入每批1–100条，分页数据需逐页导入。仅更新本批给出的产品，不把遗漏产品视为已删除。重复未变化的记录不重复插入；目录被更新或渠道配置变动后，旧版本导入会被拒绝。已有内部关联的上游产品更改 prefix 时，整批回滚并要求核实。仅人工导入的目录无法自动发现上游后续停用，需要再次导入最新目录。

## 存储、接口与保护

增量迁移 `006_card_channels.sql` 添加：

- `card_channels`：命名空间、渠道身份、实体/账户参考范围、本地状态、版本、备注与采集配置时间。
- `channel_products`：namespace/channel_id/source_id 联合主键，保存 prefix、来源状态、本系统版本及人工采集时间。
- `bin_channel_links`：namespace/product_id 联合主键，关联渠道；保留现有产品与已开卡记录。

复用 `mg_audit`，新增 channel.create / channel.update / channel.import，操作日志能跳转渠道详情。渠道暂停独立于内部产品状态；客户端列表给出不可开卡原因，后端每次开卡重新校验渠道与来源状态，不只依赖浏览器禁用按钮。

`management/channels` 提供列表和创建，`management/channels/:id` 详情和维护，`/:id/products` 查询目录，`/:id/import` 人工导入。全部沿用本地管理会话、Origin 校验和固定 loopback 代理。客户端不接收渠道范围、上游产品 ID、内部备注等配置，仅收到可读的不可开卡原因。

迁移随本地服务启动执行，不修改现有表列，也不猜测已有卡片的渠道。提供 `006_card_channels.down.sql`；回退需要停服、备份本地数据库并配合回退代码，重新启动新代码会重新建表。现有命名空间清理会级联清理渠道目录，其他命名空间不受影响；只执行结构 down 会移除绑定，不能视为完整历史恢复。

## 验证与示例

`node --test tests/*.test.mjs`：103 项通过，新增5项覆盖8产品逐步关联、追加/重复导入、不同实体隔离、prefix不匹配、整批回滚、已发卡不可换渠道、渠道暂停/未知状态阻断、字段白名单、鉴权与跨来源拒绝。`npm run build` 通过，仍有现有 ApexCharts chunk 大小提示。

浏览器已验证创建渠道、导入8项、关联其中1项并保存草稿：

- 渠道：`DEMO-CHANNEL-c9296ab6-1764-4b06-90ee-ff63e288ecf4`，名称“Slash · 8 BIN 示例”。
- 上游示例：`DEMO-SLASH-PRODUCT-1` 至 `DEMO-SLASH-PRODUCT-8`；合成 prefix 990101–990108。
- 已关联内部产品：`DEMO-BIN-148740c6-91cc-4af4-b3ff-c9fd027c5c55`，名称“Demo · 990101 渠道关联验证”。
- 页面结果：共8个、已关联1、未关联7。没有替换此前产品或卡片。

## 当前边界

本次为本地人工目录与关联管理，未连接真实 Slash、未拉取你的实际8个 BIN、未发送发卡请求。页面不采集 API Key/MLE Secret。真正自动同步需另行接入服务端凭据配置、实体授权、分页拉取及失败处理；人工登记不等于连接测试成功。渠道当前只提供 Slash 配置，其他平台适配器尚未实现。现有本地开卡继续只支持 USD 虚拟卡，费率与真实扣费不在此功能中。

与跨项目 [开发总纲](../DEVELOPMENT.md) 及 [接口草案](../api/contract.md) 的差异：这是既有 SQLite Demo 的局部扩展，不是 Go `/admin-api/v1/channel-connections` 的实现；继续采用本地演示操作员会话，未接入 Go 的客户授权、运营 MFA 或 staff_grants。目录采用 limit/page 查询和最新配置修订，未实现生产游标快照、历史来源观察链、真实连接能力探测或覆盖证明。上述项阻塞生产接入，负责人待分配；本次只验证本地 namespace 范围和现有本地管理边界，不声称生产多租户验收通过。

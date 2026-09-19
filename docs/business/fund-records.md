# 统一资金记录

2026-09-19，FLOW-FUND-RECORDS-001。运行源码b1b27fb已发布API及两端Worker；真实渠道与真实登录后的数据查询未验收。精确版本与本轮验证见[发布记录](../../deploy/2026-09-19-fund-records-release.md)。

## 目标与数据口径

客户端在交易菜单下提供 `/portal/fund-records`，后台在卡交易流水下提供 `/finance/fund-records`。两端使用同一只读查询；客户仅本人数据，后台按各来源授权。消费、消费退款继续在卡片交易。

记录是业务金额分项：充值、提现、卡充提、OTC、人工出入金及冲正、开卡费、首充、手续费、明确的费用/首充退回。本金与费用分开，开卡费和首充同订单关联；零费用不额外生成收费行。待审核、处理中、失败与未知结果仍可查询，不能把列表当作已入账收支汇总。内部划转与首充退回标记内部方向，不累计为外部收入。预占、释放只在详情显示；来源消费分录不产生资金记录。

仅覆盖当前资金运行 namespace 及匹配运行模式的历史开卡专用钱包。查询读取 `crypto_orders`、`manual_funds_orders`、`issuing_orders`、历史 `issuing_deposits`，从既有账本关联入账证据；不读取完整渠道原始载荷、不创建或修复分录。现存来源未形成已归属业务记录的事项不伪造补齐。

## 流程卡

| 项目 | 本批规则 |
| --- | --- |
| 基线 | Moventra main `67dedf5`；保留前轮6份草稿后实现；42项冲突已由统一发布任务解决 |
| 目标及范围 | 两端从菜单进入、筛选分页、详情、同单/同卡/原记录关联、返回；本地与隔离数据库验收 |
| 页面关系 | 列表路径如上；详情使用列表 URL 的 `?record=:recordId` 打开右侧抽屉，筛选/分页与背景列表保留；旧 `/:recordId` 深链也打开抽屉；刷新单独请求授权详情（2026-09-19 抽屉为本地未部署增量） |
| 业务身份 | ID=`source_orderUUID_component`，退款组件含 operation UUID；历史专用首充退回用原订单 UUID；不能裸用上游卡 ID |
| 接口链 | FundRecords → fundRecordsGet / 精确 GET 白名单 → Cloudflare fund-records → Go authenticate / fundRecordAPI → fundrecords SQL / 同事务读取审计 |
| 数据依据 | 三类持久订单及旧开卡钱包入金；统一账本与历史专用开卡账本分别关联，不改账本权威 |
| 状态及操作 | 仅查询、筛选、刷新与导航，无审批、执行、补同步或付款；业务状态与入账状态独立 |
| 跨端变化 | 查询同源事项；用户刷新后获取最新状态，不后台自动发起业务动作 |
| 权限 | 客户 personal_owner_id；后台角色/MFA，crypto read、manual read、issuing customer:read 分别校验；直接换 ID 返回404；审计失败503 |
| 异常恢复 | 加载、空集、筛选空集、无权限/不存在、API故障与重试；旧响应被取消并忽略，不覆盖新筛选 |
| 验收 | E01–E06、E08–E09；E07验证重复读取不增分录、同单不同证据不重复生成列表；不涉及资金写入 |
| 待定决策 | 本批无未定业务政策；已由唯一发布入口完成发布；真实认证和线上查询仍待验收 |

## 查询与兼容

- 两端 GET `/{client|admin}-api/v1/fund-records` 和 `/{recordId}`。列表支持 `kind/status/currency/from/to/cardId/customerId/q/page`；单值参数，日期 RFC3339、UTC `from` 包含/`to` 不含，金额保持最小单位字符串。分页20条，`created_at DESC,id DESC`，计数与页面同一SQL快照。
- 前端默认全部类型/状态，类型、状态、币种为下拉框；日期、关键词和卡ID输入，后台增加客户ID。关键词匹配订单号、后四位、地址、交易哈希。改变筛选重置页码；没有日期限制不冒充全渠道历史。
- 卡ID统一为 `funds_cards.id`，不是 `ledger_accounts.id`；卡充提按 namespace/customer 精确关联，开卡按 namespace/customer/connection/external card 关联。同一张卡的费用、首充与后续充提可一起过滤。
- 充值详情除订单引用，还使用持久订单自身 `evidenceRef` 关联 `Ledger.RecordCrypto` 证据，限制同 namespace/customer。历史专用开卡使用既有哈希引用关联 reserve/fee/fund/unfund/release/deposit。无法关联时展示无可展示明细，不伪造流水。
- API只依赖001–020既有表。没有查询消息021和开卡022新增表，不要求新迁移或打开执行开关；查询也不调用Blnk、Slash或Cregis。历史开卡专用记录仅在配置的 matching live/prepare 或 isolated 模式包含；未配置不推定为完整历史。
- 旧 `/portal/funds/history` 及其订单深链保持兼容；交易页“查看资金记录”改到新入口。无导出扩展、资金汇总、生产迁移或执行能力变更。
- 当前每页按独立查询快照排序；连续翻页间若新增业务，offset页面可能移动，刷新重新查询。未做真实大数据量压测，不声明全量容量。

## 本轮证据

设计及本地实现已按用户批准范围完成；本轮验证如下（2026-09-19）：

- 隔离 PostgreSQL 全套 `test-postgres.sh` 通过；最终 `TestFundRecords` 再以 `-race -count=1` 通过。覆盖来源授权及撤权、跨客户拒绝、运营 MFA、组合筛选与分页、超大金额、OTC、开卡拆项/退回、未知结果、重复读取不增加分录、审计失败及环境隔离。
- 兼容测试删除消息021/开卡022新增结构，生产展示模式使用无渠道客户端的只读服务，列表和详情仍通过；拒绝生产模式误读 shadow。充值按持久 evidenceRef 关联，卡过滤使用 funds_cards.id，均有专项断言。
- 两端 `pnpm typecheck`、`pnpm build`，Go `vet ./...`、`build ./cmd/...` 通过；构建保留既有大 chunk 提示。
- 浏览器使用隔离合成数据和真实共享页面验证：筛选、27条跨页、详情刷新、返回保留查询、后台客户列与过滤、服务失败恢复、筛选无结果。390×844手机视口检查无页面横向溢出，表格内部横向滚动。此证据不等同完整登录后的两端端到端或真实渠道验收。
- 前端/网关全套191项通过（0失败、0跳过），文档检查通过；本轮未连接生产数据库、未迁移、未提交/推送或部署、未调用真实金融写接口。

复现入口：`NODE_OPTIONS=--experimental-strip-types pnpm test`、`bash services/api/scripts/test-postgres.sh`、`pnpm typecheck`、`pnpm build`、`pnpm docs:check`。浏览器隔离预览：`node tests/frontend/fund-records-preview.mjs`，`http://127.0.0.1:8896/portal/fund-records` 或 `/finance/fund-records`，仅合成查询，不接受业务写入。

回退：移除新导航与路由注册即可恢复旧查询入口；本批无迁移、无需要撤销的资金写入。

## 最终交接文件范围

以下为本任务完整文件范围；统一发布任务按此核对，不批量暂存无关文件。无 SQL 迁移文件。

```text
apps/admin/README.md
apps/admin/src/App.tsx
apps/admin/src/admin/navigation.ts
apps/admin/src/operations/FundRecordsPage.tsx
apps/admin/src/operations/navigation.ts
apps/client/README.md
apps/client/src/portal/CardSnapshots.tsx
apps/client/src/portal/ClientHome.tsx
apps/client/src/portal/workspaceNavigation.ts
deploy/cloudflare/fund-records.mjs
deploy/cloudflare/gateway.mjs
docs/README.md
docs/api/contract.md
docs/business/fund-records.md
docs/business/routes-and-api.md
docs/catalog.md
docs/current-state.md
docs/domain/transactions-and-funds.md
docs/testing/financial-scenarios.md
package.json
packages/shared/README.md
packages/shared/src/auth/fundRecordsApi.ts
packages/shared/src/auth/fundRecordsContract.ts
packages/shared/src/finance/FundRecords.tsx
services/api/README.md
services/api/docs/openapi.json
services/api/internal/api/fund_records.go
services/api/internal/api/fund_records_test.go
services/api/internal/api/server.go
services/api/internal/fundrecords/query.go
services/api/internal/fundrecords/records.sql
tests/frontend/client-workspace.test.mjs
tests/frontend/fund-records-preview.mjs
tests/frontend/fund-records.test.mjs
```

## 发布补充

本发布任务复跑191项前端/网关、隔离PG race、两端构建、Go vet/build与文档检查均通过；线上74份JS/CSS与产物一致，API健康、未认证拒绝及跨端隔离通过。没有生产迁移或真实资金操作，前文“未提交/部署”属于实现任务结束时的历史证据。

## FLOW-FUND-RECORDS-002：详情抽屉（2026-09-19，本地未部署）

基线 main `9f747ab`，保留人工资金与开卡等已有未提交改动。用户要求取消独立详情页；两端复用右侧580px抽屉，手机占满宽度，支持关闭按钮、遮罩及Esc。列表组件持续挂载，筛选、分页和滚动位置保留；URL选择对象，刷新与前进/后退可恢复，旧详情路径兼容。详情与列表各自加载和重试，关闭取消详情请求，旧响应不能覆盖新对象。

接口链、业务身份、数据来源及权限沿用 FLOW-FUND-RECORDS-001，只读API与金额/状态契约不变，UI参数record不发送到列表API。关联卡/同单入口关闭抽屉并进入筛选列表；原记录仍在抽屉查询。无新增业务操作或跨端状态写入，无待定政策。

本轮8项资金记录自动化、边界检查、两端类型检查与构建通过；合成浏览器验证客户端打开、刷新恢复、Esc关闭，后台第二页打开、前进/后退与390px单栏抽屉。全量前端回归中已有 `issuing-checkout.test.mjs:28` 因循环对象 JSON 序列化失败，且进程未退出，约79秒后终止该测试子进程；未认定全量通过。未执行真实认证/渠道验证、生产操作或部署。

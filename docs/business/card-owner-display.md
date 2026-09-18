# FLOW-CARD-OWNER-01：正式后台读取既有归属

2026-09-18。基线 origin/main 812e5ae；独立 codex/card-owner-display 工作树，保留共享目录及其他任务的改动。

## 范围与接口链

目标：已保存的内部逐卡分配，在后台全部卡片、卡片详情及交易详情显示同一内部用户。入口 `/cards?connection=...` → `/cards/:id?connection=...` → `/transactions?connection=...&cardId=...` → 交易抽屉。保留现有筛选、分页和返回上下文。

页面 liveGet → Cloudflare 既有 channel-projections GET 白名单 → Go channelRead → 同事务查询来源和内部归属 → 原子读取审计。客户端查询及字段裁剪不变。无需新增绑定写接口、迁移、渠道采集或重新分配；不从卡片随机姓名、尾号或 Slash cardholder 推断归属。

数据权威：project_wallet_cards 按连接/cardId 读取，校验记录的父账户和 virtualAccountId；未加入项目钱包的客户兼容 customer_card_bindings 测试快照。项目钱包客户的旧宽范围快照继续不参与查询。归属不以当前导入 revision 为键，因此新导入不清除既有绑定；测试绑定仍标注测试快照，不声称资金所有权或扩大客户端范围。

## 权限、状态及契约

后台保持 active/admin、MFA、staff_grants 和 channel_read_grants；仅在已授权连接的记录里返回所属用户的内部 userId、customerId、display_name（空名回退客户名/ID），不读取邮箱、Firebase UID 或更多身份字段。既有注册用户目录已允许有效管理员读取基础身份，此处不新增角色或资源授权。客户 DTO 不包含归属对象。

保留 assignmentKind=project_wallet|test_snapshot|unassigned；新增 internal={ownershipStatus,customerId,userId,customerName}。ownershipStatus 为 bound、unassigned 或 scope_mismatch；后者表示已有项目绑定但当前来源账户范围不匹配，不输出身份。前端分别显示用户姓名、未绑定、归属范围待核实；旧 API 缺少归属字段显示已分配（对应类型）或归属未查询，不能误称未绑定。交易展示当前卡片归属，不声称交易发生时的资金归属。

## 验收

E01/E03/E04：真实 handler 的卡列表/详情、交易列表/详情返回一致归属；真实 React 页面验证显示、刷新、失败恢复。E05：缺少 MFA、客户身份、跨连接、撤销授权拒绝；客户端不泄露内部身份。E07/E08：新版本导入后绑定保留，新卡不自动归属，同名/同尾号/跨连接同 ID 不混淆，分页和计数不变。E09：审计失败不返回身份，旧快照客户切换项目钱包后不恢复宽授权。

设计已明确；本地实现、自动化测试、浏览器验收结果待本轮补充。真实渠道不调用。生产数据库、迁移、部署未授权且未执行。

## 本轮执行结果

- 本地实现完成：仅扩展已授权后台 GET 的归属查询和显示，无写入路径、迁移或绑定变更。
- `bash services/api/scripts/test-postgres.sh`：全新本地随机 PostgreSQL 库，race 模式 38 个顶层测试通过，真实 Firebase、Blnk 集成两项因未配置跳过。新增归属测试通过；补充快照新版本保持断言后，四项渠道/绑定重点测试再次通过。
- `pnpm test`：105 项通过，包含实际 React 列表、深链详情、刷新失败恢复及交易抽屉一致性；完整旧导航测试继续通过。
- 后台 typecheck、`pnpm build:admin`、Go vet/build、git diff --check 通过。构建保留既有大包提示。
- 浏览器：本轮打开正式页面跳转至登录，未取得已登录业务响应；没有把合成测试作为线上本人验收。真实渠道验证不适用（未修改渠道协议或调用）。
- 部署：未执行。需要发布配套 Go API 和后台 Worker；无需数据库迁移或重新绑定。主共享工作区未修改。

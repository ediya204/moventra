## FLOW-ISSUING-NAME-001：内部卡名与渠道 holder 分离（2026-09-18）

用户确认：卡片名称是本系统开卡时随机分配的姓名；Slash holder 采用渠道默认，通常只配置少量 holder，不用于客户身份或卡片命名。

- 基线：main / ce0a88a，工作区已有未提交开卡功能及其他改动，本次仅增量修改上述流程。范围为本地正式 issuing 模块；历史导入卡不批量改名。
- 路径/接口：`/portal/cards/new` → POST quotes → POST orders → 服务端从 100 个英文姓名均匀随机选择 → PostgreSQL `snapshot.cardName` → Worker POST /card 的 name → 两端 GET orders 列表/详情显示同一 cardName；客户端详情 `/portal/card-orders/:id`，后台客户页 `/card-bins/customers?customer=UUID`。源同步继续读取渠道 name。
- 名称允许重复，内部订单/卡 ID 保持唯一。生成发生在首次有效订单提交，幂等返回不重新随机；补充首充复制原卡快照。随机失败则提交失败，不使用临时名字。历史订单缺少 cardName 返回空字符串并显示“卡片名称未生成”，不伪造历史随机结果。
- 新 Slash 快照不读取客户 holder 绑定，不因 holder 缺失阻塞；请求省略 cardholderId，不创建新的 holder。已冻结的历史订单仍沿用原 holder，避免改变在途操作。客户资格、MFA、服务状态、供应商范围及资金校验保持。
- 后台资格只配置 enabled/groupId；响应不返回 cardholders，页面无 holder 输入或展示。旧三个字段作为弃用输入保留兼容，历史存储不删除；新 Slash 开卡不采用旧客户绑定。
- 官方依据：[Create card](https://docs.slash.com/api-reference/card-post)，本轮公开文档核验 name 必填、cardholderId 可选。默认 holder 的实际选择由渠道负责；未执行真实发卡验证，不承诺具体默认 ID。
- 验收：100 个不重复候选、随机值属于池、默认 holder 请求省略、名称持久化及同键重试、原卡补充首充不改名、资格响应不暴露 holder；沿用隔离数据库/fixture，正式部署和真实金融调用未执行。
- 待核实：渠道运营在真实接入阶段核验默认 holder 可用性；不阻塞本地开发。浏览器登录全流程仍需单独验收。

本次名称变更验证结果（2026-09-18）：`pnpm typecheck`、`pnpm test`、`pnpm build` 通过；补充姓名展示组件测试 `node --test tests/frontend/issuing-ui.test.mjs` 2/2通过；`bash services/api/scripts/test-postgres.sh` 随机隔离数据库、全 Go race 测试通过（含 TestIssuingFullFlow、TestCardNamePool、TestSlashBoundary）；`git diff --check` 通过。Blnk/Slash 为 fixture，未进行真实渠道、登录浏览器流程或部署验收。构建保留既有大包提示。

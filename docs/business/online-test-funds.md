# FLOW-TEST-FUNDS-01 正式登录后的测试资金流程

2026-09-18。用户授权把已有资金页面接入正式登录并补齐服务端接口，承接线上测试余额授权。基线414e2b3，独立codex/online-test-funds-20260918工作树，不覆盖共享目录。

| 项目 | 范围与设计 |
| --- | --- |
| 页面 | 客户 `/portal/funds`，`deposit`、`fiat-deposit`、`exchange`、`withdraw`、`history`、`orders/:id`；后台 `/finance/test-funds/:customerId` 和 `/orders/:id` |
| 复用 | 沿用现有资金页面的信息结构、白底卡片、表单及订单详情模式；生产组件以字符串金额和新契约驱动，不加载DEV Portal状态机 |
| 权威 | 原008不可变测试额度为期初；009独立订单、报价、逐币种配平的测试变动、操作审计及幂等结果；不接Blnk/真实渠道 |
| 接口链 | 客户/后台组件 → Firebase同域transport → Cloudflare精确白名单 → Go角色/MFA/所有权或独立测试审批授权 → PostgreSQL事务 |
| 客户权限 | 既有个人所有权、明确测试额度；新操作还需approved/active。停用服务仍可查询和取消尚待审批的提现 |
| 运营权限 | admin+MFA+逐客户online_test_funds_review_grants；CLI仅能对指定测试客户将其既有onboarding:review运营授权为测试资金审核人，不扩大到其他客户 |
| 充值 | USD/USDT申请pending → 后台模拟检测confirming → 后台模拟确认completed；取消/拒绝/失败不增余额；不生成收款二维码或真实银行资料 |
| 兑换 | 服务端60秒报价，固定测试1USDT=0.99USD，同一比例反向计算；0.5%费用向上取整，收款向下取整；确认在同事务扣卖出、增买入，仅用一次 |
| 提现 | USD/USDT申请pending_review预占本金+费用（USD为0，USDT为2）；运营批准processing，未知unknown继续占用；模拟完成才入账扣除，失败/拒绝/客户待审取消释放 |
| 归属 | 每个订单固定customer和创建人；直接详情查库，不依赖列表缓存；审批人不能为订单创建人；不接触真实卡片与其余额 |
| 可靠性 | 所有变动锁同一客户，幂等键绑定操作者/客户/请求内容；订单revision防过期处理；资金变动/订单/事件/幂等结果原子提交，审计失败回滚 |
| 页面恢复 | 列表筛选与页码保存在URL；订单稳定深链；写请求待确认幂等键保留于sessionStorage，重试复用；成功后重查余额和订单，后台与客户读取同一事项 |
| 完整性 | 列表20条分页并返回总数；钱包汇总全部测试变动和全部有效预占，不跨币种相加 |
| 边界 | mode=online_test、executionEligible=false、withdrawalEligible=false是实际资金执行资格；页面所有操作明确为模拟，不提供真实转账或真实收款地址 |
| 验收 | 幂等/并发余额不足、跨客户/缺MFA/未授权/未开通、报价过期和消费一次、审批非结算、未知不释放、拒绝/失败释放、原始资金表不变、失败重试与深链 |

这批实现只处理已授权测试资金。汇率、费用为明确的测试策略test-v1，不代表商业或渠道报价。设计、本地实现、自动化、浏览器、线上部署与真实渠道验证将在交付时分别记录。

## 本次验证（2026-09-18）

- 前端及网关 96 项测试通过；两端 TypeScript 检查、生产构建通过。构建保留既有较大 chunk 提示。
- 隔离 PostgreSQL 的 Go 全套 race 测试、`go vet ./...`、API 编译通过；新增 HTTP 集成覆盖报价过期和他人报价拒绝。需要独立 Blnk 进程的历史测试按环境跳过，本批不连接 Blnk。
- Cloudflare 客户端与后台 dry-run 通过。
- Render 新备份：2026-09-17T17:54:00Z，SHA-256 `38ed169383fb46b29dc6f536b92009281c44bfaaf659f796ef5755f12531969a`。已在新建本地测试数据库恢复 moventra，连续两次执行选择性迁移，版本从 `1,2,3,4,5,7,8` 变为 `1,2,3,4,5,7,8,9`，未启用006。原始测试额度仍是USD 10000000 minor、USDT 20009000000 minor，新订单0。恢复数据库已清理。
- 发布前线上10张原始表的计数与内容摘要已留存，以便发布后核对。真实渠道执行未进行。

## 线上发布结果

- GitHub `main` 功能提交 `9906385a4353d16c1446baf7dd22019c0f2146ac`。
- Render API 部署 `dep-dam2kdlbedkc73aejf50` 为live；`/readyz`返回ready。
- 009迁移及重复执行job `job-dam2sc6k1f9s73e99id0` succeeded；最终版本 `1,2,3,4,5,7,8,9`。
- 为目标账户既有唯一开户审核人增加独立测试资金审核授权：job `job-dam2smoae00c73ctal7g` succeeded；首次newGrants=1、重试=0；realFundsPermission=false。
- Cloudflare 客户端 `moventra-web` 版本 `e9208e76-a654-475b-b4c4-111c3c7fd7f8`；后台 `moventra-admin` 版本 `a79d29a8-f2d4-4833-b7f4-823621314c61`。
- `/portal/funds`、`/finance/test-funds` 在线HTML及各自页面JS与本次构建字节一致；两端新API未认证GET/POST均401、错误方法405、跨站API404，响应no-store。HTTP成功仅证明资源发布，拒绝测试仅证明访问边界。
- 发布后job `job-dam2suou01pc73b9iha0` succeeded：10张原业务表计数与内容摘要完全未变；测试grant仍1条、USD 10000000 minor、USDT 20009000000 minor；新增订单0、资金变动0、审核授权1；客户approved/active。没有额外模拟扣款或真实资金操作。
- 浏览器检查：实际OnlineFunds组件与正式主题在隔离本地视觉夹具渲染，余额、导航及兑换表单可见；夹具不连接生产、不发送写入。线上浏览器出现网络加载错误，未完成真实客户登录及运营MFA后的下单/审核人工验收。自动化HTTP集成已覆盖完整状态流程，不能替代这项线上人工验收。
- 回退：可将两端Worker及API回退到前一版本；008/009为附加表，保留审计数据，不删除或反向修改额度。恢复旧版008页面会显示期初额度，因此有测试订单后应暂停测试操作并以前述完整余额接口复核，不能把旧版展示当当前可用余额。

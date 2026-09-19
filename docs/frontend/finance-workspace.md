# 资金与财务工作台

2026-09-19，本地实现，待统一发布。范围为后台正式财务路由；不调整客户端业务、账本计算、接口或生产开关。沿用 [UI 规则](ui-theme.md)、[人工资金](../business/platform-advance.md)、[数字货币资金](../business/cregis-funds.md)与[资金记录](../business/fund-records.md)。

## FLOW-FINANCE-UI-002

| 项目 | 本轮范围与依据 |
| --- | --- |
| 目标 | 运营从财务二级列表进入客户、订单或费率三级详情，并保留查询上下文返回；本机合成预览验证 |
| 基线 | 起始 main `0677a8c`，收尾观察 main `b77c222` 与共享工作区增量；保留第一轮余额详情和并行人工资金政策、资金抽屉、安全设置等修改；未自行提交/部署 |
| 页面关系 | `/finance/balances` → `/:customerId` → `/orders/:orderId`；`/finance/crypto-flows`、`/finance/otc`、`/finance/withdrawals` → `/orders/:orderId?customer=...`；`/pricing` → `/products/:productId`；`/reports?days=...&view=summary\|daily\|analysis`；关联 `/finance/fund-records?record=...` 抽屉 |
| 业务身份 | 沿用 customerId、orderId、productId、资金记录来源ID；不生成或重绑客户/卡片/账本身份 |
| 数据依据 | 既有 PostgreSQL 订单、账本与授权交易投影；查询汇总不混币种、不推算未知金额、不把统计流量当余额；预览全部为合成数据 |
| 接口链 | 余额/manualRequest、cryptoRequest、issuingRequest、fundRecordsGet、报表liveGet → 原同域网关白名单 → Go授权handler → 既有持久查询；请求路径与写入载荷不变 |
| 状态与操作 | 查询、配置与审核分开。配置页不再混列订单；订单只在有对应动作权限及待处理状态时显示操作说明。审核、渠道、链上、记账各自展示，不合并状态；未知结果仍恢复同一幂等请求 |
| 跨端变化 | 仅后台加载财务样式作用域；共享组件的客户端资金行为与权限保持。原轮询/提交重查继续工作，未新增跨端事件 |
| 权限 | 既有运营MFA、客户scope、read/configure/review/recover、人工create/execute与服务端授权继续生效；直接settings参数不向只读运营展示编辑表单 |
| 异常恢复 | 加载不预先宣称是隔离账本；读取失败与无记录分开。原错误与同键重试、分页保留。新报表view写入URL，日数不因切换视图重置 |
| 验收 | 两端类型/构建、相关资金组件/权限/金额/报表回归；浏览器合成数据验证多级页面、配置返回、手机无页面横向溢出。最终执行结果见下节 |
| 待定决策 | 无新增业务政策；真实身份、渠道和生产上线由统一发布任务另行验证 |

## 当前设计

- 统一26px主标题、薄边框、低饱和背景、明确操作层级；金额等宽数字右对齐，状态保留中文并配语义色。
- 余额查询将关键词、服务状态、币种和查询放进同一工具栏，按币种显示当前筛选汇总；沿用第一轮客户详情。
- 数字货币流水、OTC、出金审批共用客户范围栏、双币种钱包摘要和订单表；订单详情以申请/到账/手续费为首，状态、地址、操作、账本与时间线分区，客户钱包折叠查看。
- 费用配置保留独立双向价格、默认/分网络/卡片费用和启用开关；输入空白、零、未配置的含义保持。配置与订单列表分开，返回保留客户、状态、页码。
- 产品费率三级页为左侧产品及默认价、右侧专属覆盖价编辑；原定价组、产品默认价与审计链接继续通向已有模块，本轮未改造整个卡产品管理模块。
- 资金经营报表使用收支概览、每日明细、交易分析三视图；CSV、香港时间、投影覆盖与资金口径保留，首屏不再同时展开全部图表和明细。
- 资金记录默认显示业务、状态、币种和关键词，高级日期与关联ID可展开；URL中已有高级条件会展开，不改变查询字段或抽屉深链。
- 手机按单列/双列适配摘要和表单；表格在内部横向滚动，关键字段与操作不删除。

## 本地预览

运行 `node tests/frontend/finance-preview.mjs`，访问 `http://127.0.0.1:8907/finance/balances`，使用侧栏查看财务页面。该入口拦截真实API并拒绝所有写操作，不可用于验证真实业务执行。第一轮余额独立预览 `tests/frontend/balances-preview.mjs` 继续保留。

## 本轮验证

- `pnpm typecheck`、两端生产构建及边界检查通过。
- `pnpm test`：209项前端/网关回归通过；随后客户端人工详情呈现隔离的小修后，最终两端构建与36项相关回归再次通过。
- 36项专项包含crypto-funds、manual-funds、fund-records、operations-overview、issuing-admin-ui、finance-money-display。新增验证配置/订单分离、查询参数保留、只读运营无法通过settings参数进入编辑，以及报表视图切换不重读或丢失周期。
- 浏览器：合成数据检查流水/出金订单详情、产品费率三级页、报表每日明细、OTC配置返回订单、资金记录高级筛选和有效详情抽屉。390px下报表、费用配置、资金抽屉、余额列表测得页面宽度与scrollWidth均为390；钱包/订单二级到三级导航保留。
- `pnpm docs:check`、`git diff --check`通过。构建存在既有大chunk提示，不影响构建完成。
- 未验证：真实登录、真实渠道、线上业务执行；没有生产数据库连接、迁移、真实资金写入或独立部署。总协调任务将收敛提交和发布，当前交付状态仍为本地。

文件边界：后台operations下BalancesPage、CryptoFundsPage、PricingPage、FundsOverview、OperationsPage、FundRecordsPage、新FinanceWorkspace与两份CSS；共享finance下CryptoFunds、ManualFunds、FundsFeeSettings、FundRecords；三份相关回归、balances-preview/finance-preview合成预览及本专题/README/current-state/catalog。共享FundRecords中已有抽屉改动、ManualFunds中人工政策改动均保留。

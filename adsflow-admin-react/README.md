# ADSFLOW Read-only Admin

新的 React + Vite 只读运营后台。视觉基线来自用户提供的 Minimal Dashboard 模板，业务数据通过现有 `/admin-api` 查询接口读取。

交易、资金及渠道相关开发先读 [跨项目开发总纲](../docs/DEVELOPMENT.md)。其中多渠道模型与接口为待评审设计，不替代本项目既有 Demo 实现说明。

## 本地运行

```bash
pnpm install
pnpm dev
```

默认地址：`http://localhost:8850/login`

## 本地 Demo 产品原型

不连接生产后端、直接启动完整多级产品原型：

```bash
pnpm demo
```

- 前端：`http://localhost:8850/login`
- 本地 Demo API：`http://127.0.0.1:8860`
- 账号：`demo@adsflow.local`
- 密码：`demo-only`

Demo API 在内存中生成主账户、子账户、卡片、六个月交易、风险和资金快照，可演示：

- 分析全景 → 交易/卡片/账户/风险/资金专题；
- 专题 → 同级分群（失败、待处理、大额、冻结、低余额、高风险、授信、渠道异常等）；
- 分群 → 账户/卡片/交易实体分析 → 关联对象继续下钻；
- 实体分析 → 原始查询详情，用作最终字段证据。

面包屑和专题切换始终保留下钻来源，避免从分析页直接跳走后丢失筛选语境。

账户组风控支持主账户 → 子账户 → 卡片 → 拒绝交易四级调查，当前重点覆盖连续欠费、高拒绝率和大额欠费。算法口径、数据契约、事件去重、时间窗口、统计置信度与迟到数据重算规则见 [账户与卡片风控统计模型](docs/risk-analytics-model.md)。阈值统一由 `src/config/riskPolicy.ts` 版本化管理。

资金对账支持平台总账 → 用户分户账 → 渠道真实资金池 → 可疑成功交易四道核对，并提供即时、日终、周期三个观察方式和调查事项证据页。完整公式、容差、盗刷调查分和生产数据要求见 [资金对账与盗刷调查模型](docs/reconciliation-and-fraud-model.md)。

收入分析当前只包含 OTC 手续费和开卡费，按逐笔确认状态区分已确认、待确认与已冲回，返佣明确排除。指标、时间口径和数据质量规则见 [收入确认与分析模型](docs/revenue-model.md)。

如需用线上只读数据制作本地快照，请先阅读 [Demo 快照说明](docs/demo-snapshot.md)。导入器不会保存原始 OTP、完整卡号或访问令牌，生成的 `demo-server/snapshot.json` 已加入 `.gitignore`。

## 安全边界

- 只读接口由 `src/api/client.ts` 中的精确方法与路径白名单控制。
- 查询接口即使使用 `POST` 也必须逐项进入白名单。
- 不包含冻结、解冻、转账、提现、审核、编辑、删除等客户端封装。
- 认证令牌只保存在页面内存中，刷新页面后需要重新登录。
- 列表默认使用脱敏卡号；单卡详情仅在现有 API 返回完整卡号时允许当前会话临时查看。
- 运营后台不调用、不展示卡安全码数据。客户详情的远程 CVV 临时展示组件与接入边界见 [CVV 说明](docs/client-cvv.md)，演示卡不能获取真实 CVV。
- 请求使用 `cache: no-store`，不会把业务响应写入本地数据库或浏览器存储。
- 本地 Demo 数据源在界面中始终标记为“本地 Demo 脱敏快照”，不会冒充线上实时数据。

## 环境变量

Firebase 项目与 Web SDK 已完成基础配置，登录切换及验收边界见 [Firebase 接入](docs/firebase-setup.md)。

复制 `.env.example` 为 `.env.local`，设置：

- `VITE_API_PROXY_TARGET`：后台 API 目标地址。
- `VITE_TURNSTILE_SITE_KEY`：Cloudflare Turnstile 公共站点密钥。
- `VITE_PORT`：本地开发端口，默认 `8850`。

## 验证

```bash
pnpm typecheck
pnpm build
```

## 客户端工作台

访问 `http://localhost:8850/portal` 进入独立客户演示。包含工作台、资金、卡片、账单、团队、消息、工单和开户设置；使用合成数据与内存状态，不连接管理员或真实金融写接口。完整范围与后端接入边界见 [客户端实施说明](docs/client-portal.md)。

资金中心新增 USDT 充值、USD/USDT 双向报价演示、提现地址簿、提现审核与渠道状态模拟、内部划拨和卡片转回。进入 `/portal/funds` 查看；详见 [资金流程与验收说明](docs/client-finance.md)。

卡片中心已改为条件查询列表，并支持单卡详情及三级记录详情；筛选与分页保留在 URL。详见 [卡片中心交互说明](docs/client-cards.md)。

卡 BIN 管理支持本地产品维护与渠道关联。`/card-bins/channels` 可登记 Slash 产品目录、查看已关联/未关联产品并逐个添加；当前为人工目录，不代表真实连接。详见 [渠道与 BIN 关联说明](docs/card-channels.md) 和 [卡 BIN 管理](docs/card-bin-management.md)。


## 卡交易流水与跨币种 Demo

本地8852卡交易流水已统一原清算与跨币种数据，支持币种关系筛选、双币金额、来源详情、费用与退款核对。运行 `npm run fx:import` 后使用 `npm run slash:demo`。详见 [字段差异](docs/cross-currency-field-gap.md) 和 [交付与验收、场景ID及清理命令](docs/cross-currency-delivery.md)。新API仅用于隔离Demo；不替换线上Go financial草案。

## 卡片管理与审批（仅隔离8852）

`/cards`、`/cards/:id` 及 `/card-operations` 已接入本地权限、状态机、双人审批与独立双边账本。运行 `npm run cards:init` 初始化专用测试卡；`npm run cards:test` 验证；`npm run cards:clean` 只清本模块。远程旧后台仍只读，不连接真实Slash写接口。详见 [盘点、接口、状态流转、资金归属及验收](docs/card-administration.md)。

## Slash 真实数据与自动更新（本地 8852）

当前 /cards 和 /transactions 默认显示已授权导入的真实只读数据；原 Demo 可切换 source=demo。固定两组各 20 张卡，每轮完成后 5 分钟更新，停服/休眠暂停。配置、权限、覆盖和运行说明见 [真实数据接入](docs/slash-live-data.md)。

# Moventra 文档索引与项目现状

更新日期：2026-09-07。校对基线为 `main` 文档提交 `4f74c30` 及其运行代码 `be31513`。本页依当前源码、配置和上一轮发布记录整理，不把文档更新视为新的部署、云端测试或业务验收。

正式仓库：[ediya204/moventra](https://github.com/ediya204/moventra)，统一维护 `main`。规范本地目录为 `/Users/edi/Documents/ChatGPT/moventra`；旧共享目录中的未提交实现和私有数据保留，不属于此仓库的可用依赖。

## 域名目标

客户端目标为 [moventra.me](https://moventra.me)，运营后台目标为 [admin.moventra.me](https://admin.moventra.me)。官网根域名已绑定并通过 HTTPS/Chrome 页面验证，Firebase 已授权 `moventra.me`；后台新域名仍待接入。实际范围见 [部署说明](../deploy/README.md)。

## 当前能力

| 层 | 当前范围 | 尚未完成或仅历史原型 |
| --- | --- | --- |
| 客户端 `apps/client` | 官网、Firebase 密码/Google 登录、个人账户/交易查询、安全设置 | `/register` 仅预览；企业流程、团队、真实卡片、资金和消息业务未开放 |
| 后台 `apps/admin` | 独立登录、批准邮箱前置检查、MFA、指定客户范围只读查询 | 审批、用户组、卡片、费率、资金、渠道和分析模块为 DEV 原型 |
| Go `services/api` | Firebase 验证、用户注册、主体授权、账户/交易查询、企业升级意向、受控开通 CLI、审计 | 无企业审核/激活、完整成员管理、资金账本或真实金融写入 |
| 身份 | 两端命名 SDK 与内存会话独立；Go UID/资源授权及 MFA 最终校验 | 共用 Firebase 项目，不是独立身份库或 token audience；本人完整登录验收独立进行 |
| 部署 | 两个 Cloudflare Worker；Render Go + PostgreSQL；API 手动发布 main | 推送文档不更新运行产物；迁移与真实渠道接入需单独授权 |
| Slash | 来源模型/映射文档与历史本地只读验证记录 | Python/Node 采集服务、私有 SQLite、凭据和轮询未纳入本仓库，生产未接入 |

注册分两步理解：客户端登录后资料补全可调用 Go 创建 users；个人主体与指定客户运营授权由受控命令分别开通，不自动创建资金账户或授予全局权限。后端企业模型保留，但当前客户端 V1 只展示个人范围。

## 文档阅读规则

- 当前指南中的命令以仓库根目录为默认，子项目另有说明时以其说明为准。
- DESIGN 是待实施目标；F/S 场景清单不等于当前所有测试已通过。
- 历史档案明确保留当时的数据、端口、代码名称和结果；其中未纳入仓库的脚本不能直接运行。生产构建不打包 Demo 路由。
- 旧文档中的 number 金额、裸来源 ID、团队功能和简化对账式不作为生产规范；按领域文档制定迁移/契约，不通过改写文档宣称代码修复。
- 当前 OpenAPI 的 `servers` 描述仍含旧“未部署”文字，属于已登记文案差异；接口以代码和路径定义为依据，发布状态看部署记录。本次仅修改 Markdown。

## 当前开发、认证与部署

- [Moventra](../README.md)
- [Moventra 开发约束](../AGENTS.md)
- [Moventra 开发总纲](DEVELOPMENT.md)
- [Moventra 客户端](../apps/client/README.md)
- [Moventra 运营后台](../apps/admin/README.md)
- [Moventra 共享前端模块](../packages/shared/README.md)
- [Moventra Go API](../services/api/README.md)
- [账户模型与第一阶段接口边界](../services/api/docs/account-model.md)
- [Go API 验证与历史证据](../services/api/docs/validation.md)
- [Moventra 部署记录](../deploy/README.md)
- [Firebase 登录与 Go 授权](frontend/firebase-setup.md)
- [V1 个人账户发布范围](frontend/v1-personal-release.md)

## 当前主题、品牌与组件来源

- [界面主题与组件约定](frontend/ui-theme.md)
- [Moventra 品牌素材](frontend/brand/README.md)
- [Minimals 来源组件](../apps/admin/src/minimals/README.md)

## 目标规范与待实施契约

- [交易、订单与资金领域规范](domain/transactions-and-funds.md)
- [交易与资金 API 契约草案](api/contract.md)
- [交易与资金验收场景](testing/financial-scenarios.md)
- [Slash 只读接入规范](integrations/slash.md)
- [分析聚合 API 契约（产品验证后选用）](frontend/analytics-api-contract.md)

## 历史功能与本地实验档案

- [管理总后台：结构与本地实施](frontend/admin-console.md)
- [卡片管理闭环（2026-09-07）](frontend/card-administration.md)
- [卡 BIN 产品目录与客户端开卡](frontend/card-bin-management.md)
- [发卡渠道与 BIN 产品关联](frontend/card-channels.md)
- [客户卡片中心：列表与三级详情](frontend/client-cards.md)
- [客户卡片 CVV：远程获取、临时展示](frontend/client-cvv.md)
- [客户资金中心：USDT 充值、兑换与提现](frontend/client-finance.md)
- [客户端首期实现](frontend/client-portal.md)
- [卡交易流水：双币种消费交付与验收](frontend/cross-currency-delivery.md)
- [跨币种卡消费字段差异与实施顺序](frontend/cross-currency-field-gap.md)
- [数字货币资金工作台（本地隔离实现）](frontend/crypto-finance.md)
- [本地 Demo 快照](frontend/demo-snapshot.md)
- [客户端消息中心](frontend/message-center.md)
- [资金对账与盗刷调查模型](frontend/reconciliation-and-fraud-model.md)
- [收入确认与分析模型](frontend/revenue-model.md)
- [账户与卡片风控统计模型](frontend/risk-analytics-model.md)
- [Slash Demo 场景、记录ID与预期金额](frontend/slash-demo-scenarios.md)
- [Slash 清算 Demo：实施与本地验收](frontend/slash-demo.md)
- [Slash 字段差异与实施顺序（2026-09-06）](frontend/slash-field-gap.md)
- [Slash 真实数据接入现有本地后台](frontend/slash-live-data.md)
- [用户组与开户管理（本地实现）](frontend/user-management.md)

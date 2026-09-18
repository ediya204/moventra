# FLOW-ADMIN-FINANCE：正式后台财务入口接通

日期：2026-09-18。基线 main `89ca9c3`，线上 API 实测仍为 `a2fa1f6`。本批包含原有会话修复及并行文档整理；不覆盖这些工作。

用户选择逐项接通正式功能，优先资金与财务，并指定 Blnk、Slash、Cregis。用户随后授权检查其他未合并代码并合入 main，以线上最新实现为兼容基线。合并代码不等于生产发布。

## 流程卡

| 项目 | 本批范围 |
| --- | --- |
| 目标 | 接通现有正式接口支持的卡费率管理和 USD 交易报表；调查其余真实资金模块的来源 |
| 页面关系 | /pricing → /pricing/products/:productId → 维护覆盖价/恢复继承 → 列表；q/page 保留在 URL。/reports?days=7/14/30 → 每日明细 → CSV |
| 业务身份 | issuing 产品 UUID、客户主体 UUID、定价组 UUID；报表按当前管理员交易读取范围 |
| 数据依据 | Go/PostgreSQL issuing_products 与既有价格配置；报表使用 transactions 投影，不读 Demo、测试资金或链上余额 |
| 接口链 | PricingPage → issuingRequest → 既有 issuing 网关 → issuingAPI → 目录/价格数据与审计；报表 → liveGet → /admin-api/v1/ops/overview → 逐客户授权 SQL 聚合 |
| 状态与操作 | 列表分页搜索、产品深链、覆盖价保存/恢复继承、失败重试；价格 revision 防止旧版本覆盖；未配置与免费 0 分开 |
| 跨端变化 | 使用既有价格权威及优先级；不改变历史订单，不自动激活发卡或付款 |
| 权限 | Firebase admin、MFA、catalog:read、pricing:write；默认产品维护继续校验 catalog:write 及 pricing:write。报表逐客户 transactions:read |
| 验收 | React 测试覆盖真实页面状态及路由、精确金额、分页、深链上下文、价格 POST/revision/重新查询；服务端沿用已存在的授权，不扩展接口 |
| 待定与阻塞 | Cregis 等旧候选源码在本机与远程分支未找到，需用户提供位置。真实资金配置、客户映射、OTC 报价来源及生产切换未核验 |

## 当前能力与剩余范围

- `/pricing` 当前只提供卡产品开卡费与客户/组覆盖；未声称数字货币、OTC 或所有旧费率方案已迁移。
- `/reports` 展开既有 USD 投影的每日明细、覆盖说明和 CSV，不代表全资金账本报表、利润或链上对账。
- 数字货币流水、OTC、数字货币出金审批、风险、资金对账、全量操作日志及设置仍未接通；保留原有不可用提示。
- Blnk 当前仓库只有 shadow 模式；Slash 已有只读投影和通知；Cregis 接口草稿只在历史发布记录中提及。没有将测试余额改名为真实资金，也没有调用真实资金写接口。

## 验证与发布

本地实现完成；本轮 pnpm typecheck、pnpm build、112 项前端/网关测试及 12 项 SEO 测试通过；125 份 Markdown 的本地链接、JSON 示例与目录检查通过。Node v22.16.0 测试使用 NODE_OPTIONS=--experimental-strip-types。本人认证浏览器验收、真实渠道验证与部署未执行。后续仍需取得缺失源码、核对正式配置和数据归属，才能完成剩余模块。

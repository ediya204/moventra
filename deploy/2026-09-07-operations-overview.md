# 资金运营概览发布记录

2026-09-07（香港时间）。按用户部署、上传授权执行，遵循 Minimals 系统组件方向。

- 运行源码：`a42e2b961fc7ab7daa68bed108402f22640d2b53`，已推送 `ediya204/moventra` 的 main。
- 运营后台：[admin.moventra.me/workbench](https://admin.moventra.me/workbench)。Worker `moventra-admin`，版本 `63e99921-1fdd-4bda-b350-08cbc3b6de72`。
- Go API：Render `srv-daepgj8u01pc73fgdhsg`，部署 `dep-daf3p91t0dsc73cecu1g` 为 live，固定上述源码提交。自动部署仍关闭，无 pre-deploy 迁移。
- 后台入口 JS 和 OperationsPage 资源与本地构建 SHA-256 一致；概览无凭据请求为 401、POST 为 405、客户端跨端访问为 404；API readyz 为 ready。浏览器确认未登录进入 workbench 后转向正式后台登录页。
- 42 项前端与网关测试、依赖边界、后台 TypeScript/Vite 构建、Wrangler dry-run、Go test/vet/build 及隔离 PostgreSQL race 场景通过。图表懒加载保留 ApexCharts 大 chunk 提示。
- 本地浏览器确认 7/14 天切换及每日精确明细；读取的是已保存 Slash 投影。本次没有调用真实渠道重新抓取数据，也未执行本人密码/MFA 后的生产业务验收。

正式概览读取现有授权客户的 USD 交易投影；本地 Slash 数据、卡片和商户来源尚未接入正式 Go。不可用能力保持明确空态，不上传私有数据、不执行生产迁移、不增加权限或真实金融写操作。客户端 Worker 未重新发布。

卡交易流水日期筛选作为后续源码提交，仅用于当前 DEV Slash 页面：7/14/30 天、自定义 UTC 日期、最多 30 天、列表与汇总范围一致。前端日期 4 项和旧本地 Node 15 项针对性检查通过，真实本地页面已验证自定义单日范围；不属于本次正式后台运行路由。日期说明见 [日期筛选](../docs/frontend/transaction-date-range.md)。

回退基线：后台 Worker `cb0e4fd2-8979-46da-987d-d35047f3ef8b`；Go 提交 `be31513b8be84f902384d97e7d6dcd89fda62ad3`、上一部署 `dep-daeqe1nqj5pc73ah882g`。本次未执行回退。

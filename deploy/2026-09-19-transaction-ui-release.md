# 2026-09-19 交易页面发布

## 范围

从 origin/main `5d9dc2c` 独立合入本任务交易 UI，保留此前卡片详情/CVV 与卡片中心成果。客户端筛选/完整 CSV 导出、直接描述输入、删除最近交易和数据来源；两端详情使用中文状态与语义色图标、移除入账状态和原币单位提示；交易整行可打开详情，嵌套链接保持独立。未纳入并行资金预检、卡片指标、USDT 截断或 OTC 改动。

## 验证

156 项前端/网关测试、两端类型检查通过。两端生产构建、Worker dry-run 与文档检查通过。源码 `e030d88` 已推送 GitHub main。此前浏览器交互验证仅使用本地合成数据，不代表真实登录与渠道验收。未修改 API 服务、数据库、迁移、密钥或真实资金。

## 发布及回退

发布前 live 客户端 `e91072e3-af15-4217-affd-8872ae8d7036`、后台 `5e4f75b4-cdbf-49a0-a5bd-ec13014ec43d`，本次已通过 Wrangler deployments list 复验。两端串行部署，保留远端变量；如需回退使用对应旧版本，回退前核对是否有后续发布。

## 上线结果

- 源码：`e030d88`，两端使用同一构建；配置无修改，`--keep-vars` 保留远端变量。
- 客户端：`fa9687d7-5dc9-4afa-a975-7f74055f3e05`，2026-09-18 17:24:56 UTC，100% 流量，tag `e030d88`。
- 后台：`fd39bbe8-a745-49a3-af2c-0550bc38b931`，2026-09-18 17:25:19 UTC，100% 流量，tag `e030d88`。
- 已复验 Wrangler deployments list；`https://moventra.me/portal/transactions` 和 `https://admin.moventra.me/transactions` 返回新入口，两端 JS/CSS 与本地构建逐字节一致。客户端 `ClientHome-CiPSwiVW.js` SHA-256 前缀 `72a5e1b88f69af1a`，后台 `ChannelTransactionsPage-DVtx0qXV.js` 为 `f54405668e92a45b`。
- 未执行真实账户登录/渠道验收、Render 部署、数据库迁移或金融写入。同期其他任务后续 API 提交不属于本批部署。共享开发目录未重置或批量暂存；发布从隔离工作树完成。

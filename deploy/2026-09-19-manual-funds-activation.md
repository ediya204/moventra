# 正式人工出入金启用与原单入账 — 2026-09-19

用户确认正式后台、单一授权，并进一步明确“当前不需要审核”“后续沿用这个逻辑”。现行规则为有权限运营提交后直接处理，不设另行审核；线下出金仍须核实实际付款结果。本次用户另行明确授权“是，处理这笔 1,000 USD”，仅针对现有平台垫资原单，不执行其他历史计划。

## 发布及现行规则

- GitHub main 源码 `bf05e56e17c40df1558983ef844f54125160a654`。
- Render API `srv-daepgj8u01pc73fgdhsg`，部署 `dep-dan0fh3m8hqs739jc5e0` 于 03:57:48 UTC live，源码匹配。
- 后台 Cloudflare `moventra-admin` 版本 `8ef8b201-5133-4eeb-ba87-acffa9358912`，域名 `admin.moventra.me`；产物来自隔离工作目录精确提交，45份线上JS/CSS与本地SHA-256全部一致。
- `MANUAL_FUNDS_ENABLED=true`、`MANUAL_FUNDS_REQUIRE_REVIEW=false`。正式生产模式enabled，沿用既有Firebase MFA、客户范围、read/create/execute权限、幂等、revision与不可变审计。未新增人员授权。
- 新入金直接processing，出金先reserving；垫资回收继续记账，线下出金进入awaiting_payment后另行确认真实付款凭证。旧pending_review不会因开关自动执行，需显式继续原单。
- API每5秒恢复可执行订单，依赖ProductionReady及001/006/016/019只读校验。本批没有数据库迁移。
- `ISSUING_MODE=prepare`、`ISSUING_FUNDING_SOURCE=funds_wallet`及消息开关保持不变；客户端和issuing-worker未重新部署。

## 已授权1,000 USD原单

原单 `e5d988e6-8481-4d15-86d7-29325a7052f2`，USD平台垫资100000 cents，操作前pending_review。受控resume命令核对原单金额/来源/客户、Firebase有效运营MFA登记、全局运营与动作授权，沿用原订单及固定effect reference，仅处理这一单；未创建替代订单。

执行任务 `job-dan0gjqjnfac73eticlg` succeeded：原单completed，钱包前值9 cents、后值100009 cents，即0.09→1,000.09 USD。只读复核任务 `job-dan0gujm8hqs739jgkeg` succeeded，确认：

- `manual:<原单ID>:credit`对应journal恰好1条，合计100000 cents。
- 当前USD钱包100009 cents；全部人工订单仅1条且completed。
- 显式reconcile策略审计1条，approvalRequired=false；reviewer为null，未伪造审核人员。
- 运行提交bf05e56、人工开关true、审核开关false。

这是正式Blnk内部账本入账；没有调用银行、链上或Slash付款，也没有发卡、转卡或刷卡。平台外部资金到账与科目政策不由本次内部入账证明。更早10,000 USD计划未执行。

## 验证与边界

本轮隔离PostgreSQL全套race、go vet/build通过；无需审核的普通授权与全局运营、重复恢复单次记账、缺少execute拒绝、旧pending不自动执行、线下出金凭证、垫资回收均覆盖。192项前端/网关回归、两端类型检查和后台构建通过，人工组件5项通过。真实Firebase/Blnk通用测试夹具未配置，不能将跳过项算通过；上述真实原单是独立生产证据。

API `/readyz` HTTP200与线上45份资产一致。启用阶段登录后台已观察按钮可用，最终completed及余额以本轮数据库/账本只读核对为据，最终页面刷新未单独验收。

前期f63d143两个部署候选取消；5164482单人审核阶段已live后被本次无需审核替代。环境工具更新会自动触发Render部署，未重复触发最终版本。私有参数与凭证仅存本机私有目录，不提交仓库。

## 回退

先核对未决订单与预占，再关闭人工开关并部署；不删除订单、审计或分录，不覆盖余额。代码回退不撤销本笔已完成入账，若业务需要撤销必须另行授权可审计冲正。线下付款结果未知时不得标失败或释放占用。

平台依据：[Render一次性任务](https://render.com/docs/one-off-jobs)、[Render部署](https://render.com/docs/deploys)、[Wrangler命令](https://developers.cloudflare.com/workers/wrangler/commands/)。

# 商户 Logo 展示规范

更新：2026-09-07。正式后台卡交易只读页面已接入，发布进度见 [正式渠道投影](../releases/channel-projection-2026-09-07.md)。下方“本次”测试记录为此前本地证据。客户端商户交易页仍属DEV原型；正式客户端未提供商户交易数据，不向未绑定客户展示渠道记录。

## 页面与组件

后台卡交易列表与详情、客户端交易与账单（包括卡片详情内复用的交易列表）共用 MerchantLogo / MerchantCell。正式仓库组件位于 `packages/shared/src/components`，旧本地运行目录也已同步样式。

- 列表使用 32 × 32 px 圆形图标，移除方形边框及额外内缩；图标与商户文字间隔 10 px。
- 详情使用 56 × 56 px；后台详情的供应商署名移至底部，客户端商户名与图标置于详情头部。
- 使用 contain 保持图片比例。固定尺寸避免加载前后跳动；未知商户回退到本地商店图标，已识别品牌加载失败回退到品牌首字母，切换品牌后可重新加载。
- 商户原文不替换，过长名称单行省略并保留完整提示；不修改交易状态、金额、卡片归属或查询结果。

## 图标来源与边界

使用 Logo.dev 图标服务，Meta 固定使用 meta.com 域名，其余品牌沿用规范名称查询；品牌映射只用于展示。支持 FACEBK / FACEBOOK / FACEBOOKAD → Facebook、META ADS → Meta，以及 Google、TikTok、OpenAI 等既有品牌。映射不是渠道确认的商户身份。

仅发送规范品牌名及公开 publishable key，不发送原始交易描述、金额、内部用户或卡片 ID；图片请求不带 Referrer。未知描述不会发起品牌查询。`VITE_LOGO_DEV_PUBLISHABLE_KEY` 可覆盖已有公开 key，空值禁用图片；不允许使用服务端秘密 key。

组件保留 Logo.dev 署名。旧本地公共站点 LegalLinks 已有署名，未改动；正式仓库本次仅接入 DEV 业务页面。正式业务开放前仍需核对生产公开页面署名及授权条件，不把本地署名视为已上线。

## 验证边界

本次两端类型检查、生产构建通过；正式仓库品牌测试覆盖名称边界、未知商户、原文保留、请求不包含订单描述，以及图片失败回退与切换品牌。旧运行目录保留 SSR 测试，图片失败交互测试在正式仓库执行（旧目录未安装 react-test-renderer）。

浏览器已验证后台 Facebook / OpenAI 列表和 Facebook 详情、客户端 Google 列表及详情的数据与图标。客户端使用本地 Demo；不代表真实渠道、生产客户端或全品牌验收。构建存在既有大 chunk 提示。本次无数据库变更、真实资金操作或云端部署。

## Meta 描述与失败兜底修复（2026-09-07）

补充 METAPAY、META PAY、META ADS、META PLATFORMS、META 的前缀匹配；内部匹配统一全角字符和分隔符，来源商户原文保持不变。严格要求名称边界，METAPHOR、METAPAYMENT 等未知商户不归为 Meta。

Meta 固定请求 `meta.com` 图标，避免模糊名称查询命中其他同名公司；其他品牌沿用既有规范名查询。已识别品牌图片失败后显示本地品牌首字母，未知品牌使用内嵌 SVG 商户图标，无需额外图标网络请求，也不把原始订单描述发送给图片服务。

接口形式核验：[域名图标](https://www.logo.dev/docs/logo-images/get)、[名称匹配](https://www.logo.dev/docs/logo-images/name)。名称查询取首个搜索结果，内部别名映射不代表渠道确认的商户身份。

本次修复验证：正式仓库 37 项测试通过，两端类型检查与构建通过；旧本地 9 项相关测试及构建通过。浏览器确认 METAPAY 记录实际加载 Meta 图片（32px），未触发手动同步或金融写入。


## FLOW-MERCHANT-LOGO-02 正式客户快照补齐（2026-09-18）

- 基线：5cdc929；独立工作树 `/private/tmp/moventra-fix-card-snapshot-logos`，分支 `codex/fix-card-snapshot-logos`。原客户绑定工作树和主目录不修改。
- 目标与页面：`/portal/transactions` 卡片交易区 → `/portal/card-transactions/:id` → `/portal/cards/:id` 关联交易，恢复列表32px及详情56px图标。沿用原有深链、分页、返回上下文。
- 接口链及身份：沿用 FLOW-CARD-TEST-01 的 liveGet → 同域网关 → Go 客户主体/逐卡快照授权 → 来源投影；仅将返回 merchant 交给现有 MerchantCell/MerchantLogo。没有接口、金额、状态、授权、审计或持久化变化。运营端仍用相同共享组件。
- 图片链：规范品牌名 → Logo.dev；保留原始商户文字，原始交易描述不进入图片URL。未知商户为本地商店图标，图片失败为品牌首字母，页面显示 Logo.dev 署名。
- 验证：`node --test tests/frontend/card-snapshot.test.mjs tests/frontend/merchant-logo.test.mjs` 11项通过，覆盖三个实际页面入口的图片、原文、尺寸、署名、加载失败以及既有分页/深链/错误恢复。`pnpm build:client` 类型检查及生产构建通过；`git diff --check` 通过。
- 外部图片实测：沿用组件公开key请求规范 Facebook 品牌，HTTP 200、image/png、6976字节且PNG签名有效。未发送交易描述或用户/卡ID。
- 交付：设计和本地实现完成；自动化通过；真实金融渠道验证不适用（纯展示修复）；浏览器人工验收未执行；未部署、未修改生产数据库。

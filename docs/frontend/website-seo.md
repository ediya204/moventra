# 官网 SEO 与 Google 收录

日期：2026-09-17。当前状态：已同步 GitHub 并完成官网专项部署，见 [本次发布证据](../releases/2026-09-17-website-seo.md)；尚未验证/提交 Google Search Console，不代表 Google 已收录。以下保留初次本地实施及验证记录，线上状态以发布证据为准。

## 差异与兼容方案

本次直接读取 `https://moventra.me/`：首页 HTML 含 `noindex,nofollow`，标题为「Moventra 客户端」，初始正文为空；`/robots.txt`、`/sitemap.xml` 均返回 HTTP 200 的 SPA HTML，实际不是抓取规则或站点地图。

官网和客户应用共用应用壳，不能简单删除全局 noindex，否则登录及未知路径也可能进入搜索索引。本次保留 `apps/client/index.html` 的 noindex，单独生成首页 HTML，仅在 `moventra.me` 和 `www.moventra.me` 的根路径由客户端 Worker 返回。

首页增加中英文标题、描述、canonical、Open Graph、Twitter metadata，以及 Organization / WebSite JSON-LD。规范网址为 `https://moventra.me/`，www 首页保留访问并指向同一 canonical。`/index.html` 301 到规范首页。站点地图只列首页；政策、登录、注册、会话、账户、未知页面继续 noindex。robots 允许抓取，使搜索引擎能读取各页面的 noindex；robots 和 noindex 不承担数据访问授权。

构建时生成可见的中文 HTML 简介，包含服务、常见问题、联系信息和政策链接；React 加载后接管原有交互页面。服务和 FAQ 文案与交互页共享 `content.ts`，没有基于 User-Agent 的不同内容、关键词堆砌或虚构评价。该简介不是完整 SSR；浏览器原有语言切换仍可用，没有新增独立语言 URL 或 hreflang。

## FLOW-SEO-001 流程卡

| 项目 | 内容 |
| --- | --- |
| 目标及范围 | 搜索引擎发现首页、读取品牌及服务信息；范围从公开根路径到 robots/sitemap、构建、路由及本地浏览器验证 |
| 基线 | `/Users/edi/Documents/ChatGPT/moventra`，HEAD `ce0a88a`；工作树已有大量未提交修改，含 App、Website、Wrangler 配置和身份相关代码；未将其当作已上线基线 |
| 页面关系 | `/` 官网，`/index.html` 规范化；政策 `/privacy-policy`、`/terms-of-service`、`/cookie-policy`；登录 `/portal/login`；不改业务导航 |
| 业务身份 | 无业务记录；公开站点身份固定为 Moventra / `https://moventra.me/` |
| 数据依据 | 当前官网服务文案、公开公司联系信息；不新增第三方营销主张 |
| 接口链 | 请求 → `website-seo.mjs` → 本地 ASSETS；其他请求交回现有 `gateway.mjs`；不新增业务 API |
| 状态及操作 | 正式域名首页 index；应用壳 noindex；内部构建文件直接访问 404；非正式域名 robots 禁止抓取；资产错误返回 503 |
| 跨端变化 | 仅客户端官网与客户端构建配置；运营端配置未修改 |
| 权限 | 沿用原鉴权及 MFA；首页读取不转发 Cookie/Authorization；本地测试将 API_ORIGIN 置空，邮件使用本地模拟，未提交咨询表单 |
| 验收 | 12 项 SEO 测试、网关/咨询回归、全量前端回归、16 项本地 HTTP 检查、浏览器中英文/导航验证、生产配置 dry-run |
| 待定决策 | 官网 SEO 已获授权并发布；Search Console 属性所有权验证及提交仍待完成 |

## 实现入口与验证命令

- `apps/client/seo-build.ts`：生成 `dist/__seo-home.html`，原 `dist/index.html` 保持应用壳。构建钩子在 Vite HTML 输出之后运行。
- `apps/client/src/website/content.ts`：首页服务与 FAQ 的共享文案。
- `apps/client/src/website/seo.ts`、`useWebsiteSeo.ts`：元数据及 SPA 导航时的清理/更新。
- `deploy/cloudflare/website-seo.mjs`：官网请求与 robots/sitemap 入口；内部 HTML 不能作为独立公开 URL 返回。
- `deploy/cloudflare/wrangler.jsonc`：客户端 Worker 使用 SEO 入口，并将相关路径加入 `run_worker_first`；后台仍使用既有入口。

在仓库根目录运行：

```sh
pnpm test:seo
pnpm test
node --test deploy/cloudflare/contact.test.mjs
```

在 `deploy/cloudflare` 运行（dry-run 不发布）：

```sh
node_modules/.bin/wrangler deploy --dry-run --env production --outdir /tmp/moventra-seo-dryrun
node_modules/.bin/wrangler dev --local --env production --ip 127.0.0.1 --port 8894 --inspector-port 9394 --persist-to /tmp/moventra-seo-local-state --var API_ORIGIN: --var SITE_KIND:client
```

本地使用 `curl -H 'Host: moventra.me' http://127.0.0.1:8894/` 检查正式域名路由。浏览器访问 localhost 会保留 noindex，这是预览域名策略；正式域名行为由本地 Host 请求和路由测试验证。

## 本次证据

| 维度 | 2026-09-17 结果 |
| --- | --- |
| 设计/本地实现 | 完成；只对公开首页开放索引 |
| 类型及构建 | `pnpm build:client` 通过；包含 TypeScript 检查，生成约 5 KB 首页 HTML |
| SEO 自动化 | 9 项边缘路由测试 + 3 项构建产物测试通过 |
| 既有回归 | `pnpm test` 61/61，通过应用依赖边界检查；咨询表单测试 5/5；另运行的网关 13 项与前述 61 项有重叠，不重复累计 |
| 实际本地 HTTP | 16 项通过：根域及 www 首页、7 类非首页路径、robots/sitemap 内容与 HEAD、内部文件 404 |
| 浏览器 | 本地首页、服务及 FAQ 显示正常；中英标题/描述切换；点击政策后 canonical/JSON-LD 清除、noindex 保留 |
| 发布预检 | Wrangler 4.129.0 production dry-run 通过，未上传 |
| 真实渠道/金融操作 | 不适用；未调用真实金融接口或生产业务 API |
| Git/部署/Google | 未提交/未部署/未请求收录，线上尚未应用本次修复 |

## 发布及 Search Console

当前构建包含原有未提交业务改动，不能直接将整份构建视为 SEO 专项发布包。发布时须核对线上版本及相关并行任务状态，以获准的发布基线隔离本次 SEO 变更，重新构建、检查并保留回滚版本。只发布客户端官网；不随之发布管理员、API、数据库或角色迁移。

上线后复核：真实首页 HTTP 200、原始 HTML 无 noindex、canonical 唯一、可见正文与交互页面一致；robots 为 text/plain，sitemap 为 XML；登录/账户页保持 noindex；www canonical 正确；Googlebot 没有被 WAF/Access/robots 阻断。

1. 在 [Google Search Console](https://search.google.com/search-console) 使用有权限的 Google 账号，选择或添加 `moventra.me` 属性。
2. 如尚未验证，按 Google 给出的精确 DNS TXT 或 HTML 验证值完成所有权验证；不编造验证码。
3. 在「站点地图」提交 `https://moventra.me/sitemap.xml`。
4. 在「网址检查」检查 `https://moventra.me/`，测试实际网址后请求编入索引。
5. 以 Search Console 的网址检查及网页索引报告确认结果。提交成功不等于收录；Google 自行决定抓取、收录及排名，不承诺固定时间或搜索位置。

官方依据：[Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)、[noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)、[开发者 SEO 指南](https://developers.google.com/search/docs/fundamentals/get-started-developers)。
